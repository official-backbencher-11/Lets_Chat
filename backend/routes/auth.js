const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const admin = require('../config/firebase');

const router = express.Router();

// Send OTP using Firebase Phone Authentication
router.post('/send-otp', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Check if user exists
    let user = await User.findOne({ phoneNumber });
    
    if (!user) {
      // Create new user
      user = new User({ 
        phoneNumber,
        name: '', // Will be filled during profile setup
        isVerified: false
      });
      await user.save();
    }

    // Note: Firebase Phone Auth is handled on the client side
    // The client will send Firebase ID token for verification
    res.json({
      success: true,
      message: 'Ready to verify phone number with Firebase',
      isNewUser: !user.name
    });

  } catch (error) {
    console.error('Send OTP Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
});

// Verify Firebase ID Token and login (supports phone and email)
router.post('/verify-firebase-token', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ success: false, message: 'Firebase ID token is required' });
    }

    // Verify Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const phoneNumber = decodedToken.phone_number || null;
    const email = decodedToken.email || null;
    const emailVerified = !!decodedToken.email_verified;

    if (!phoneNumber && !email) {
      return res.status(400).json({ success: false, message: 'No phone or email present in token' });
    }

    // Find existing by email or phone
    let user = null;
    if (email) {
      user = await User.findOne({ email });
    }
    if (!user && phoneNumber) {
      user = await User.findOne({ phoneNumber });
    }

    // Create if not found
    if (!user) {
      user = new User({ 
        phoneNumber: phoneNumber || undefined,
        email: email || undefined,
        name: '',
        isVerified: true,
        isOnline: true,
      });
      await user.save();
    } else {
      // Update any missing identifiers and mark online
      if (phoneNumber && !user.phoneNumber) user.phoneNumber = phoneNumber;
      if (email && !user.email) user.email = email;
      user.isVerified = true;
      user.isOnline = true;
      await user.save();
    }

    // Require verified email if email login was used
    if (email && !emailVerified) {
      return res.status(401).json({ success: false, message: 'Email not verified' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      message: 'Identity verified successfully',
      token,
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        email: user.email,
        name: user.name,
        profilePicture: user.profilePicture,
        about: user.about,
        isOnline: user.isOnline
      },
      isNewUser: !user.name
    });

  } catch (error) {
    console.error('Verify Firebase Token Error:', error);
    res.status(500).json({ success: false, message: 'Invalid or expired token' });
  }
});

// Setup user profile (for new users)
router.post('/setup-profile', authMiddleware, async (req, res) => {
  try {
    const { name, about, profilePicture } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Name is required'
      });
    }

    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update user profile
    user.name = name;
    if (about) user.about = about;
    if (profilePicture) user.profilePicture = profilePicture;
    
    await user.save();

    res.json({
      success: true,
      message: 'Profile setup completed successfully',
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        name: user.name,
        profilePicture: user.profilePicture,
        about: user.about,
        isOnline: user.isOnline
      }
    });

  } catch (error) {
    console.error('Setup Profile Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
});

// Get current user info
router.get('/me', authMiddleware, async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        id: req.user._id,
        phoneNumber: req.user.phoneNumber,
        email: req.user.email,
        name: req.user.name,
        profilePicture: req.user.profilePicture,
        about: req.user.about,
        isOnline: req.user.isOnline,
        lastSeen: req.user.lastSeen
      }
    });
  } catch (error) {
    console.error('Get User Error:', error);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// Logout
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.isOnline = false;
    user.lastSeen = new Date();
    await user.save();

    // Broadcast offline + lastSeen
    try {
      const io = req.app.get('io');
      if (io) io.emit('user-offline', { userId: String(user._id), lastSeen: user.lastSeen });
    } catch {}

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error. Please try again.'
    });
  }
});

module.exports = router;