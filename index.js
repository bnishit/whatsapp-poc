const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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

client.initialize();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
