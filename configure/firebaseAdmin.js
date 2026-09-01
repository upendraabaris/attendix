// firebaseAdmin.js
// Initializes the Firebase Admin SDK from environment variables.
// Required env vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY.
// Never hard-code service-account credentials here.
//
// firebase-admin v13+ dropped the old namespaced `admin.xxx` API in favor of
// modular subpath imports (firebase-admin/app, firebase-admin/messaging).
const {initializeApp, cert, getApps} = require("firebase-admin/app");

let app = null;

const existingApps = getApps();
if (existingApps.length) {
    app = existingApps[0];
} else {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

    if (!projectId || !clientEmail || !privateKey) {
        console.error(
            "Firebase Admin not initialized: missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars. Push notifications will be disabled."
        );
    } else {
        app = initializeApp({
            credential: cert({projectId, clientEmail, privateKey}),
        });
    }
}

module.exports = {app};
