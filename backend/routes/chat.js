const express = require('express');
const mongoose = require('mongoose');
const Message = require('../models/Message');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Get all chats for user
router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    // Load fresh hidden peers from DB to avoid any stale request-scoped user
    const meDoc = await User.findById(userId).select('hidden.peers');
    const hiddenList = (meDoc?.hidden?.peers || []);
    const hiddenPeers = hiddenList.map((id) => (typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id));
    const hiddenPeerStrs = hiddenList.map((id) => String(id));

    // Get all unique conversations (exclude hidden peers)
    const conversations = await Message.aggregate([
      {
        $match: {
          $or: [
            { sender: userId },
            { recipient: userId }
          ],
          isDeleted: false
        }
      },
      // Early exclude any messages involving hidden peers (both directions)
      {
        $match: {
          sender: { $nin: hiddenPeers },
          recipient: { $nin: hiddenPeers }
        }
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $group: {
          _id: {
            $cond: [
              { $eq: ['$sender', userId] },
              '$recipient',
              '$sender'
            ]
          },
          lastMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$recipient', userId] },
                    { $ne: ['$status', 'read'] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      // Exclude hidden peers from the result set (supports both ObjectId and string forms)
      {
        $match: { _id: { $nin: hiddenPeers } }
      },
      {
        $addFields: { _idStr: { $toString: '$_id' } }
      },
      {
        $match: { _idStr: { $nin: hiddenPeerStrs } }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: '$user'
      },
      {
        $project: {
          _id: 1,
          user: {
            _id: '$user._id',
            name: '$user.name',
            phoneNumber: '$user.phoneNumber',
            profilePicture: '$user.profilePicture',
            about: '$user.about',
            isOnline: '$user.isOnline',
            lastSeen: '$user.lastSeen'
          },
          lastMessage: {
            _id: '$lastMessage._id',
            content: '$lastMessage.content',
            messageType: '$lastMessage.messageType',
            createdAt: '$lastMessage.createdAt',
            status: '$lastMessage.status',
            sender: '$lastMessage.sender'
          },
          unreadCount: 1,
          _idStr: 0
        }
      },
      {
        $sort: { 'lastMessage.createdAt': -1 }
      }
    ]);

    res.json({
      success: true,
      conversations
    });

  } catch (error) {
    console.error('Get Conversations Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
});

// Get messages between two users
router.get('/messages/:userId', authMiddleware, async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const otherUserId = req.params.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const messages = await Message.find({
      $or: [
        { sender: currentUserId, recipient: otherUserId },
        { sender: otherUserId, recipient: currentUserId }
      ],
      isDeleted: false,
      deletedFor: { $ne: currentUserId }
    })
    .populate('sender', 'name profilePicture phoneNumber')
    .populate('recipient', 'name profilePicture phoneNumber')
    .populate('replyTo', 'content messageType sender')
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip);

    // Mark messages as read
    const updateRes = await Message.updateMany(
      {
        sender: otherUserId,
        recipient: currentUserId,
        status: { $ne: 'read' }
      },
      { status: 'read' }
    );

    // Emit read receipts to sender if any were updated
    try {
      const io = req.app.get('io');
      if (io && updateRes.modifiedCount > 0) {
        io.to(String(otherUserId)).emit('messages-read', { userId: String(currentUserId), peerId: String(otherUserId), timestamp: new Date().toISOString() });
      }
    } catch {}

    res.json({
      success: true,
      messages: messages.reverse(),
      pagination: {
        page,
        limit,
        hasMore: messages.length === limit
      }
    });

  } catch (error) {
    console.error('Get Messages Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
});

// Send message
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { recipientId, content, messageType = 'text', replyTo, fileUrl, fileName } = req.body;

    if (!recipientId || !content) {
      return res.status(400).json({
        success: false,
        message: 'Recipient and content are required'
      });
    }

    // Check if recipient exists
    const recipient = await User.findById(recipientId);
    if (!recipient) {
      return res.status(404).json({
        success: false,
        message: 'Recipient not found'
      });
    }

    // Block checks (either side)
    const me = await User.findById(req.user._id).select('blockedUsers');
    if (me.blockedUsers?.some(u => u.equals(recipientId)) || recipient.blockedUsers?.some(u => u.equals(req.user._id))) {
      return res.status(403).json({ success: false, message: 'Messaging is blocked.' });
    }

    // Create message
    const message = new Message({
      sender: req.user._id,
      recipient: recipientId,
      content,
      messageType,
      fileUrl: fileUrl || '',
      fileName: fileName || '',
      replyTo: replyTo || null
    });

    await message.save();

    // Populate message for response
    await message.populate('sender', 'name profilePicture phoneNumber');
    await message.populate('recipient', 'name profilePicture phoneNumber');
    if (replyTo) {
      await message.populate('replyTo', 'content messageType sender');
    }

    // Socket notify recipient and delivery ack for sender (only if recipient connected)
    try {
      const io = req.app.get('io');
      if (io) {
        const recipientRoom = io.sockets?.adapter?.rooms?.get(String(recipientId));
        const payload = {
          messageId: String(message._id),
          senderId: String(req.user._id),
          recipientId: String(recipientId),
          message: message.content,
          timestamp: message.createdAt,
          // include sender profile for instant UI context on recipient side
          senderName: message.sender?.name || req.user?.name || '',
          senderProfilePicture: message.sender?.profilePicture || req.user?.profilePicture || '',
          senderPhoneNumber: message.sender?.phoneNumber || req.user?.phoneNumber || ''
        };
        if (recipientRoom && recipientRoom.size > 0) {
          io.to(String(recipientId)).emit('receive-message', payload);
          io.to(String(req.user._id)).emit('message-delivered', { messageId: String(message._id) });
        }
      }
    } catch (e) {
      console.error('Socket emit error (send):', e.message);
    }

    res.json({
      success: true,
      message: 'Message sent successfully',
      data: message
    });

  } catch (error) {
    console.error('Send Message Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
});


// Add reaction to message
router.post('/:messageId/react', authMiddleware, async (req, res) => {
  try {
    const messageId = req.params.messageId;
    const userId = req.user._id;
    const { emoji } = req.body;

    if (!emoji) {
      return res.status(400).json({
        success: false,
        message: 'Emoji is required'
      });
    }

    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if user already reacted
    const existingReaction = message.reactions.find(r => r.user.equals(userId));
    
    if (existingReaction) {
      // Update existing reaction
      existingReaction.emoji = emoji;
    } else {
      // Add new reaction
      message.reactions.push({
        user: userId,
        emoji
      });
    }

    await message.save();

    res.json({
      success: true,
      message: 'Reaction added successfully'
    });

  } catch (error) {
    console.error('Add Reaction Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
});

// Search users
router.get('/search-users', authMiddleware, async (req, res) => {
  try {
    const query = req.query.q;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const users = await User.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { phoneNumber: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } }
      ],
      _id: { $ne: req.user._id },
      isVerified: true
    })
    .select('name phoneNumber email profilePicture about isOnline lastSeen')
    .limit(20);

    res.json({
      success: true,
      users
    });

  } catch (error) {
    console.error('Search Users Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
});

// Delete message
router.delete('/:messageId', authMiddleware, async (req, res) => {
  try {
    const messageId = req.params.messageId;
    const userId = req.user._id;
    const deleteFor = req.query.deleteFor || 'me'; // 'me' or 'everyone'

    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if user has permission to delete
    if (!message.sender.equals(userId) && !message.recipient.equals(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied'
      });
    }

    if (deleteFor === 'everyone' && !message.sender.equals(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Only sender can delete for everyone'
      });
    }

    if (deleteFor === 'everyone') {
      // Capture peer ids, then remove document from DB
      const senderId = String(message.sender);
      const recipientId = String(message.recipient);
      await Message.deleteOne({ _id: message._id });
      // Broadcast removal to both peers and ask them to refresh if active
      try {
        const io = req.app.get('io');
        if (io) {
          const payload = { messageId: String(message._id), by: String(userId), scope: 'everyone', remove: true, senderId, recipientId };
          console.log('[socket] Emitting message-deleted to rooms', { senderId, recipientId, payload });
          io.to(senderId).emit('message-deleted', payload);
          io.to(recipientId).emit('message-deleted', payload);
          io.to(senderId).emit('refresh-messages', { peerId: recipientId });
          io.to(recipientId).emit('refresh-messages', { peerId: senderId });
        } else {
          console.warn('[socket] io not available to emit message-deleted');
        }
      } catch (e) { console.error('Emit message-deleted error:', e.message); }
    } else {
      if (!message.deletedFor.map(String).includes(String(userId))) {
        message.deletedFor.push(userId);
        await message.save();
      }
    }

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });

  } catch (error) {
    console.error('Delete Message Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
});

// Delete entire conversation
router.delete('/conversation/:userId', authMiddleware, async (req, res) => {
  try {
    const otherUserId = req.params.userId;
    const userId = req.user._id;
    const forEveryone = (req.query.for === 'everyone');

    if (forEveryone) {
      // Mark all messages between participants as deleted for both
      await Message.updateMany(
        {
          $or: [
            { sender: userId, recipient: otherUserId },
            { sender: otherUserId, recipient: userId }
          ],
          isDeleted: { $ne: true }
        },
        { $set: { isDeleted: true, content: 'This message was deleted', fileUrl: '', fileName: '' } }
      );
      // Broadcast conversation deletion to both
      try {
        const io = req.app.get('io');
        if (io) {
          const payload = { by: String(userId), peerId: String(otherUserId), mode: 'everyone' };
          io.to(String(userId)).emit('conversation-deleted', payload);
          io.to(String(otherUserId)).emit('conversation-deleted', payload);
        }
      } catch(e) { console.error('Emit conversation-deleted error:', e.message); }
      return res.json({ success: true, message: 'Conversation deleted for everyone' });
    } else {
      // Delete for me
      await Message.updateMany(
        {
          $or: [
            { sender: userId, recipient: otherUserId },
            { sender: otherUserId, recipient: userId }
          ],
          deletedFor: { $ne: userId }
        },
        { $push: { deletedFor: userId } }
      );
      return res.json({ success: true, message: 'Conversation deleted for you' });
    }
  } catch (e) {
    console.error('Delete Conversation Error:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Block / Unblock user
router.post('/block', authMiddleware, async (req, res) => {
  try {
    const { peerId } = req.body;
    if (!peerId) return res.status(400).json({ success: false, message: 'peerId required' });
    const user = await User.findById(req.user._id);
    if (!user.blockedUsers.map(String).includes(String(peerId))) user.blockedUsers.push(peerId);
    await user.save();
    res.json({ success: true });
  } catch (e) {
    console.error('Block Error:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
router.post('/unblock', authMiddleware, async (req, res) => {
  try {
    const { peerId } = req.body;
    if (!peerId) return res.status(400).json({ success: false, message: 'peerId required' });
    await User.updateOne({ _id: req.user._id }, { $pull: { blockedUsers: peerId } });
    res.json({ success: true });
  } catch (e) {
    console.error('Unblock Error:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Hide / Unhide chats with 4-digit PIN
router.post('/hide', authMiddleware, async (req, res) => {
  try {
    const { peerId, pin } = req.body;
    if (!peerId || !pin) return res.status(400).json({ success: false, message: 'peerId and pin required' });
    const user = await User.findById(req.user._id);
    if (!user.hidden.pinHash) {
      await user.setPin(pin);
    } else {
      const ok = await user.verifyPin(pin);
      if (!ok) return res.status(403).json({ success: false, message: 'Invalid PIN' });
    }
    if (!user.hidden.peers.map(String).includes(String(peerId))) user.hidden.peers.push(peerId);
    await user.save();
    res.json({ success: true });
  } catch (e) {
    console.error('Hide Error:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
router.post('/unhide', authMiddleware, async (req, res) => {
  try {
    const { peerId, pin } = req.body;
    if (!peerId || !pin) return res.status(400).json({ success: false, message: 'peerId and pin required' });
    const user = await User.findById(req.user._id);
    const ok = await user.verifyPin(pin);
    if (!ok) return res.status(403).json({ success: false, message: 'Invalid PIN' });
    user.hidden.peers = user.hidden.peers.filter(p => String(p) !== String(peerId));
    await user.save();
    res.json({ success: true });
  } catch (e) {
    console.error('Unhide Error:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
router.post('/verify-pin', authMiddleware, async (req, res) => {
  try {
    const { pin } = req.body;
    const user = await User.findById(req.user._id);
    const ok = await user.verifyPin(pin);
    if (!ok) return res.status(403).json({ success: false, message: 'Invalid PIN' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
router.get('/hidden', authMiddleware, async (req, res) => {
  try {
    const { pin } = req.query;
    const user = await User.findById(req.user._id);
    const ok = await user.verifyPin(pin || '');
    if (!ok) return res.status(403).json({ success: false, message: 'Invalid PIN' });

    const peers = user.hidden.peers || [];
    const conversations = await Message.aggregate([
      { $match: { $or: [ { sender: user._id }, { recipient: user._id } ], isDeleted: false } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: { $cond: [ { $eq: ['$sender', user._id] }, '$recipient', '$sender' ] }, lastMessage: { $first: '$$ROOT' } } },
      { $match: { _id: { $in: peers } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: { _id: 1, user: { _id: '$user._id', name: '$user.name', phoneNumber: '$user.phoneNumber', profilePicture: '$user.profilePicture', about: '$user.about', isOnline: '$user.isOnline', lastSeen: '$user.lastSeen' }, lastMessage: { _id: '$lastMessage._id', content: '$lastMessage.content', messageType: '$lastMessage.messageType', createdAt: '$lastMessage.createdAt', status: '$lastMessage.status', sender: '$lastMessage.sender' } } }
    ]);
    res.json({ success: true, conversations });
  } catch (e) {
    console.error('Hidden list Error:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Upload files (images, pdf, txt)
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, safe);
  }
});
const upload = multer({ storage });
router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ success: true, file: { url, fileName: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size } });
  } catch (e) {
    console.error('Upload Error:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
