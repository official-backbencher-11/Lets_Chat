const admin = require('firebase-admin');

// Helper: normalize private key from env (handle quotes, CRLF, and \n escapes)
function normalizePrivateKey(value) {
  if (!value) return value;
  let v = String(value).trim();
  // Strip wrapping quotes if present
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  // Replace literal \r\n or \n sequences with newlines
  v = v.replace(/\\r?\\n/g, '\n');
  return v;
}

// Attempt to build service account from multiple sources without throwing at import time
function resolveServiceAccount() {
  // 1) FIREBASE_SERVICE_ACCOUNT_JSON (raw JSON string or base64-encoded)
  const jsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (jsonEnv) {
    try {
      const raw = jsonEnv.trim().startsWith('{') ? jsonEnv : Buffer.from(jsonEnv, 'base64').toString('utf8');
      const parsed = JSON.parse(raw);
      if (parsed.private_key) parsed.private_key = normalizePrivateKey(parsed.private_key);
      return parsed;
    } catch (e) {
      console.warn('[firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', e.message);
    }
  }

  // 2) Individual env vars
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (projectId && clientEmail && privateKey) {
    return {
      type: 'service_account',
      project_id: projectId,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: privateKey,
      client_email: clientEmail,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
      universe_domain: 'googleapis.com'
    };
  }
  return null;
}

let exported;
try {
  const serviceAccount = resolveServiceAccount();
  if (!serviceAccount) {
    console.warn('[firebase] Admin not configured: missing service account envs');
    // Export a minimal stub that throws when used, but does not crash import.
    exported = {
      app: () => ({ options: {} }),
      auth: () => { throw new Error('Firebase Admin is not configured'); }
    };
  } else {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID
      });
    }
    exported = admin;
  }
} catch (e) {
  console.error('[firebase] Initialization error:', e.message);
  // Export a stub so require() does not crash the app
  exported = {
    app: () => ({ options: {} }),
    auth: () => { throw new Error('Firebase Admin failed to initialize'); }
  };
}

module.exports = exported;
