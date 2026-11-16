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
