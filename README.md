# WhatsApp POC

This project demonstrates how to log in to WhatsApp Web using [`whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js).
A small web interface displays the QR code and shows your chats once logged in.

## Setup

1. Install Node.js (>=14) if not already installed.
2. Install dependencies:

```bash
npm install
```

## Running

Start the server with:

```bash
node index.js
```

Open `http://localhost:3000` in your browser. Scan the QR code with the WhatsApp
app on your phone. After authentication the page will show a list of your chat
names.
