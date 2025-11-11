import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI } from '../config/api';
import { useAuth } from '../context/AuthContext';
import './SetupProfile.css';

const MAX_PHOTO_MB = 2;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const SetupProfile = () => {
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { updateUser } = useAuth();
  const fileInputRef = useRef(null);

  const onPickPhoto = () => fileInputRef.current?.click();

  const onRemovePhoto = () => {
    setPhotoDataUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Please select a JPG, PNG, or WEBP image');
      return;
    }
    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > MAX_PHOTO_MB) {
      setError(`Image too large. Max ${MAX_PHOTO_MB}MB`);
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setPhotoDataUrl(dataUrl);
    } catch {
      setError('Failed to read image. Try another file.');
    }
  };

  const handleSetupProfile = async (e) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await authAPI.setupProfile({
        name: name.trim(),
        about: about.trim() || 'Hey there! I am using LetsChat.',
        profilePicture: photoDataUrl || undefined,
      });

      if (response.data.success) {
        updateUser(response.data.user);
        navigate('/chat');
      }
    } catch (error) {
      console.error('Profile setup error:', error);
      setError(error.response?.data?.message || 'Failed to setup profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="setup-profile-container">
      <div className="setup-profile-card">
        <div className="logo">
          <h1>💬 LetsChat</h1>
        </div>

        <form onSubmit={handleSetupProfile} className="profile-form">
          <h2>Complete Your Profile</h2>
          <p className="subtitle">Just one more step to get started!</p>

          {error && <div className="error-message">{error}</div>}

          <div className="avatar-section">
            <div className="avatar-container" onClick={onPickPhoto} role="button" tabIndex={0}>
              {photoDataUrl ? (
                <img className="avatar" src={photoDataUrl} alt="Profile" />
              ) : (
                <div className="avatar placeholder">+</div>
              )}
              <div className="avatar-overlay">{photoDataUrl ? 'Change Photo' : 'Add Photo'}</div>
            </div>
            {photoDataUrl && (
              <button type="button" className="remove-photo" onClick={onRemovePhoto}>Remove</button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png, image/jpeg, image/webp"
              className="hidden-file-input"
              onChange={handleFileChange}
            />
          </div>

          <div className="form-group">
            <label>Your Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className="form-input"
              maxLength={50}
              required
            />
          </div>

          <div className="form-group">
            <label>About</label>
            <textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="Hey there! I am using LetsChat."
              className="form-textarea"
              maxLength={140}
              rows={3}
            />
            <small>{about.length}/140 characters</small>
          </div>

          <button 
            type="submit" 
            className="setup-btn"
            disabled={loading}
          >
            {loading ? 'Setting up...' : 'Get Started'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default SetupProfile;
