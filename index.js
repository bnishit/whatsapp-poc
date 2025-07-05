const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const {
    Client,
    LocalAuth,
    RemoteAuth,
    NoAuth,
    MessageMedia,
    Location
} = require('whatsapp-web.js');
const fs = require('fs');
const mime = require('mime-types');
const qrcode = require('qrcode');
const path = require('path');
const { LowSync } = require('lowdb');
const { JSONFileSync } = require('lowdb/node');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Parse JSON bodies for message sending endpoint
app.use(express.json());

app.use(express.static('public'));

// Simple JSON database using lowdb to persist received messages
const dbFile = path.join(__dirname, 'messages.json');
const db = new LowSync(new JSONFileSync(dbFile));
db.read();
db.data ||= { messages: [] };
function saveDb() {
    try {
        db.write();
    } catch (err) {
        console.error('Failed to save database', err);
    }
}

async function mediaFromFile(filePath) {
    const buffer = await fs.promises.readFile(filePath);
    const mimetype = mime.lookup(filePath) || 'application/octet-stream';
    const filename = path.basename(filePath);
    return new MessageMedia(mimetype, buffer.toString('base64'), filename);
}

async function mediaFromUrl(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimetype = res.headers.get('content-type') || mime.lookup(url) || 'application/octet-stream';
    const filename = path.basename(new URL(url).pathname);
    return new MessageMedia(mimetype, buffer.toString('base64'), filename || 'file');
}

async function prepareMedia(media) {
    if (!media) throw new Error('media required');
    if (media.data && media.mimetype) {
        return new MessageMedia(media.mimetype, media.data, media.filename || 'file');
    }
    if (media.path) {
        return await mediaFromFile(media.path);
    }
    if (media.url) {
        return await mediaFromUrl(media.url);
    }
    throw new Error('invalid media object');
}

let authStrategy;
if (process.env.REMOTE_AUTH) {
    authStrategy = new RemoteAuth();
} else if (process.env.NO_AUTH) {
    authStrategy = new NoAuth();
} else {
    authStrategy = new LocalAuth();
}

const client = new Client({
    authStrategy,
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', async (qr) => {
    try {
        const img = await qrcode.toDataURL(qr);
        io.emit('qr', img);
    } catch (err) {
        console.error('Failed to generate QR', err);
    }
});

client.on('ready', () => {
    console.log('Client is ready!');
    io.emit('ready');
    client.getChats().then(chats => {
        const names = chats.map(chat => chat.name || chat.id.user);
        io.emit('chats', names);
    });
});

// Reply to simple ping messages and forward received messages to the UI
client.on('message', async msg => {
    if (msg.body === '!ping') {
        msg.reply('pong');
    }
    const entry = { id: msg.id._serialized, from: msg.from, body: msg.body, type: msg.type, timestamp: Date.now(), direction: 'in' };
    if (msg.hasMedia) {
        try {
            const media = await msg.downloadMedia();
            entry.media = { mimetype: media.mimetype, data: media.data, filename: media.filename };
        } catch (err) {
            console.error('Failed to download media', err);
        }
    }
    db.data.messages.push(entry);
    saveDb();
    io.emit('message', { from: msg.from, body: msg.body, media: entry.media });
});

// Retrieve stored messages
app.get('/messages', (_req, res) => {
    res.json(db.data.messages);
});

app.get('/media/:id', (req, res) => {
    const msg = db.data.messages.find(m => m.id === req.params.id);
    if (!msg || !msg.media) {
        return res.status(404).json({ error: 'not found' });
    }
    res.json(msg.media);
});

// Search stored messages
app.get('/messages/search', (req, res) => {
    const { q = '', chat, limit } = req.query;
    const needle = q.toLowerCase();
    let results = db.data.messages.filter(m => {
        if (chat && !(m.from === chat || m.to === chat)) return false;
        if (needle && !(m.body && m.body.toLowerCase().includes(needle))) return false;
        return true;
    });
    if (limit) {
        const n = parseInt(limit, 10);
        if (!Number.isNaN(n)) {
            results = results.slice(-n);
        }
    }
    res.json(results);
});

// HTTP endpoint to send a message to a chat or number
app.post('/send', async (req, res) => {
    const { to, type = 'text', message, media, latitude, longitude, contacts, poll, sticker } = req.body;
    if (!to) {
        return res.status(400).json({ error: 'to is required' });
    }

    try {
        const chatId = to.includes('@') ? to : `${to}@c.us`;

        let sentMedia;
        switch (type) {
            case 'media':
            case 'media-url':
            case 'media-file':
            case 'video':
            case 'gif':
            case 'sticker': {
                const m = await prepareMedia(media);
                const options = {};
                if (type === 'sticker') options.sendMediaAsSticker = true;
                if (type === 'gif') options.sendVideoAsGif = true;
                await client.sendMessage(chatId, m, options);
                sentMedia = { mimetype: m.mimetype, data: m.data, filename: m.filename };
                break;
            }
            case 'location':
                if (latitude == null || longitude == null) {
                    return res.status(400).json({ error: 'latitude and longitude required' });
                }
        await client.sendMessage(chatId, new Location(latitude, longitude));
        break;
    case 'live-location':
        // TODO: implement live location streaming
        if (latitude == null || longitude == null) {
            return res.status(400).json({ error: 'latitude and longitude required' });
        }
        await client.sendMessage(chatId, new Location(latitude, longitude));
        break;
            case 'contacts':
                if (!Array.isArray(contacts) || contacts.length === 0) {
                    return res.status(400).json({ error: 'contacts array required' });
                }
                await client.sendMessage(chatId, contacts.join('\n'));
                break;
            case 'poll':
                if (!poll || !poll.question || !poll.options) {
                    return res.status(400).json({ error: 'poll with question and options required' });
                }
                await client.sendMessage(chatId, message || '', { poll });
                break;
            default:
                if (!message) {
                    return res.status(400).json({ error: 'message is required' });
                }
                await client.sendMessage(chatId, message);
        }

        // store outgoing message in db
        const outEntry = { id: Date.now().toString(), to: chatId, type, body: message, timestamp: Date.now(), direction: 'out' };
        if (sentMedia) outEntry.media = sentMedia;
        db.data.messages.push(outEntry);
        saveDb();

        res.json({ status: 'sent' });
    } catch (err) {
        console.error('Failed to send message', err);
        res.status(500).json({ error: 'failed to send message' });
    }
});

// Chat management
app.get('/chats', async (_req, res) => {
    try {
        const chats = await client.getChats();
        res.json(chats.map(c => ({ id: c.id._serialized, name: c.name })));
    } catch (err) {
        console.error('Failed to get chats', err);
        res.status(500).json({ error: 'failed to get chats' });
    }
});

app.get('/chats/search', async (req, res) => {
    const { q } = req.query;
    try {
        const chats = await client.searchChats(q || '');
        res.json(chats);
    } catch (err) {
        console.error('Failed to search chats', err);
        res.status(500).json({ error: 'failed to search chats' });
    }
});

app.post('/chats/:id/archive', async (req, res) => {
    try {
        const chat = await client.getChatById(req.params.id);
        await chat.archive();
        res.json({ status: 'archived' });
    } catch (err) {
        console.error('Failed to archive chat', err);
        res.status(500).json({ error: 'failed to archive chat' });
    }
});

app.post('/chats/:id/unarchive', async (req, res) => {
    try {
        const chat = await client.getChatById(req.params.id);
        await chat.unarchive();
        res.json({ status: 'unarchived' });
    } catch (err) {
        console.error('Failed to unarchive chat', err);
        res.status(500).json({ error: 'failed to unarchive chat' });
    }
});

// Group management
app.post('/group/create', async (req, res) => {
    const { name, participants } = req.body;
    if (!name || !Array.isArray(participants)) {
        return res.status(400).json({ error: 'name and participants required' });
    }
    try {
        const result = await client.createGroup(name, participants);
        res.json(result);
    } catch (err) {
        console.error('Failed to create group', err);
        res.status(500).json({ error: 'failed to create group' });
    }
});

app.post('/group/:id/add', async (req, res) => {
    const { members } = req.body;
    if (!Array.isArray(members)) {
        return res.status(400).json({ error: 'members array required' });
    }
    try {
        const chat = await client.getChatById(req.params.id);
        await chat.addParticipants(members);
        res.json({ status: 'added' });
    } catch (err) {
        console.error('Failed to add members', err);
        res.status(500).json({ error: 'failed to add members' });
    }
});

app.post('/group/:id/remove', async (req, res) => {
    const { members } = req.body;
    if (!Array.isArray(members)) {
        return res.status(400).json({ error: 'members array required' });
    }
    try {
        const chat = await client.getChatById(req.params.id);
        await chat.removeParticipants(members);
        res.json({ status: 'removed' });
    } catch (err) {
        console.error('Failed to remove members', err);
        res.status(500).json({ error: 'failed to remove members' });
    }
});

app.get('/group/:id', async (req, res) => {
    try {
        const chat = await client.getChatById(req.params.id);
        res.json({ id: chat.id._serialized, name: chat.name, participants: chat.participants });
    } catch (err) {
        console.error('Failed to get group info', err);
        res.status(500).json({ error: 'failed to get group info' });
    }
});

app.post('/group/:id/promote', async (req, res) => {
    const { members } = req.body;
    if (!Array.isArray(members)) {
        return res.status(400).json({ error: 'members array required' });
    }
    try {
        const chat = await client.getChatById(req.params.id);
        await chat.promoteParticipants(members);
        res.json({ status: 'promoted' });
    } catch (err) {
        console.error('Failed to promote members', err);
        res.status(500).json({ error: 'failed to promote members' });
    }
});

app.post('/group/:id/demote', async (req, res) => {
    const { members } = req.body;
    if (!Array.isArray(members)) {
        return res.status(400).json({ error: 'members array required' });
    }
    try {
        const chat = await client.getChatById(req.params.id);
        await chat.demoteParticipants(members);
        res.json({ status: 'demoted' });
    } catch (err) {
        console.error('Failed to demote members', err);
        res.status(500).json({ error: 'failed to demote members' });
    }
});

// Contact management
app.get('/contacts', async (_req, res) => {
    try {
        const contacts = await client.getContacts();
        res.json(contacts.map(c => ({ id: c.id._serialized, name: c.name })));
    } catch (err) {
        console.error('Failed to get contacts', err);
        res.status(500).json({ error: 'failed to get contacts' });
    }
});

app.get('/contact/:id', async (req, res) => {
    try {
        const contact = await client.getContactById(req.params.id);
        res.json({ id: contact.id._serialized, name: contact.name, number: contact.number });
    } catch (err) {
        console.error('Failed to get contact info', err);
        res.status(500).json({ error: 'failed to get contact info' });
    }
});

app.post('/contact/block', async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
        const contact = await client.getContactById(id);
        await contact.block();
        res.json({ status: 'blocked' });
    } catch (err) {
        console.error('Failed to block contact', err);
        res.status(500).json({ error: 'failed to block contact' });
    }
});

app.post('/contact/unblock', async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    try {
        const contact = await client.getContactById(id);
        await contact.unblock();
        res.json({ status: 'unblocked' });
    } catch (err) {
        console.error('Failed to unblock contact', err);
        res.status(500).json({ error: 'failed to unblock contact' });
    }
});

// Profile management
app.get('/profile/picture', async (_req, res) => {
    try {
        const url = await client.getProfilePicUrl(client.info.wid._serialized);
        res.json({ url });
    } catch (err) {
        console.error('Failed to get profile picture', err);
        res.status(500).json({ error: 'failed to get profile picture' });
    }
});

app.post('/profile/picture', async (req, res) => {
    const { data, mimetype } = req.body;
    if (!data || !mimetype) return res.status(400).json({ error: 'data and mimetype required' });
    try {
        const media = new MessageMedia(mimetype, data);
        await client.setProfilePicture(media);
        res.json({ status: 'updated' });
    } catch (err) {
        console.error('Failed to set profile picture', err);
        res.status(500).json({ error: 'failed to set profile picture' });
    }
});

app.get('/profile/status', async (_req, res) => {
    try {
        const status = await client.getStatus();
        res.json({ status: status.status });
    } catch (err) {
        console.error('Failed to get status', err);
        res.status(500).json({ error: 'failed to get status' });
    }
});

app.post('/profile/status', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    try {
        await client.setStatus(text);
        res.json({ status: 'updated' });
    } catch (err) {
        console.error('Failed to set status', err);
        res.status(500).json({ error: 'failed to set status' });
    }
});

app.get('/profile/about', async (_req, res) => {
    try {
        const about = await client.getAbout();
        res.json({ about });
    } catch (err) {
        console.error('Failed to get about', err);
        res.status(500).json({ error: 'failed to get about' });
    }
});

app.post('/profile/about', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    try {
        await client.setAbout(text);
        res.json({ status: 'updated' });
    } catch (err) {
        console.error('Failed to set about', err);
        res.status(500).json({ error: 'failed to set about' });
    }
});

// Message status tracking
client.on('message_ack', (msg, ack) => {
    io.emit('message_ack', { id: msg.id._serialized, ack });
});

// Forward additional events
const events = [
    'authenticated', 'auth_failure', 'message_create',
    'group_join', 'group_leave', 'group_update'
];
events.forEach(e => client.on(e, (...data) => io.emit(e, data)));

// Business features (placeholders)
app.get('/business/catalog', (_req, res) => {
    res.status(501).json({ error: 'not implemented' });
});

app.get('/business/orders', (_req, res) => {
    res.status(501).json({ error: 'not implemented' });
});

app.post('/business/payment', (_req, res) => {
    res.status(501).json({ error: 'not implemented' });
});

client.initialize();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
