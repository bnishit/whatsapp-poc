const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('Client is ready!');
    client.getChats().then(chats => {
        chats.forEach(chat => {
            console.log(`Chat: ${chat.name || chat.id.user}`);
        });
    });
});

client.initialize();
