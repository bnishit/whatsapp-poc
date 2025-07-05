const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const client = new Client({ authStrategy: new LocalAuth() });
let ready = false;

client.on('qr', qr => {
  ready = false;
  QRCode.toDataURL(qr)
    .then(url => io.emit('qr', url))
    .catch(err => console.error('QR code error', err));
});

client.on('ready', () => {
  ready = true;
  io.emit('ready');
});

app.get('/api/chats', async (req, res) => {
  if (!ready) {
    return res.status(400).json({ error: 'Client not ready' });
  }
  try {
    const chats = await client.getChats();
    res.json(chats.map(c => ({ id: c.id._serialized, name: c.name || c.id.user })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load chats' });
  }
});

client.initialize();

io.on('connection', socket => {
  console.log('Web client connected');
  if (ready) {
    socket.emit('ready');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
