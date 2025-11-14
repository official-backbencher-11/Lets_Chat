const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { version } = require('./package.json');
const Message = require('./models/Message');
const User = require('./models/User');
const path = require('path');

const allowedOrigins = (process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
  : ["http://localhost:3000", "https://letschat-frontend.vercel.app"]);

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});
// Make io available to routes for server-side emits
app.set('io', io);

// MongoDB Connection with better error handling
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/letschat', {
  serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
})
  .then(() => {
    console.log('✅ MongoDB Connected Successfully');
    console.log('💾 Database:', mongoose.connection.name);
  })
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err.message);
    console.log('⚠️  Server running without database connection');
  });

// Handle MongoDB connection events
mongoose.connection.on('connected', () => {
  console.log('🔗 Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ Mongoose connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.log('🔌 Mongoose disconnected from MongoDB');
});

// Middleware
app.set('trust proxy', 1);
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(helmet({
  // Allow assets like images to be loaded from this backend by the frontend running on a different origin (e.g. :3000)
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
// Increase JSON/body limits to allow small base64 avatars from Setup Profile
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));

// Basic rate limiting (apply only to chat routes to avoid interfering with OTP/verify)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
// Import Routes
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
// Use Routes
app.use('/api/auth', authRoutes);
// Remove rate limiting on chat routes to avoid 429 during normal app usage
app.use('/api/chat', chatRoutes);

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Root route
try {
  const admin = require('./config/firebase');
  console.log('🔥 Firebase Admin SDK initialized for project:', admin.app().options.projectId);
} catch (error) {
  console.error('❌ Firebase initialization error:', error.message);
}

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'LetsChat Backend Server is running!',
    version,
    status: 'OK'
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'
  });
});

// Socket.io connection handling
const onlineUsers = new Map(); // userId -> socketId
io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  
  // Join user to their room
  socket.on('join', async (userId) => {
    try {
      socket.userId = String(userId);
      onlineUsers.set(String(userId), socket.id);
      socket.join(String(userId));
      // Mark online in DB and broadcast
      await User.findByIdAndUpdate(userId, { isOnline: true }, { new: false });
      socket.broadcast.emit('user-online', String(userId));
      console.log(`User ${userId} joined room`);
    } catch (e) {
      console.error('join error:', e.message);
    }
  });
  
  // Handle sending messages
  socket.on('send-message', (data) => {
    const { recipientId, message, senderId, timestamp } = data;
    
    // Send message to recipient
    socket.to(recipientId).emit('receive-message', {
      senderId,
      message,
      timestamp,
      status: 'delivered'
    });
    
    // Confirm delivery to sender
    socket.emit('message-delivered', {
      messageId: data.messageId,
      status: 'delivered'
    });
  });
  
  // Handle typing indicators
  socket.on('typing', (data) => {
    socket.to(data.recipientId).emit('user-typing', {
      userId: data.senderId,
      isTyping: data.isTyping
    });
  });

  // Mark messages as read notification (peer real-time update + persist)
  socket.on('mark-read', async (data) => {
    try {
      const { userId, peerId, timestamp } = data || {};
      if (!userId || !peerId) return;
      // Persist to DB so it stays blue without refresh
      await Message.updateMany(
        { sender: peerId, recipient: userId, status: { $ne: 'read' } },
        { status: 'read' }
      );
      // Notify the sender in real time
      socket.to(peerId).emit('messages-read', {
        userId, // the reader
        peerId,
        timestamp: timestamp || new Date().toISOString(),
      });
    } catch (e) {
      console.error('mark-read error:', e.message);
    }
  });
  
  // Handle online status
  socket.on('online', (userId) => {
    socket.broadcast.emit('user-online', userId);
  });
  
  // Proactive offline when tab is closing
  socket.on('going-offline', async () => {
    try {
      const uid = socket.userId;
      if (uid) {
        const lastSeen = new Date();
        await User.findByIdAndUpdate(uid, { isOnline: false, lastSeen });
        socket.broadcast.emit('user-offline', { userId: String(uid), lastSeen });
      }
    } catch (e) {
      console.error('going-offline error:', e.message);
    }
  });

  socket.on('disconnect', async () => {
    console.log('❌ User disconnected:', socket.id);
    try {
      const uid = socket.userId;
      if (uid) {
        onlineUsers.delete(String(uid));
        const lastSeen = new Date();
        await User.findByIdAndUpdate(uid, { isOnline: false, lastSeen });
        socket.broadcast.emit('user-offline', { userId: String(uid), lastSeen });
      }
    } catch (e) {
      console.error('disconnect update error:', e.message);
    }
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 LetsChat Production Server running on port ${PORT}`);
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`${signal} received: closing server...`);
  server.close(() => {
    console.log('HTTP server closed.');
    mongoose.connection.close(false).then(() => {
      console.log('MongoDB connection closed.');
      process.exit(0);
    }).catch(() => process.exit(0));
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
