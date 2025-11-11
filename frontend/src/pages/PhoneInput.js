import React, { useEffect, useState } from 'react';
import { RecaptchaVerifier, signInWithPhoneNumber, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
import { auth } from '../config/firebase';
import { useNavigate } from 'react-router-dom';
import './PhoneInput.css';
import { authAPI } from '../config/api';

const PhoneInput = () => {
  const [mode, setMode] = useState('phone'); // 'phone' | 'email'
  const [phoneNumber, setPhoneNumber] = useState('');
  const [countryCode, setCountryCode] = useState('+1');
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  // Ensure any stale verifier is cleared on mount/unmount
  useEffect(() => {
    return () => {
      try {
        if (window.recaptchaVerifier?.clear) {
          window.recaptchaVerifier.clear();
        }
      } catch {}
      window.recaptchaVerifier = null;
      const el = document.getElementById('recaptcha-container');
      if (el) el.innerHTML = '';
    };
  }, []);


  // (Re)initialize invisible reCAPTCHA fresh for every attempt
  const ensureRecaptchaContainer = () => {
    let el = document.getElementById('recaptcha-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'recaptcha-container';
      el.style.position = 'fixed';
      el.style.bottom = '0';
      el.style.right = '0';
      el.style.zIndex = '9999';
      document.body.appendChild(el);
    }
    return el;
  };

  const setupRecaptcha = async () => {
    try {
      if (window.recaptchaVerifier?.clear) {
        await window.recaptchaVerifier.clear();
      }
    } catch {}
    window.recaptchaVerifier = null;
    ensureRecaptchaContainer();

    window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'invisible',
      callback: () => {
        // solved, continue
      },
      'expired-callback': () => {
        // token expired; will be re-created next attempt
      }
    });
    // Render to ensure a fresh widget is created
    try { await window.recaptchaVerifier.render(); } catch {}
    return window.recaptchaVerifier;
  };

  const handleSendOTP = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const fullPhoneNumber = countryCode + phoneNumber;

    // Validate phone number
    if (!phoneNumber || phoneNumber.length < 10) {
      setError('Please enter a valid phone number');
      setLoading(false);
      return;
    }

    try {
      const appVerifier = await setupRecaptcha();
      
      // Send OTP using Firebase
      const confirmationResult = await signInWithPhoneNumber(auth, fullPhoneNumber, appVerifier);
      
      // Store confirmation result for verification
      window.confirmationResult = confirmationResult;
      
      console.log('OTP sent successfully');
      
      // Navigate to OTP verification page
      navigate('/verify-otp', { state: { phoneNumber: fullPhoneNumber } });
      
    } catch (error) {
      console.error('Error sending OTP:', error);
      setError(error.message || 'Failed to send OTP. Please try again.');
      
      // Reset reCAPTCHA completely so it works again without page refresh
      try {
        if (window.recaptchaVerifier?.clear) await window.recaptchaVerifier.clear();
      } catch {}
      window.recaptchaVerifier = null;
      const el = document.getElementById('recaptcha-container');
      if (el) el.innerHTML = '';
    } finally {
      setLoading(false);
    }
  };

  // Handle email-link callback on load
  useEffect(() => {
    const run = async () => {
      try {
        if (isSignInWithEmailLink(auth, window.location.href)) {
          let stored = window.localStorage.getItem('emailForSignIn') || '';
          if (!stored) {
            // Fallback to input field if we have it
            stored = email;
          }
          if (!stored) return; // wait until user types email again
          const res = await signInWithEmailLink(auth, stored, window.location.href);
          try { window.localStorage.removeItem('emailForSignIn'); } catch {}
          const idToken = await res.user.getIdToken();
          const response = await authAPI.verifyFirebaseToken(idToken);
          if (response.data?.success) {
            const { token, user: userData, isNewUser } = response.data;
            localStorage.setItem('authToken', token);
            window.history.replaceState({}, document.title, window.location.pathname);
            window.location.href = isNewUser || !userData.name ? '/setup-profile' : '/chat';
          }
        }
      } catch (e) {
        console.error('Email link sign-in error:', e);
        setError(e.message || 'Email verification failed');
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const handleSendEmailLink = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email');
      const continueUrl = process.env.REACT_APP_EMAIL_CONTINUE_URL || (window.location.origin + '/');
      const actionCodeSettings = {
        url: continueUrl,
        handleCodeInApp: true,
      };
      await sendSignInLinkToEmail(auth, email, actionCodeSettings);
      window.localStorage.setItem('emailForSignIn', email);
      setPendingEmail(email);
      setEmailSent(true);
    } catch (err) {
      console.error('Send email link error:', err);
      setError((err.code ? `${err.code}: ` : '') + (err.message || 'Failed to send email link'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="phone-input-container">
      <div className="phone-input-card">
        <div className="logo">
          <h1>💬 LetsChat</h1>
          <p>Connect with your friends instantly</p>
        </div>

        <div style={{display:'flex', gap:8, marginBottom:12}}>
          <button type="button" className={`send-otp-btn ${mode==='phone'?'active':''}`} onClick={()=> setMode('phone')} disabled={mode==='phone'}>Phone</button>
          <button type="button" className={`send-otp-btn ${mode==='email'?'active':''}`} onClick={()=> setMode('email')} disabled={mode==='email'}>Email</button>
        </div>

        {mode==='phone' ? (
        <form onSubmit={handleSendOTP} className="phone-form">
          <h2>Enter Your Phone Number</h2>
          <p className="subtitle">We'll send you a verification code</p>

          {error && <div className="error-message">{error}</div>}

          <div className="input-group">
            <select 
              value={countryCode} 
              onChange={(e) => setCountryCode(e.target.value)}
              className="country-select"
            >
              <option value="+1">🇺🇸 +1 (US)</option>
              <option value="+44">🇬🇧 +44 (UK)</option>
              <option value="+91">🇮🇳 +91 (India)</option>
              <option value="+86">🇨🇳 +86 (China)</option>
              <option value="+81">🇯🇵 +81 (Japan)</option>
              <option value="+49">🇩🇪 +49 (Germany)</option>
              <option value="+33">🇫🇷 +33 (France)</option>
              <option value="+61">🇦🇺 +61 (Australia)</option>
              <option value="+55">🇧🇷 +55 (Brazil)</option>
              <option value="+7">🇷🇺 +7 (Russia)</option>
            </select>

            <input
              type="tel"
              placeholder="Phone number"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
              className="phone-input"
              required
            />
          </div>

          <button 
            type="submit" 
            className="send-otp-btn"
            disabled={loading}
          >
            {loading ? 'Sending...' : 'Send OTP'}
          </button>

          <div id="recaptcha-container"></div>
        </form>
) : (
        <form onSubmit={handleSendEmailLink} className="phone-form">
          <h2>Sign in with Email</h2>
          <p className="subtitle">We’ll send a sign-in link to your email</p>
          {error && <div className="error-message">{error}</div>}
          <div className="input-group">
            <input type="email" placeholder="Email" value={email} onChange={(e)=> setEmail(e.target.value)} className="phone-input" required />
          </div>
          {emailSent ? (
            <div className="info-message">Link sent to <strong>{pendingEmail || email}</strong>. Open it on this device to continue.</div>
          ) : null}
          <button type="submit" className="send-otp-btn" disabled={loading}>
            {loading ? 'Please wait…' : (emailSent ? 'Resend Link' : 'Send Link')}
          </button>
        </form>
        )}

        <div className="footer-text">
          <p>By continuing, you agree to our Terms & Privacy Policy</p>
        </div>
      </div>
    </div>
  );
};

export default PhoneInput;
