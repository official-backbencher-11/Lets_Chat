import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { authAPI, chatAPI } from '../config/api';
import { getSocket } from '../config/socket';
import './Chat.css';

const HISTORY_KEY = 'numberSearchHistory';

const Chat = () => {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState([]);
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState('');
  const [isNarrow, setIsNarrow] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));

  const [selectedUser, setSelectedUser] = useState(null);
  const selectedUserRef = useRef(null);
  const userIdRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  // Search-by-number states
  const [numberQuery, setNumberQuery] = useState('');
  const [numberLoading, setNumberLoading] = useState(false);
  const [numberError, setNumberError] = useState('');
  const [numberResults, setNumberResults] = useState([]);
  const [hiddenResults, setHiddenResults] = useState([]);
  const [history, setHistory] = useState(() => {
    try {
      const s = localStorage.getItem(HISTORY_KEY);
      return s ? JSON.parse(s) : [];
    } catch { return []; }
  });

  // Profile drawer states
  const [profileOpen, setProfileOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAbout, setEditAbout] = useState('');
  const [editPhoto, setEditPhoto] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const fileRef = useRef(null);

  // Attachments
  const attachRef = useRef(null);

  // Presence and typing
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerLastSeen, setPeerLastSeen] = useState(null);
  const [typing, setTyping] = useState(false);
  const typingTimeout = useRef(null);

  // Block / hide / delete chat
  const [isBlocked, setIsBlocked] = useState(false);
  const [pinPromptOpen, setPinPromptOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');

  // Full avatar viewer
  const [avatarOpen, setAvatarOpen] = useState(false);

  // Modals
  const [deleteChatModal, setDeleteChatModal] = useState(false);
  const [deleteChatMode, setDeleteChatMode] = useState('me');
  const [confirmModal, setConfirmModal] = useState({ open: false, title: '', body: '', onConfirm: null });

  const bottomRef = useRef(null);
  const messagesRef = useRef(null);
  const pollTimer = useRef(null);
  const seenMsgIds = useRef(new Set());
  const presenceTimer = useRef(null);

  // Handle responsive switch
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Fetch initial conversations
  useEffect(() => {
    let mounted = true;
    const run = async () => {
      setConvLoading(true);
      setConvError('');
      try {
        const res = await chatAPI.getConversations();
        if (!mounted) return;
        setConversations(res.data.conversations || []);
      } catch (e) {
        console.error('Failed to load conversations', e);
        if (!mounted) return;
        setConvError(e.response?.data?.message || 'Failed to load conversations');
      } finally {
        if (mounted) setConvLoading(false);
      }
    };
    run();
    return () => { mounted = false; };
  }, []);

  // Initialize profile drawer fields when opening
  useEffect(() => {
    if (profileOpen && user) {
      setEditName(user.name || '');
      setEditAbout(user.about || '');
      setEditPhoto(user.profilePicture || '');
    }
  }, [profileOpen, user]);

  // When selecting a conversation, set presence from conversation user
  useEffect(() => {
    const idEq = (a, b) => String(a) === String(b);
    if (selectedUser) {
      const conv = conversations.find(c => idEq(c.user._id || c.user.id, selectedUser.id));
      setPeerOnline(!!conv?.user?.isOnline);
      setPeerLastSeen(conv?.user?.lastSeen || null);
    } else {
      setPeerOnline(false);
      setPeerLastSeen(null);
    }
  }, [selectedUser, conversations]);

  // Keep live refs for stable callbacks
  useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);
  useEffect(() => { userIdRef.current = user?.id || null; }, [user]);

  // Load messages when selecting a conversation
  const loadMessages = useCallback(async (peerId, opts = {}) => {
    if (!peerId) return;
    const preserve = opts.scroll === 'preserve';
    const container = messagesRef.current;
    let prevTop = 0, prevHeight = 0;
    if (preserve && container) {
      prevTop = container.scrollTop;
      prevHeight = container.scrollHeight;
    }
    setMessagesLoading(true);
    setMessagesError('');
    try {
      const res = await chatAPI.getMessages(peerId);
      const mapped = (res.data.messages || []).map((m) => ({
        _id: m._id,
        from: m.sender?._id || m.sender,
        to: m.recipient?._id || m.recipient,
        type: m.messageType || m.type || 'text',
        content: m.content,
        createdAt: m.createdAt,
        status: m.status || 'sent',
      }));
      // seed dedupe set
      try { mapped.forEach(mm => seenMsgIds.current.add(String(mm._id))); } catch {}
      setMessages(mapped);
      // After loading, confirm read to peer (ensures blue ticks without refresh)
      try { const uid = String(userIdRef.current || ''); if (uid) { getSocket()?.emit('mark-read', { userId: uid, peerId: String(peerId) }); } } catch {}
      // Scroll behavior: preserve position if requested, otherwise go bottom
      if (preserve && container) {
        requestAnimationFrame(() => {
          const newHeight = container.scrollHeight;
          const targetTop = Math.max(0, prevTop - (prevHeight - newHeight));
          container.scrollTop = targetTop;
        });
      } else {
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 0);
      }
    } catch (e) {
      console.error('Failed to load messages', e);
      setMessagesError(e.response?.data?.message || 'Failed to load messages');
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  // Ensure we are in our user room (in case of missed join)
  useEffect(() => {
    try { const s = getSocket(); if (s?.connected && user?.id) { s.emit('join', String(user.id)); s.emit('online', String(user.id)); } } catch {}
  }, [user]);

  // Socket listeners for incoming messages & presence
  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    if (!socket) return;

    const idEq = (a, b) => String(a) === String(b);

    const onMessage = (msg) => {
      // Dedupe by message id
      if (msg?._id && seenMsgIds.current.has(String(msg._id))) return;
      if (msg?._id) seenMsgIds.current.add(String(msg._id));
      // If the message is for the active chat, append; otherwise update conversations list
      const peerId = msg.from === user.id ? msg.to : msg.from;
      if (selectedUser && peerId === selectedUser.id) {
        setMessages((prev) => [...prev, msg]);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 0);
      }
      // Move conversation to top or add if new
      setConversations((prev) => {
        const others = prev.filter((c) => (c.user._id || c.user.id) !== peerId);
        const existing = prev.find((c) => (c.user._id || c.user.id) === peerId) || { user: { _id: peerId } };
        return [{ ...existing, lastMessage: { content: msg.content, createdAt: msg.createdAt, sender: msg.from } }, ...others];
      });
    };

    socket.on('message', onMessage);
    socket.on('receive-message', (payload) => {
      const id = payload.messageId || `recv-${Date.now()}`;
      if (id && seenMsgIds.current.has(String(id))) return;
      const msg = {
        _id: id,
        from: payload.senderId,
        to: selectedUser?.id === payload.senderId ? user.id : payload.recipientId,
        type: 'text',
        content: payload.message,
        createdAt: payload.timestamp || new Date().toISOString(),
        status: 'delivered',
      };
      onMessage(msg);
      // If the chat is open, immediately mark as read
      try {
        if (selectedUser && String(payload.senderId) === String(selectedUser.id)) {
          getSocket()?.emit('mark-read', { userId: String(user.id), peerId: String(selectedUser.id) });
        }
      } catch {}
    });

    // Delivery acknowledgment
    socket.on('message-delivered', ({ messageId }) => {
      if (!messageId) return;
      let matched = false;
      setMessages((prev) => prev.map(m => {
        if (String(m._id) === String(messageId)) { matched = true; return { ...m, status: (m.status === 'read' ? 'read' : 'delivered') }; }
        return m;
      }));
      // Fallback: if not matched (race), mark the latest outgoing unsent as delivered
      if (!matched && selectedUser) {
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            const m = next[i];
            if (m.from === user.id && m.to === selectedUser.id && m.status !== 'delivered' && m.status !== 'read') {
              next[i] = { ...m, status: 'delivered' };
              break;
            }
          }
          return next;
        });
      }
    });

    // Read receipts
    socket.on('messages-read', ({ userId, peerId }) => {
      // The reader (userId) has read messages from peerId (sender)
      // If current chat is with that reader, update my outgoing messages to read
      if (!selectedUser || (selectedUser.id !== userId && selectedUser.id !== peerId)) return;
      setMessages((prev) => prev.map(m => (m.from === user.id ? { ...m, status: 'read' } : m)));
    });

    // Conversation deleted for everyone
    socket.on('conversation-deleted', ({ by, peerId, mode }) => {
      if (mode !== 'everyone') return;
      if (selectedUser && (String(selectedUser.id) === String(by) || String(selectedUser.id) === String(peerId))) {
        // Close the active chat and clear messages to reflect deletion
        setMessages([]);
        setSelectedUser(null);
      }
      chatAPI.getConversations().then(res => setConversations(res.data?.conversations || [])).catch(()=>{});
    });


    // Typing indicator
    socket.on('user-typing', ({ userId, isTyping }) => {
      if (!selectedUser || userId !== selectedUser.id) return;
      setTyping(!!isTyping);
      if (isTyping) {
        if (typingTimeout.current) clearTimeout(typingTimeout.current);
        typingTimeout.current = setTimeout(() => setTyping(false), 2500);
      }
    });

    // Online presence
    socket.on('user-online', (userId) => {
      setConversations((prev) => prev.map(c => ( idEq(c.user._id || c.user.id, userId) ? { ...c, user: { ...c.user, isOnline: true } } : c )));
      if (selectedUser && idEq(selectedUser.id, userId)) setPeerOnline(true);
    });
    socket.on('user-offline', ({ userId, lastSeen }) => {
      setConversations((prev) => prev.map(c => ( idEq(c.user._id || c.user.id, userId) ? { ...c, user: { ...c.user, isOnline: false, lastSeen } } : c )));
      if (selectedUser && idEq(selectedUser.id, userId)) { setPeerOnline(false); setPeerLastSeen(lastSeen); }
    });

    return () => {
      socket.off?.('message', onMessage);
      socket.off?.('receive-message');
      socket.off?.('message-delivered');
      socket.off?.('messages-read');
      socket.off?.('conversation-deleted');
      socket.off?.('user-typing');
      socket.off?.('user-online');
      socket.off?.('user-offline');
    };
  }, [user, selectedUser, setMessages, setConversations]);

  // Stable socket listeners for delete events (not dependent on selectedUser rebinds)
  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    if (!socket) return;

    const onMsgDeleted = async ({ messageId, remove, senderId, recipientId }) => {
      try { console.log('[socket] message-deleted', { messageId, remove, senderId, recipientId }); } catch {}
      if (!messageId) return;
      if (remove) {
        setMessages(prev => prev.filter(m => String(m._id) !== String(messageId)));
      } else {
        setMessages(prev => prev.map(m => (String(m._id) === String(messageId) ? { ...m, content: 'This message was deleted', fileUrl: '', fileName: '' } : m)));
      }
      // Aggressive refresh of active chat to guarantee consistency if this peer is selected
      const current = selectedUserRef.current;
      const peerId = (String(senderId) === String(user.id)) ? String(recipientId) : String(senderId);
      try { if (current?.id && (!peerId || String(current.id) === String(peerId))) { await loadMessages(current.id, { scroll: 'preserve' }); } } catch {}
      // Refresh conversations to update preview
      try { const res = await chatAPI.getConversations(); setConversations(res.data?.conversations || []); } catch {}
    };

    const onRefresh = async ({ peerId }) => {
      try { console.log('[socket] refresh-messages', { peerId }); } catch {}
      const current = selectedUserRef.current;
      try { if (current?.id && String(current.id) === String(peerId)) { await loadMessages(current.id, { scroll: 'preserve' }); } } catch {}
    };

    socket.on('message-deleted', onMsgDeleted);
    socket.on('refresh-messages', onRefresh);
    return () => {
      socket.off?.('message-deleted', onMsgDeleted);
      socket.off?.('refresh-messages', onRefresh);
    };
  }, [user, loadMessages]);

  // Periodic status polling to ensure eventual consistency (handles missed events/background tabs)
  useEffect(() => {
    if (!selectedUser) return;
    const run = async () => {
      if (document.hidden) return;
      try {
        const res = await chatAPI.getMessages(selectedUser.id, 1, 20);
        const latest = res.data?.messages || [];
        const byId = new Map(latest.map(m => [String(m._id), m]));
        setMessages((prev) => prev.map(m => {
          const srv = byId.get(String(m._id));
          if (!srv) return m;
          const srvStatus = srv.status || m.status;
          if (srvStatus !== m.status) return { ...m, status: srvStatus };
          return m;
        }));
      } catch {}
    };
    pollTimer.current = setInterval(run, 8000);
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  }, [selectedUser]);

  // Ensure reads are sent when returning to the tab/window
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      if (selectedUser) {
        try { getSocket()?.emit('mark-read', { userId: String(user.id), peerId: String(selectedUser.id) }); } catch {}
      }
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [selectedUser, user]);

  // Global click to close any open message menu (failsafe)
  useEffect(() => {
    const handler = () => setOpenMsgMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  // Proactively announce going offline to get immediate lastSeen updates
  useEffect(() => {
    const onBeforeUnload = () => {
      try { getSocket()?.emit('going-offline'); } catch {}
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Presence fallback polling (updates isOnline/lastSeen if socket events were missed)
  useEffect(() => {
    if (!selectedUser) return;
    const run = async () => {
      try {
        if (selectedUser.phoneNumber) {
          const res = await chatAPI.searchUsers(selectedUser.phoneNumber);
          const u = (res.data?.users || []).find(x => String(x.phoneNumber).replace(/\D/g,'') === String(selectedUser.phoneNumber).replace(/\D/g,''));
          if (u) {
            setPeerOnline(!!u.isOnline);
            if (!u.isOnline && u.lastSeen) setPeerLastSeen(u.lastSeen);
            // update conversations cache
            setConversations(prev => prev.map(c => (String(c.user._id || c.user.id) === String(u._id || u.id) ? { ...c, user: { ...c.user, isOnline: !!u.isOnline, lastSeen: u.lastSeen } } : c)));
          }
        } else {
          const res = await chatAPI.getConversations();
          const convs = res.data?.conversations || [];
          const conv = convs.find(c => String(c.user._id || c.user.id) === String(selectedUser.id));
          if (conv) {
            setPeerOnline(!!conv.user?.isOnline);
            if (!conv.user?.isOnline && conv.user?.lastSeen) setPeerLastSeen(conv.user.lastSeen);
            setConversations(convs);
          }
        }
      } catch {}
    };
    presenceTimer.current = setInterval(run, 8000);
    return () => { if (presenceTimer.current) clearInterval(presenceTimer.current); };
  }, [selectedUser, setConversations]);


  const handleSelect = async (c) => {
    const u = c.user;
    const normalized = { id: String(u._id || u.id), name: u.name, profilePicture: u.profilePicture, phoneNumber: u.phoneNumber };
    setSelectedUser(normalized);
    await loadMessages(normalized.id);
    // Notify peer their messages are read
    try { getSocket()?.emit('mark-read', { userId: String(user.id), peerId: normalized.id }); } catch {}
  };

  // Search users by phone number
  const persistHistory = (num) => {
    try {
      const n = num.trim();
      if (!n) return;
      const next = [n, ...history.filter((x) => x !== n)].slice(0, 2);
      setHistory(next);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {}
  };

  const searchByNumber = async (num) => {
    const q = (num || numberQuery).trim();
    if (!q) return;
    setNumberError('');
    setHiddenResults([]);
    setNumberResults([]);
    setNumberLoading(true);
    try {
      if (/^\d{4}$/.test(q)) {
        // Show hidden conversations with PIN
        const res = await chatAPI.getHiddenConversations(q);
        const convs = res.data?.conversations || [];
        if (convs.length === 0) {
          setNumberError('No hidden chats');
          setHiddenResults([]);
        } else {
          setHiddenResults(convs);
        }
        setNumberLoading(false);
        return;
      }
      const res = await chatAPI.searchUsers(q);
      const list = res.data.users || res.data || [];
      if (list.length > 0) {
        setNumberResults(list);
        persistHistory(q);
      } else {
        setNumberError('No user found');
      }
    } catch (e) {
      console.error('Search error', e);
      setNumberError(e.response?.data?.message || 'Search failed');
    } finally {
      setNumberLoading(false);
    }
  };

  const openChatWithUser = async (u) => {
    if (!u) return;
    const normalized = { id: String(u.id || u._id), name: u.name, profilePicture: u.profilePicture, phoneNumber: u.phoneNumber };
    setSelectedUser(normalized);
    await loadMessages(normalized.id);
  };

  const handleSend = async (e) => {
    e?.preventDefault?.();
    if (!selectedUser || !input.trim() || sending) return;
    const text = input.trim();

    // Optimistic message
    const tempId = `temp-${Date.now()}`;
    const optimistic = {
      _id: tempId,
      from: user.id,
      to: selectedUser.id,
      type: 'text',
      content: text,
      createdAt: new Date().toISOString(),
      status: 'sending',
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput('');
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 0);

    try {
      setSending(true);
      // Persist to backend (uses recipientId/messageType keys expected by API)
      const res = await chatAPI.sendMessage({ recipientId: selectedUser.id, content: text, messageType: 'text' });
      const m = res.data?.data || res.data?.message || {};
      const saved = {
        _id: m._id || `srv-${Date.now()}`,
        from: m.sender?._id || m.sender || user.id,
        to: m.recipient?._id || m.recipient || selectedUser.id,
        type: m.messageType || 'text',
        content: m.content || text,
        createdAt: m.createdAt || new Date().toISOString(),
        status: m.status || 'sent',
      };
      setMessages((prev) => prev.map((msg) => (msg._id === tempId ? saved : msg)));

      // No client-side emit; server REST already notifies via socket

      // Move/insert conversation to top
      setConversations((prev) => {
        const others = prev.filter((c) => (c.user._id || c.user.id) !== selectedUser.id);
        const existing = prev.find((c) => (c.user._id || c.user.id) === selectedUser.id) || { user: { _id: selectedUser.id, name: selectedUser.name, profilePicture: selectedUser.profilePicture } };
        return [{ ...existing, lastMessage: { content: text, createdAt: saved.createdAt } }, ...others];
      });
    } catch (e) {
      console.error('Send failed', e);
      setMessages((prev) => prev.map((m) => (m._id === tempId ? { ...m, status: 'failed' } : m)));
    } finally {
      setSending(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const [openMsgMenu, setOpenMsgMenu] = useState(null);
  const showSidebar = !isNarrow || !selectedUser;
  const showChat = !isNarrow || !!selectedUser;

  return (
    <div className="chat-container">
      <div className="chat-sidebar" style={{ display: showSidebar ? 'flex' : 'none' }}>
        <div className="sidebar-header">
          <h2>💬 LetsChat</h2>
          <button onClick={handleLogout} className="logout-btn">Logout</button>
        </div>

        <div className="user-profile">
          <div className="user-avatar" style={{cursor:'pointer'}} onClick={() => setProfileOpen(true)}>
            {user?.profilePicture ? (
              <img src={user.profilePicture} alt="avatar" style={{width:'100%',height:'100%',borderRadius:'50%',objectFit:'cover'}} />
            ) : (
              (user?.name?.charAt(0).toUpperCase() || '?')
            )}
          </div>
          <div className="user-info">
            <h3>{user?.name}</h3>
            <p>{user?.about || 'Hey there! I am using LetsChat.'}</p>
          </div>
        </div>


        <div className="number-search">
          <div className="row">
            <input
              type="tel"
              placeholder="Search user by name or phone number"
              value={numberQuery}
              onChange={(e) => setNumberQuery(e.target.value)}
            />
            <button onClick={() => searchByNumber() } disabled={numberLoading}>
              {numberLoading ? 'Searching…' : 'Search'}
            </button>
          </div>
          {numberError && <div className="error-message" style={{marginTop:6}}>{numberError}</div>}
          {numberResults && numberResults.length > 0 && (
            <div style={{marginTop:6}}>
              {numberResults.slice(0,10).map((u) => (
                <button key={u._id || u.id} className="conversation-item" onClick={() => openChatWithUser(u)}>
                  <div className="user-avatar small">
                    {u.profilePicture ? (
                      <img src={u.profilePicture} alt="avatar" style={{width:'100%',height:'100%',borderRadius:'50%',objectFit:'cover'}} />
                    ) : ((u.name || u.phoneNumber || '?').charAt(0).toUpperCase())}
                  </div>
                  <div className="conv-meta">
                    <div className="conv-name">{u.name || u.phoneNumber}</div>
                    <div className="conv-last">Tap to chat</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Hidden chat results */}
          {hiddenResults.length > 0 && (
            <div style={{marginTop:10}}>
              {hiddenResults.map((c) => (
                <div key={c.user._id} className="conversation-item" style={{justifyContent:'space-between'}}>
                  <div style={{display:'flex', alignItems:'center', gap:12}}>
                    <div className="user-avatar small">
                      {c.user.profilePicture ? (
                        <img src={c.user.profilePicture} alt="avatar" style={{width:'100%',height:'100%',borderRadius:'50%',objectFit:'cover'}} />
                      ) : (
                        (c.user.name || '?').charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="conv-meta">
                      <div className="conv-name">{c.user.name || c.user.phoneNumber}</div>
                      <div className="conv-last">{c.lastMessage?.content || ''}</div>
                    </div>
                  </div>
                  <div style={{display:'flex', gap:8}}>
                    <button className="profile-save" onClick={() => openChatWithUser({ id: c.user._id, name: c.user.name, profilePicture: c.user.profilePicture, phoneNumber: c.user.phoneNumber })}>Open</button>
                    <button className="profile-cancel" onClick={async ()=>{ try { await chatAPI.unhideChat(c.user._id, numberQuery); const left = hiddenResults.filter(x => x.user._id !== c.user._id); setHiddenResults(left); const convs = await chatAPI.getConversations(); setConversations(convs.data?.conversations || []); } catch(e){ console.error(e);} }}>Unhide</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {history?.length > 0 && (
            <div className="history-chips">
              {history.map((h) => (
                <span key={h} className="history-chip" onClick={() => { setNumberQuery(h); searchByNumber(h); }}>{h}</span>
              ))}
            </div>
          )}
        </div>

        <div className="conversations-list">
          {convLoading && <div className="empty-state">Loading conversations…</div>}
          {convError && <div className="error-message">{convError}</div>}
          {!convLoading && !convError && conversations.length === 0 && (
            <div className="empty-state">
              <p>🎉 Welcome to LetsChat!</p>
              <p>Start a conversation by searching for users above</p>
            </div>
          )}
          {!convLoading && !convError && conversations.map((c) => (
            <button
              key={c.user._id || c.user.id}
              className={`conversation-item ${selectedUser?.id === (c.user._id || c.user.id) ? 'active' : ''}`}
              onClick={() => handleSelect(c)}
            >
              <div className="user-avatar small">
                {c.user.profilePicture ? (
                  <img src={c.user.profilePicture} alt="avatar" style={{width:'100%',height:'100%',borderRadius:'50%',objectFit:'cover'}} />
                ) : (
                  (c.user.name || '?').charAt(0).toUpperCase()
                )}
              </div>
              <div className="conv-meta">
                <div className="conv-name">{c.user.name || 'Unknown'}</div>
                <div className="conv-last">{c.lastMessage?.content || ''}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="chat-main" style={{ display: showChat ? 'flex' : 'none' }}>
        {!selectedUser ? (
          <div className="empty-chat">
            <h2>💬</h2>
            <p>Select a conversation to start chatting</p>
          </div>
        ) : (
          <div className="chat-panel">
            <div className="chat-header">
              {isNarrow && (
                <button className="back-btn" onClick={() => setSelectedUser(null)} aria-label="Back">←</button>
              )}
              <div className="user-avatar small" style={{cursor:'pointer'}} onClick={() => setAvatarOpen(true)}>
                {selectedUser?.profilePicture ? (
                  <img src={selectedUser.profilePicture} alt="avatar" style={{width:'100%',height:'100%',borderRadius:'50%',objectFit:'cover'}} />
                ) : (
                  (selectedUser.name || '?').charAt(0).toUpperCase()
                )}
              </div>
              <div style={{flex:1}}>
                <div className="conv-name">{selectedUser.name || selectedUser.phoneNumber}</div>
                <div className="conv-last">
                  {typing ? 'typing…' : (peerOnline ? 'online' : (peerLastSeen ? `last seen ${new Date(peerLastSeen).toLocaleString()}` : ''))}
                </div>
              </div>
              {/* Header actions */}
              <div>
                <button className="profile-cancel" onClick={()=>{ setDeleteChatMode('me'); setDeleteChatModal(true); }}>Delete chat</button>
                <button className="profile-cancel" onClick={()=> setPinPromptOpen(true)}>Hide chat</button>
                {isBlocked ? (
                  <button className="profile-save" onClick={async ()=>{ try { await chatAPI.unblockUser(selectedUser.id); setIsBlocked(false);} catch(e){console.error(e);} }}>Unblock</button>
                ):(
                  <button className="profile-save" onClick={async ()=>{ try { await chatAPI.blockUser(selectedUser.id); setIsBlocked(true);} catch(e){console.error(e);} }}>Block</button>
                )}
              </div>
            </div>

            <div className="messages" ref={messagesRef} style={{ overflowY: 'auto' }} onClick={()=> setOpenMsgMenu(null)}>
              {messagesLoading && <div className="empty-state">Loading messages…</div>}
              {messagesError && <div className="error-message">{messagesError}</div>}
              {!messagesLoading && messages.map((m) => {
                const mine = m.from === user.id;
                const isImage = (m.type || '').startsWith('image');
                const isDoc = (m.type || '') === 'document' || (!!m.fileUrl && !isImage);
                return (
                  <div key={m._id} className={`message-row ${mine ? 'mine' : 'theirs'}`}>
                    <div className={`message-bubble ${m.status === 'failed' ? 'failed' : ''}`}>
                      {/* content */}
                      {isImage && m.fileUrl ? (
                        <a href={m.fileUrl} target="_blank" rel="noreferrer">
                          <img alt={m.fileName || 'image'} src={m.fileUrl} style={{maxWidth:'260px', borderRadius:8}} />
                        </a>
                      ) : isDoc && m.fileUrl ? (
                        <div>
                          <div className="message-text">{m.content || m.fileName}</div>
                          <a href={m.fileUrl} download target="_blank" rel="noreferrer">Download</a>
                        </div>
                      ) : (
                        <div className="message-text">{m.content}</div>
                      )}
                      <div className="message-meta" style={{display:'flex', alignItems:'center', gap:6, position:'relative'}}>
                        <button className="profile-cancel" onClick={(e)=>{
                          e.stopPropagation(); setOpenMsgMenu(prev => prev === m._id ? null : m._id);
                        }}>⋯</button>
                        {openMsgMenu === m._id && (
                          <div className="message-actions" onClick={(e)=> e.stopPropagation()}>
                            <button onClick={async ()=>{ try { await chatAPI.deleteMessage(m._id, 'me'); setOpenMsgMenu(null); setMessages(prev => prev.filter(x => x._id !== m._id)); } catch(e){console.error(e);} }}>Delete for me</button>
                            {mine && <button onClick={()=>{
                              setOpenMsgMenu(null);
                              setConfirmModal({ open: true, title: 'Delete for everyone?', body: 'This will delete the message for both participants.', onConfirm: async ()=>{ try { await chatAPI.deleteMessage(m._id, 'everyone'); setMessages(prev => prev.filter(x => String(x._id) !== String(m._id))); } catch(e){ console.error(e);} } });
                            }}>Delete for everyone</button>}
                          </div>
                        )}
                        <span>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {mine && (
                          <span className={`message-status ${m.status === 'read' ? 'blue double' : (m.status === 'delivered' ? 'double' : '')}`} title={m.status || ''}>
                            {m.status === 'sending' ? '…' : m.status === 'read' ? '✓✓' : (m.status === 'delivered' ? '✓✓' : '✓')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            <form className="input-bar" onSubmit={handleSend}>
              <button type="button" className="profile-cancel" onClick={()=> attachRef.current?.click()}>📎</button>
              <input ref={attachRef} type="file" style={{display:'none'}} onChange={async (e)=>{
                const f = e.target.files?.[0]; if (!f || !selectedUser) return;
                try {
                  const up = await chatAPI.upload(f);
                  const file = up.data?.file || {};
                  const type = (file.mimeType || '').startsWith('image/') ? 'image' : 'document';
                  await chatAPI.sendMessage({ recipientId: selectedUser.id, content: file.fileName || f.name, messageType: type, fileUrl: file.url, fileName: file.fileName || f.name });
                  // refresh messages head
                  await loadMessages(selectedUser.id);
                } catch(err){ console.error(err);} finally { e.target.value = ''; }
              }} />
              <input
                type="text"
                placeholder="Type a message"
                value={input}
                onChange={(e) => {
                  const v = e.target.value;
                  setInput(v);
                  try {
                    if (!selectedUser) return;
                    const sock = getSocket();
                    sock?.emit('typing', { senderId: user.id, recipientId: selectedUser.id, isTyping: !!v });
                  } catch {}
                }}
                disabled={!selectedUser || isBlocked}
              />
              <button type="submit" disabled={!selectedUser || sending || !input.trim() || isBlocked}>
                Send
              </button>
            </form>
          </div>
        )}
      </div>
      {profileOpen && (
        <div className="profile-overlay" onClick={() => setProfileOpen(false)}>
          <div className="profile-drawer" onClick={(e) => e.stopPropagation()}>
            <h3>Your Profile</h3>
            <div className="profile-avatar-picker">
              <img className="profile-avatar" src={editPhoto || user?.profilePicture || ''} alt="avatar" onError={(e)=>{e.target.style.display='none'}} />
              <div>
                <button className="profile-cancel" onClick={() => fileRef.current?.click()}>Change Photo</button>
                {editPhoto && <button className="profile-cancel" onClick={() => setEditPhoto('')}>Remove</button>}
                <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={async (e)=>{
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const reader = new FileReader();
                  reader.onload = () => setEditPhoto(reader.result);
                  reader.readAsDataURL(f);
                }} />
              </div>
            </div>
            <div className="profile-field">
              <label>Name</label>
              <input value={editName} onChange={(e)=>setEditName(e.target.value)} maxLength={50} />
            </div>
            <div className="profile-field">
              <label>About</label>
              <textarea value={editAbout} onChange={(e)=>setEditAbout(e.target.value)} rows={3} maxLength={140} />
            </div>
            {profileError && <div className="error-message" style={{marginBottom:10}}>{profileError}</div>}
            <div className="profile-actions">
              <button className="profile-save" disabled={profileSaving} onClick={async ()=>{
                try {
                  setProfileError('');
                  setProfileSaving(true);
                  const res = await authAPI.setupProfile({ name: editName.trim(), about: editAbout.trim(), profilePicture: editPhoto || undefined });
                  if (res.data?.success) { updateUser(res.data.user); setProfileOpen(false); }
                  else setProfileError(res.data?.message || 'Failed to save profile');
                } catch(err) { console.error(err); setProfileError(err.response?.data?.message || 'Failed to save profile'); }
                finally { setProfileSaving(false); }
              }}>{profileSaving ? 'Saving…' : 'Save'}</button>
              <button className="profile-cancel" onClick={()=>setProfileOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Full avatar viewer */}
      {avatarOpen && selectedUser?.profilePicture && (
        <div className="profile-overlay" onClick={()=> setAvatarOpen(false)}>
          <div className="profile-drawer" style={{width:'auto', height:'auto'}} onClick={(e)=> e.stopPropagation()}>
            <img src={selectedUser.profilePicture} alt="avatar" style={{maxWidth:'90vw', maxHeight:'90vh', objectFit:'contain', borderRadius:8}} />
          </div>
        </div>
      )}

      {/* Delete chat modal */}
      {deleteChatModal && (
        <div className="modal-overlay" onClick={()=> setDeleteChatModal(false)}>
          <div className="modal" onClick={(e)=> e.stopPropagation()}>
            <h3>Delete chat</h3>
            <p>Choose how you want to delete this conversation.</p>
            <div className="modal-radio">
              <input id="del-me" type="radio" name="delmode" checked={deleteChatMode==='me'} onChange={()=> setDeleteChatMode('me')} />
              <label htmlFor="del-me">Delete for me</label>
            </div>
            <div className="modal-radio">
              <input id="del-all" type="radio" name="delmode" checked={deleteChatMode==='everyone'} onChange={()=> setDeleteChatMode('everyone')} />
              <label htmlFor="del-all">Delete for everyone</label>
            </div>
            <div className="modal-actions">
              <button className="profile-cancel" onClick={()=> setDeleteChatModal(false)}>Cancel</button>
              <button className="profile-save" onClick={async ()=>{
                try {
                  if (deleteChatMode==='everyone') {
                    await chatAPI.deleteConversationForAll(selectedUser.id);
                  } else {
                    await chatAPI.deleteConversation(selectedUser.id);
                  }
                  // Close the view and refresh
                  setMessages([]);
                  setSelectedUser(null);
                  // Refresh conversations after delete
                  try { const res = await chatAPI.getConversations(); setConversations(res.data?.conversations || []); } catch {}
                } catch(e){ console.error(e);} finally { setDeleteChatModal(false); }
              }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {confirmModal.open && (
        <div className="modal-overlay" onClick={()=> setConfirmModal({ ...confirmModal, open:false })}>
          <div className="modal" onClick={(e)=> e.stopPropagation()}>
            <h3>{confirmModal.title}</h3>
            <p>{confirmModal.body}</p>
            <div className="modal-actions">
              <button className="profile-cancel" onClick={()=> setConfirmModal({ ...confirmModal, open:false })}>Cancel</button>
              <button className="profile-save" onClick={async ()=>{ try { await confirmModal.onConfirm?.(); } finally { setConfirmModal({ ...confirmModal, open:false }); } }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Hide chat PIN prompt */}
      {pinPromptOpen && (
        <div className="profile-overlay" onClick={()=> setPinPromptOpen(false)}>
          <div className="profile-drawer" onClick={(e)=> e.stopPropagation()}>
            <h3>Hide this chat</h3>
            <div className="profile-field">
              <label>Enter 4-digit PIN</label>
              <input maxLength={4} value={pinInput} onChange={(e)=> setPinInput(e.target.value.replace(/\D/g,''))} />
            </div>
            <div className="profile-actions">
              <button className="profile-save" disabled={pinInput.length!==4} onClick={async ()=>{
                try { await chatAPI.hideChat(selectedUser.id, pinInput); setPinPromptOpen(false); setPinInput(''); setSelectedUser(null);} catch(err){ console.error(err);} 
              }}>Hide</button>
              <button className="profile-cancel" onClick={()=> setPinPromptOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;
