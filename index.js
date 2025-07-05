const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Parse JSON bodies for message sending endpoint
app.use(express.json());

app.use(express.static('public'));

const client = new Client({
    authStrategy: new LocalAuth()
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
client.on('message', msg => {
    if (msg.body === '!ping') {
        msg.reply('pong');
    }
    io.emit('message', { from: msg.from, body: msg.body });
});

// HTTP endpoint to send a message to a chat or number
app.post('/send', async (req, res) => {
    const { to, message } = req.body;
    if (!to || !message) {
        return res.status(400).json({ error: 'to and message are required' });
    }
    try {
        const chatId = to.includes('@') ? to : `${to}@c.us`;
        await client.sendMessage(chatId, message);
        res.json({ status: 'sent' });
    } catch (err) {
        console.error('Failed to send message', err);
        res.status(500).json({ error: 'failed to send message' });
    }
});

client.initialize();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
