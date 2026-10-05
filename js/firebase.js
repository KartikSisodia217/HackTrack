// Firebase Authentication (Google) + Firestore storage for signed-in HackTrack users.
// Loaded on demand by js/app.js. Guest mode never touches this module's storage functions.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, getDocsFromServer, writeBatch, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const FIELDS = ['name', 'stage', 'deadline', 'offlineRound', 'homepage'];
const BATCH_LIMIT = 450;

// Firestore document IDs can't contain "/", be "." / "..", or match __.*__.
// Existing HackTrack IDs (UUIDs) are used as-is; anything else maps to a deterministic ID
// so repeated migrations always target the same document (no duplicates).
export function toDocId(id) {
  const value = String(id);
  if (value && value.length <= 700 && !value.includes('/') && value !== '.' && value !== '..' && !/^__.*__$/.test(value)) return value;
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `local-${hash.toString(16)}-${value.length}`;
}

function pickFields(source) {
  const data = {};
  FIELDS.forEach(field => { data[field] = typeof source[field] === 'string' ? source[field] : ''; });
  return data;
}

export function createFirebase(config) {
  const app = initializeApp(config);
  // getAuth() uses browser local persistence (IndexedDB) by default, so the Google session
  // survives refreshes and browser restarts until the user signs out.
  const auth = getAuth(app);
  const db = getFirestore(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  const hackathonsRef = uid => collection(db, 'users', uid, 'hackathons');
  const hackathonRef = (uid, id) => doc(db, 'users', uid, 'hackathons', id);

  return {
    watchAuth: callback => onAuthStateChanged(auth, callback),
    signInWithGoogle: () => signInWithPopup(auth, provider),
    signOutUser: () => signOut(auth),

    // Realtime listener for users/{uid}/hackathons. Returns the unsubscribe function.
    subscribeHackathons(uid, onData, onError) {
      return onSnapshot(hackathonsRef(uid), snapshot => {
        const items = snapshot.docs.map(entry => {
          const data = entry.data();
          return { order: typeof data.createdAt === 'number' ? data.createdAt : 0, item: { id: entry.id, ...pickFields(data) } };
        });
        // createdAt keeps the original insertion order, which HackTrack's deadline sort uses as its tie-breaker.
        items.sort((a, b) => a.order - b.order || a.item.id.localeCompare(b.item.id));
        onData(items.map(entry => entry.item));
      }, onError);
    },

    createHackathon(uid, item) {
      return setDoc(hackathonRef(uid, item.id), { ...pickFields(item), createdAt: Date.now(), updatedAt: serverTimestamp() });
    },
    updateHackathon(uid, id, changes) {
      return updateDoc(hackathonRef(uid, id), { ...changes, updatedAt: serverTimestamp() });
    },
    deleteHackathon(uid, id) {
      return deleteDoc(hackathonRef(uid, id));
    },

    // Uploads local (guest) hackathons that aren't in the user's cloud yet.
    // Existing cloud documents are never overwritten. Resolves only after the server has
    // acknowledged every write; rejects on any failure so the caller can keep localStorage intact.
    async migrateHackathons(uid, localItems) {
      const existing = await getDocsFromServer(hackathonsRef(uid));
      const existingIds = new Set(existing.docs.map(entry => entry.id));
      const pending = localItems.filter(item => !existingIds.has(toDocId(item.id)));
      const baseTime = Date.now();
      for (let start = 0; start < pending.length; start += BATCH_LIMIT) {
        const batch = writeBatch(db);
        pending.slice(start, start + BATCH_LIMIT).forEach((item, offset) => {
          batch.set(hackathonRef(uid, toDocId(item.id)), { ...pickFields(item), createdAt: baseTime + start + offset, updatedAt: serverTimestamp() });
        });
        await batch.commit();
      }
      return { uploaded: pending.length, alreadyInCloud: localItems.length - pending.length };
    }
  };
}
