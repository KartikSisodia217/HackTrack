# HackTrack

A minimal tracker for hackathon stages and deadlines.

HackTrack works in two modes:

| Mode | How you enter it | Where data lives |
| --- | --- | --- |
| **Guest** | “Use without login” | This browser’s `localStorage` (key `hacktrack-hackathons-v1`) |
| **Google** | “Continue with Google” (or **Sign in** in the header while in guest mode) | Firestore: `users/{uid}/hackathons/{hackathonId}` |

The UI is identical in both modes.

## Project structure

```text
index.html               Markup (entry screen, main app, modal root)
css/styles.css           All styles
js/app.js                App logic, auth flow, guest/cloud storage routing, migration
js/firebase-config.js    Your Firebase Web App config  ← you edit this
js/firebase.js           Firebase Auth (Google) + Firestore helpers (Firebase JS SDK v12, loaded from gstatic CDN)
firestore.rules          Firestore security rules (owner-only access)
firebase.json            Firebase CLI config (rules deploy, hosting, emulators)
```

## How it works

- **Startup.** A small spinner is shown while Firebase restores any existing session. `onAuthStateChanged` decides what happens next:
  - signed in → the main page opens directly (no entry screen);
  - not signed in → the entry screen with **Continue with Google** and **Use without login**.
- **Persistent login.** Firebase Auth’s default browser persistence (IndexedDB) keeps you signed in across refreshes and browser restarts until you click **Sign out**. No custom “logged in” flags are stored.
- **Guest mode** uses the existing `localStorage` storage unchanged. Nothing is sent to Firebase.
- **Google mode** reads from Firestore with a realtime `onSnapshot` listener; adds/edits/deletes are written to Firestore. The listener is stopped on sign-out or user change.
- **Migration.** Whenever a Google user is active and this browser has guest hackathons in `localStorage`, they are uploaded to `users/{uid}/hackathons` using their existing IDs as document IDs:
  - hackathons already in the cloud (same ID) are **never overwritten** and never duplicated;
  - new local hackathons are added, so existing cloud data + local data are **merged**;
  - `localStorage` is only cleaned up **after** Firestore confirms every write. If anything fails, local data stays intact and a notice with **Retry** appears.
- **Sign out** stops the listener, clears cloud data from memory, signs out of Firebase and returns to the entry screen. Cloud data is never copied into `localStorage`.

---

## Firebase setup

### 1. Create / select a Firebase project
1. Go to <https://console.firebase.google.com>.
2. Click **Create a project** (or open an existing one). Google Analytics is optional and not needed.

### 2. Register HackTrack as a Web app and get the config values
1. In the project, click the **gear icon → Project settings → General**.
2. Under **Your apps**, click the **Web** icon (`</>`), enter a nickname (e.g. `HackTrack`), leave “Firebase Hosting” unchecked (you can add it later) and click **Register app**.
3. Firebase shows a `firebaseConfig` object. (You can find it again any time at **Project settings → General → Your apps → HackTrack → SDK setup and configuration → Config**.)
4. Copy these six values into [`js/firebase-config.js`](js/firebase-config.js), replacing the placeholders:

| Value | Replaces placeholder | Example shape |
| --- | --- | --- |
| `apiKey` | `PASTE_YOUR_API_KEY_HERE` | `AIzaSy...` |
| `authDomain` | `PASTE_YOUR_AUTH_DOMAIN_HERE` | `your-project.firebaseapp.com` |
| `projectId` | `PASTE_YOUR_PROJECT_ID_HERE` | `your-project` |
| `storageBucket` | `PASTE_YOUR_STORAGE_BUCKET_HERE` | `your-project.firebasestorage.app` |
| `messagingSenderId` | `PASTE_YOUR_MESSAGING_SENDER_ID_HERE` | `123456789012` |
| `appId` | `PASTE_YOUR_APP_ID_HERE` | `1:123456789012:web:abc123...` |

If the console also shows `measurementId` (only when Analytics is enabled), you may add it, but HackTrack doesn’t need it. No other values are required.

> These are public Web App identifiers, not secrets. Never put a service-account JSON, Admin SDK credentials or private keys in the frontend. Data access is protected by Firebase Auth + `firestore.rules`.

Until the placeholders are replaced, HackTrack still works in guest mode; **Continue with Google** shows a “not available” message.

### 3. Enable Google sign-in
1. **Build → Authentication → Get started** (first time only).
2. **Sign-in method** tab → **Add new provider** → **Google**.
3. Toggle **Enable**, choose a **Project support email**, click **Save**.

### 4. Authorized domains
1. **Authentication → Settings → Authorized domains**.
2. `localhost` and `your-project.firebaseapp.com` / `your-project.web.app` are there by default.
3. Click **Add domain** for every other domain HackTrack runs on (e.g. `127.0.0.1` if you open it that way, `yourname.github.io`, `hacktrack.example.com`). Use the bare host name, without `http://` or a port.

### 5. Create the Firestore database
1. **Build → Firestore Database → Create database**.
2. Choose a location (can’t be changed later).
3. Start in **production mode** (everything denied) — the next step installs the real rules.

### 6. Security rules
The included [`firestore.rules`](firestore.rules) only lets a signed-in user read/write `users/{userId}/hackathons/*` when `request.auth.uid == userId`, validates the document fields, and denies everything else.

**Option A – Console:** **Firestore Database → Rules**, replace the contents with `firestore.rules`, click **Publish**.

**Option B – CLI:**
```bash
npm install -g firebase-tools
firebase login
firebase use --add            # pick your project
firebase deploy --only firestore:rules
```

## Run locally

Use a local web server (Google sign-in and the Firebase SDK don’t work from `file://`):

```bash
# from the project folder, any one of:
python3 -m http.server 5173          # → http://localhost:5173
npx serve .                          # → http://localhost:3000
firebase serve --only hosting        # → http://localhost:5000
```

Open the URL with `localhost` (already authorized). If you use `127.0.0.1`, add it to Authorized domains.

## Deploy (Firebase Hosting)

```bash
firebase login
firebase use --add                    # once
firebase deploy                       # deploys hosting + firestore rules
```

Your app is served at `https://your-project.web.app` (already authorized for sign-in). Any static host works too (GitHub Pages, Netlify, Vercel) — just add that domain under **Authentication → Settings → Authorized domains**.
