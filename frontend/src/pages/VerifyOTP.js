import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { authAPI } from '../config/api';
import { useAuth } from '../context/AuthContext';
import './VerifyOTP.css';

const VerifyOTP = () => {
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRefs = useRef([]);
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated, user: authedUser } = useAuth();
  
  const phoneNumber = location.state?.phoneNumber;

  useEffect(() => {
    if (!phoneNumber) {
      // If already authenticated and landed here (e.g., refresh), route appropriately
      if (isAuthenticated) {
        if (!authedUser?.name) navigate('/setup-profile', { replace: true });
        else navigate('/chat', { replace: true });
        return;
      }
      navigate('/');
    }
    // cleanup on unmount: it's safe to clear reCAPTCHA widget, but DO NOT clear
    // window.confirmationResult here because StrictMode double-invokes effects in dev
    // which would erase the OTP session before user enters the code.
    return () => {
      try { if (window.recaptchaVerifier?.clear) window.recaptchaVerifier.clear(); } catch {}
      window.recaptchaVerifier = null;
      // Do not remove the container to avoid race in reCAPTCHA script
    };
  }, [phoneNumber, navigate, isAuthenticated, authedUser]);

  const handleChange = (index, value) => {
    if (isNaN(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // Auto focus next input
    if (value !== '' && index < 5) {
      inputRefs.current[index + 1].focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1].focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').slice(0, 6);
    const newOtp = pastedData.split('').slice(0, 6);
    
    while (newOtp.length < 6) {
      newOtp.push('');
    }
    
    setOtp(newOtp);
    inputRefs.current[Math.min(pastedData.length, 5)].focus();
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    const otpCode = otp.join('');

    if (otpCode.length !== 6) {
      setError('Please enter complete OTP');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Verify OTP with Firebase
      const confirmationResult = window.confirmationResult;
      if (!confirmationResult) {
        throw new Error('Session expired. Please request OTP again.');
      }

      const result = await confirmationResult.confirm(otpCode);
      const user = result.user;
      
      // Get Firebase ID token
      const idToken = await user.getIdToken();
      
      // Verify with backend and get JWT
      const response = await authAPI.verifyFirebaseToken(idToken);
      
      if (response.data.success) {
        const { token, user: userData, isNewUser } = response.data;
        
        // Login user
        login(userData, token);
        
        // Clear OTP session and recaptcha so future logins don't require refresh
        try { if (window.recaptchaVerifier?.clear) window.recaptchaVerifier.clear(); } catch {}
        window.recaptchaVerifier = null;
        try { window.confirmationResult = null; } catch {}
        const el = document.getElementById('recaptcha-container');
        if (el) el.innerHTML = '';

        // Navigate based on user status
        if (isNewUser || !userData.name) {
          navigate('/setup-profile');
        } else {
          navigate('/chat');
        }
      }
      
    } catch (error) {
      console.error('OTP verification error:', error);
      setError(error.message || 'Invalid OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="verify-otp-container">
      <div className="verify-otp-card">
        <div className="logo">
          <h1>💬 LetsChat</h1>
        </div>

        <form onSubmit={handleVerifyOTP} className="otp-form">
          <h2>Verify Your Number</h2>
          <p className="subtitle">
            We sent a code to <strong>{phoneNumber}</strong>
          </p>

          {error && <div className="error-message">{error}</div>}

          <div className="otp-inputs" onPaste={handlePaste}>
            {otp.map((digit, index) => (
              <input
                key={index}
                ref={(ref) => (inputRefs.current[index] = ref)}
                type="text"
                maxLength="1"
                value={digit}
                onChange={(e) => handleChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                className="otp-input"
                autoFocus={index === 0}
              />
            ))}
          </div>

          <button 
            type="submit" 
            className="verify-btn"
            disabled={loading}
          >
            {loading ? 'Verifying...' : 'Verify & Continue'}
          </button>

          <button 
            type="button" 
            className="resend-btn"
            onClick={() => {
              try { if (window.recaptchaVerifier?.clear) window.recaptchaVerifier.clear(); } catch {}
              window.recaptchaVerifier = null;
              try { window.confirmationResult = null; } catch {}
              const el = document.getElementById('recaptcha-container');
              if (el) el.innerHTML = '';
              navigate('/');
            }}
          >
            Change Number
          </button>
        </form>
      </div>
    </div>
  );
};

export default VerifyOTP;
