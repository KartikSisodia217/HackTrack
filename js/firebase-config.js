// Firebase Web App configuration for HackTrack.
//
// Replace every "PASTE_YOUR_..._HERE" placeholder with the values from:
// Firebase Console → Project settings (gear icon) → General → Your apps → HackTrack (Web) → SDK setup and configuration → Config
//
// These values are the public Web App config and are safe to ship in frontend code.
// Access to data is enforced by Firebase Authentication + firestore.rules.
// NEVER put service-account JSON, Admin SDK credentials or private keys in this file.
const firebaseConfig = {
  apiKey: "AIzaSyBxRu4CSd8L52G8Y92IWwfNaEsgwwq8FSI",
  authDomain: "hacktrack-e3588.firebaseapp.com",
  projectId: "hacktrack-e3588",
  storageBucket: "hacktrack-e3588.firebasestorage.app",
  messagingSenderId: "327558591322",
  appId: "1:327558591322:web:f235c6983196294a983963",
  measurementId: "G-NERR0CFF3G"
};

window.HACKTRACK_FIREBASE_CONFIG = firebaseConfig;
