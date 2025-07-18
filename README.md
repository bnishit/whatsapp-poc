# WhatsApp POC

This project demonstrates how to log in to WhatsApp Web using [`whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js).
A small web interface displays the QR code and shows your chats once logged in. The server exposes several HTTP endpoints for sending different types of messages and managing chats, groups and contacts.

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

Open `http://localhost:3000` in your browser. This loads the minimal interface in
`public/index.html` which shows the QR code and allows sending a basic message.
For a more complete demonstration with extra features, open
`http://localhost:3000/ui.html` instead.
Scan the QR code with the WhatsApp app on your phone. After authentication the
page will show a list of your chat names.

All received and sent messages are stored in a small JSON database located in
`messages.json` at the project root. Media attachments are stored inline as
base64 so they can be fetched later using the `/media/:id` endpoint. The
`/messages` endpoint can be used to retrieve the history.

## API Endpoints

- The server provides a simple JSON API.
- `POST /send` — send messages (text, media, local files, URLs, videos, GIFs, contacts, polls, stickers and locations)
- `GET /messages` — list stored incoming and outgoing messages
- `GET /media/:id` — retrieve a stored attachment
- `GET /messages/search?q=text&chat=id&limit=n` — search stored messages
- `GET /chats` — list all chats
- `GET /chats/search?q=text` — search chats by name
- `POST /chats/:id/archive` and `.../unarchive` — archive/unarchive a chat
- `POST /group/create` — create a group with participants
- `POST /group/:id/add` / `remove` / `promote` / `demote` — manage group members
- `GET /contacts` — list contacts
- `POST /contact/block` / `unblock` — block or unblock a contact
- `GET /profile/picture` — get your profile picture
- `POST /profile/picture` — update your profile picture
These endpoints are intentionally minimal and rely on `whatsapp-web.js` under the hood.
