import { io } from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

let socket = null;
let currentUserId = null;

export const initializeSocket = (userId) => {
  currentUserId = String(userId || '');
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      transports: ['websocket'],
      timeout: 20000,
    });

    // Connection events
    socket.on('connect', () => {
      console.log('✅ Socket connected:', socket.id);
      if (currentUserId) {
        socket.emit('join', currentUserId);
        socket.emit('online', currentUserId);
      }
    });

    socket.on('disconnect', () => {
      console.log('❌ Socket disconnected');
    });

    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });

    socket.connect();
  } else {
    // Update the user context for future reconnects
    if (currentUserId && socket.connected) {
      socket.emit('join', currentUserId);
      socket.emit('online', currentUserId);
    }
  }

  return socket;
};

export const getSocket = () => socket;

export const disconnectSocket = () => {
  if (socket) {
    try { socket.emit('going-offline'); } catch {}
    socket.disconnect();
    socket = null;
    currentUserId = null;
  }
};

export default { initializeSocket, getSocket, disconnectSocket };
