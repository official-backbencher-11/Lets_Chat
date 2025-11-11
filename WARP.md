# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Common dev commands
- Install deps
  - Backend: `npm --prefix backend install`
  - Frontend: `npm --prefix frontend install`
- Run in dev
  - Backend (nodemon): `npm --prefix backend run dev`
  - Frontend (CRA dev server): `npm --prefix frontend start`
- Build frontend: `npm --prefix frontend run build`
- Start backend (prod): `npm --prefix backend start`
- Run tests (frontend via CRA): `npm --prefix frontend test`
  - Single test example: `npm --prefix frontend test -- App.test.js -t "renders learn react link"`

## Environments
- Backend listens on `PORT` (default 5000), exposes `/health` and `/` JSON.
- Static uploads served from `backend/uploads` at `/uploads/*`.
- CORS origins are read from `ALLOWED_ORIGINS` (comma‑separated). Defaults include `http://localhost:3000`.
- Frontend reads:
  - `REACT_APP_API_URL` (e.g., `http://localhost:5000/api`)
  - `REACT_APP_SOCKET_URL` (e.g., `http://localhost:5000`)
  - `REACT_APP_EMAIL_CONTINUE_URL` (optional, for passwordless email)

## High‑level architecture
- Backend (Node.js + Express + MongoDB + Socket.io)
  - Entry: `backend/server.js` creates HTTP server + Socket.io and mounts routes under `/api`.
  - Routes:
    - `backend/routes/auth.js` – Firebase ID token verification (phone/email), JWT issuance, profile setup, current user, logout.
    - `backend/routes/chat.js` – conversations summary, paginated messages, send message, reactions, block/unblock, hide/unhide with 4‑digit PIN, delete message/conversation, file upload (multer) with links under `/uploads`.
  - Models:
    - `backend/models/User.js` – phone/email identifiers, presence (isOnline/lastSeen), hidden chat PIN (bcrypt), blocked users, profile.
    - `backend/models/Message.js` – sender/recipient, content, type, reactions, read/delivery status, soft‑delete markers; indexed for common queries.
  - Realtime:
    - Socket.io configured with CORS from `ALLOWED_ORIGINS`. Clients join their userId room. Events include `receive-message`, `message-delivered`, `messages-read`, presence (`user-online`/`user-offline`), typing, and deletion notifications.
  - Firebase Admin:
    - `backend/config/firebase.js` builds credentials from env (`FIREBASE_*`) and initializes the Admin SDK for verifying ID tokens.

- Frontend (React + CRA)
  - Config:
    - `frontend/src/config/api.js` – axios instance using `REACT_APP_API_URL`; exposes `authAPI` and `chatAPI` wrappers.
    - `frontend/src/config/socket.js` – Socket.io client using `REACT_APP_SOCKET_URL`; ensures join/online on connect and emits typing/read events.
    - `frontend/src/config/firebase.js` – Firebase web SDK initialization.
  - App flow:
    - `AuthContext` handles JWT storage, authentication state, and user bootstrap.
    - Pages: `PhoneInput` → `VerifyOTP` (obtain Firebase ID token) → server verifies and returns JWT → `SetupProfile` (first login) → `Chat` (REST + sockets for messaging, presence, read receipts, uploads).

## Linting/formatting/tests
- No repo‑level lint script. CRA includes ESLint in dev server. Frontend tests use Jest via CRA.

## Deployment overview
- Backend suitable for Render (Node Web Service). Set `MONGODB_URI`, `JWT_SECRET`, `ALLOWED_ORIGINS`, and `FIREBASE_*` envs. Health check path `/health`.
- Frontend suitable for Vercel. Root directory should be `frontend`, build command `npm run build`, output `build`. Set `REACT_APP_API_URL` and `REACT_APP_SOCKET_URL` to the Render backend URL.
