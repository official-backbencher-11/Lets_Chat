# LetsChat

A WhatsApp-like real‑time chat application.

- Backend: Node.js, Express, MongoDB, Socket.io, Firebase Admin (auth verify)
- Frontend: React (CRA), Socket.io client

## Features
- Phone OTP login (Firebase Phone Auth)
- Email link (passwordless) login (Firebase Auth)
- Profile setup with avatar
- Real‑time messaging, ticks (sent/delivered/read)
- Presence (online/last seen), typing
- Attachments (images, docs) with download
- Delete message/chat (for me / for everyone)
- Block/unblock, hide/unhide chats with 4‑digit PIN
- Hidden chats access via PIN

## Prerequisites
- Node.js 18+ and npm
- MongoDB running (local or cloud)
- Firebase project with:
  - Phone Authentication enabled
  - Email/Password and Email Link (passwordless) enabled
  - Web app config for the frontend
  - Admin SDK service account for the backend
- Authorized domains in Firebase Auth must include your frontend URL (e.g., http://localhost:3000)

## Quick start (development)

1) Backend
- Copy backend/.env.example to backend/.env and fill in values
- Place your Firebase Admin service account in backend/config/firebase.js (or adapt the loader)
- Install and run

```bash
npm --prefix backend install
npm --prefix backend start
```

The backend will start on http://localhost:5000 and expose /health.

2) Frontend
- Copy frontend/.env.example to frontend/.env and fill in values (API base URL, Firebase web config)
- Install and run

```bash
npm --prefix frontend install
npm --prefix frontend start
```

Open http://localhost:3000 in your browser.

## Environment variables

See backend/.env.example and frontend/.env.example for the minimal set.

### Backend (.env)
- MONGODB_URI=mongodb://localhost:27017/letschat
- JWT_SECRET=your_jwt_secret
- ALLOWED_ORIGINS=http://localhost:3000

### Frontend (.env)
- REACT_APP_API_URL=http://localhost:5000/api
- REACT_APP_SOCKET_URL=http://localhost:5000
- REACT_APP_EMAIL_CONTINUE_URL=http://localhost:3000/
- REACT_APP_FIREBASE_API_KEY=... and the rest of Firebase web config

## Notes
- For email link sign‑in, ensure Email Link (passwordless) is enabled and your Support email is verified in Firebase project settings.
- Ensure uploads directory is writable; attachments are stored under backend/uploads.
- This repository ignores node_modules and build artifacts.
- The OTP is not recieved in real time as the billing is not enabled so please avoid it or suggest some alternative to make it cost free.
- Use Email login process as its working completely.
