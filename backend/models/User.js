const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: false,
    unique: true,
    sparse: true,
    trim: true
  },
  email: {
    type: String,
    required: false,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true
  },
  name: {
    type: String,
    required: false, // Allow empty for new users
    trim: true
  },
  profilePicture: {
    type: String,
    default: ''
  },
  about: {
    type: String,
    default: 'Hey there! I am using LetsChat.'
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  contacts: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    name: String,
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  blockedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  hidden: {
    pinHash: { type: String, default: null },
    peers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  },
  otpCode: {
    type: String,
    default: null
  },
  otpExpiry: {
    type: Date,
    default: null
  },
  isVerified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Generate random OTP for demonstration (in production, use proper SMS service)
userSchema.methods.generateOTP = function() {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.otpCode = otp;
  this.otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
  return otp;
};

// Verify OTP
userSchema.methods.verifyOTP = function(otp) {
  return this.otpCode === otp && this.otpExpiry > new Date();
};

// Update last seen
userSchema.methods.updateLastSeen = function() {
  this.lastSeen = new Date();
  return this.save();
};

// Set or verify 4-digit PIN for hidden chats
userSchema.methods.setPin = async function(pin) {
  if (!pin || !/^\d{4}$/.test(pin)) throw new Error('Invalid PIN');
  const salt = await bcrypt.genSalt(10);
  this.hidden.pinHash = await bcrypt.hash(pin, salt);
  return this.save();
};
userSchema.methods.verifyPin = async function(pin) {
  if (!this.hidden.pinHash) return false;
  return bcrypt.compare(pin, this.hidden.pinHash);
};

module.exports = mongoose.model('User', userSchema);
