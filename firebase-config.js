// Public Firebase Web App configuration.
// NOTE: Firebase client config values (apiKey, projectId, authDomain) are public
// identifiers for your Firebase project—NOT server secrets.
// Real access control is enforced by Firebase Authentication + firestore.rules.
// NEVER place a Firebase Admin SDK service-account private key in client code.
window.FIREBASE_CONFIG = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  appId: "YOUR_FIREBASE_APP_ID"
};
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyB69GhdCED-5Iq0Ofd-MDSpQTMH8q85YBA",
  authDomain: "track-id-fd62d.firebaseapp.com",
  projectId: "track-id-fd62d",
  storageBucket: "track-id-fd62d.firebasestorage.app",
  messagingSenderId: "974654530053",
  appId: "1:974654530053:web:9021f32985c1f7f5ad726c",
  measurementId: "G-JNKC7R9RJG"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
