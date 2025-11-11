import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// Suppress dev overlay for transient network timeouts to avoid UX disruption
const suppressIfTimeout = (msgLike) => {
  try {
    const obj = msgLike || {};
    const s = (typeof obj === 'string' ? obj : (obj.message || obj.name || obj.code || obj.toString() || '')).toString().toLowerCase();
    return s.includes('timeout');
  } catch { return false; }
};
window.addEventListener('error', (e) => {
  const m = e?.error || e?.message;
  if (suppressIfTimeout(m)) { e.preventDefault(); return false; }
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e?.reason;
  if (suppressIfTimeout(r)) { e.preventDefault(); return false; }
});
// guard: also silence React Refresh overlay timeout logs
const _cerr = console.error;
console.error = function(...args){
  if (args.some(a => suppressIfTimeout(a))) return;
  return _cerr.apply(console, args);
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
