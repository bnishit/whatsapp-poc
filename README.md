# WhatsApp POC

This project demonstrates how to log in to WhatsApp Web using [`whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js) and list all your chats.

## Setup

1. Install Node.js (>=14) if not already installed.
2. Install dependencies:

```bash
npm install
```

## Running (CLI)

Run the script with:

```bash
node index.js
```

When the QR code appears in the terminal, scan it with the WhatsApp app on your phone. After successful authentication, the script will print "Client is ready!" and list your chat names.

## Running the Web UI

To try the simple web interface with a QR code and chat list:

```bash
npm start
```

Open <http://localhost:3000> in your browser. Scan the displayed QR code. Once logged in you will be redirected to a page listing your chats.
