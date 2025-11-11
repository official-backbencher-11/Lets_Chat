import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Firebase Web API Configuration
// TODO: Get these values from Firebase Console > Project Settings > General > Your apps > Web app
const firebaseConfig = {
  apiKey: "AIzaSyAc7opX0QrKxMKOmtezL-fo_p5UiWpZW2o",
  authDomain: "letschat-c0b50.firebaseapp.com",
  projectId: "letschat-c0b50",
  storageBucket: "letschat-c0b50.firebasestorage.app",
  messagingSenderId: "622860621659",
  appId: "1:622860621659:web:519a6bdc081b95aa406c7e",
  measurementId: "G-F71GSGH60Z"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and export
export const auth = getAuth(app);

export default app;
