📁 **Project Structure**

```
LetsChat/
├── backend/            Running on :5000
│   ├── Firebase Admin SDK
│   ├── MongoDB Connected
│   └── Socket.io Ready
│
└── frontend/           Running on :3000
    ├── src/
    │   ├── config/
    │   │   ├── firebase.js (Firebase Client)
    │   │   ├── api.js (Axios + Auth)
    │   │   └── socket.js (Socket.io)
    │   ├── context/
    │   │   └── AuthContext.js
    │   ├── pages/
    │   │   ├── PhoneInput.js + CSS
    │   │   ├── VerifyOTP.js + CSS
    │   │   ├── SetupProfile.js + CSS
    │   │   └── Chat.js + CSS
    │   └── App.js (Router)
    └── .env
```
