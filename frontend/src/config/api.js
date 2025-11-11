import axios from 'axios';

// Backend API base URL
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests if available
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Gentle backoff for 429s to avoid user-facing failures when typing/searching
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    try {
      const status = error?.response?.status;
      const cfg = error?.config || {};
      if (status === 429) {
        cfg.__retryCount = (cfg.__retryCount || 0) + 1;
        if (cfg.__retryCount <= 3) {
          const delay = 400 * cfg.__retryCount; // 400ms, 800ms, 1200ms
          await new Promise((r) => setTimeout(r, delay));
          return api(cfg);
        }
      }
    } catch {}
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  sendOTP: (phoneNumber) => api.post('/auth/send-otp', { phoneNumber }),
  verifyFirebaseToken: (idToken) => api.post('/auth/verify-firebase-token', { idToken }),
  setupProfile: (profileData) => api.post('/auth/setup-profile', profileData),
  getMe: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
};

// Chat API
export const chatAPI = {
  getConversations: () => api.get('/chat/conversations'),
  getMessages: (userId, page = 1, limit = 50) => 
    api.get(`/chat/messages/${userId}?page=${page}&limit=${limit}`),
  sendMessage: (messageData) => api.post('/chat/send', messageData),
  deleteMessage: (messageId, deleteFor = 'me') => 
    api.delete(`/chat/${messageId}?deleteFor=${deleteFor}`),
  deleteConversation: (userId) => api.delete(`/chat/conversation/${userId}`),
  deleteConversationForAll: (userId) => api.delete(`/chat/conversation/${userId}?for=everyone`),
  addReaction: (messageId, emoji) => 
    api.post(`/chat/${messageId}/react`, { emoji }),
  searchUsers: (query) => api.get(`/chat/search-users?q=${query}`),
  blockUser: (peerId) => api.post('/chat/block', { peerId }),
  unblockUser: (peerId) => api.post('/chat/unblock', { peerId }),
  hideChat: (peerId, pin) => api.post('/chat/hide', { peerId, pin }),
  unhideChat: (peerId, pin) => api.post('/chat/unhide', { peerId, pin }),
  verifyPin: (pin) => api.post('/chat/verify-pin', { pin }),
  getHiddenConversations: (pin) => api.get(`/chat/hidden?pin=${encodeURIComponent(pin)}`),
  upload: (file) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/chat/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

export default api;
