(() => {
  'use strict';
  const STORAGE_KEY = 'hacktrack-hackathons-v1';
  const FIREBASE_MODULE_URL = new URL('firebase.js', document.currentScript.src).href;
  const list = document.getElementById('hack-list');
  const emptyState = document.getElementById('empty-state');
  const modalRoot = document.getElementById('modal-root');
  const addButton = document.getElementById('add-button');
  const appShell = document.getElementById('app-shell');
  const authLoading = document.getElementById('auth-loading');
  const authScreen = document.getElementById('auth-screen');
  const authError = document.getElementById('auth-error');
  const googleButton = document.getElementById('google-sign-in');
  const guestButton = document.getElementById('guest-mode');
  const accountButton = document.getElementById('account-button');
  const appNotice = document.getElementById('app-notice');
  let hackathons = [];
  let previouslyFocused = null;

  // Storage mode: 'loading' (checking Firebase session) | 'choice' (entry screen) | 'guest' (localStorage) | 'cloud' (Firestore)
  let mode = 'loading';
  let firebaseApi = null;
  let currentUser = null;
  let unsubscribeHackathons = null;
  let dataReady = false;
  let migrationInFlight = false;
  let signInInFlight = false;

  function readStoredHackathons() {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(stored)) return null;
    return sortByDeadline(stored.filter(isValidHackathon).map(item => ({ id: item.id, name: item.name.trim(), stage: item.stage.trim(), deadline: item.deadline, offlineRound: typeof item.offlineRound === 'string' ? item.offlineRound : '', homepage: typeof item.homepage === 'string' ? item.homepage : '' })));
  }
  function loadHackathons() {
    try {
      const sorted = readStoredHackathons();
      if (!sorted) return [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
      return sorted;
    } catch (_) { return []; }
  }
  function isValidHackathon(item) {
    return item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.stage === 'string' && typeof item.deadline === 'string';
  }
  function sortByDeadline(items) {
    return items.map((item, index) => ({ item, index })).sort((a, b) => {
      const aDeadline = a.item.deadline || a.item.offlineRound;
      const bDeadline = b.item.deadline || b.item.offlineRound;
      if (!aDeadline && !bDeadline) return a.index - b.index;
      if (!aDeadline) return 1;
      if (!bDeadline) return -1;
      return aDeadline.localeCompare(bDeadline) || a.index - b.index;
    }).map(entry => entry.item);
  }
  function sortHackathons() { hackathons = sortByDeadline(hackathons); }
  // Guest mode persists to localStorage exactly as before. Signed-in users persist through syncCloud().
  function saveHackathons() { if (mode !== 'guest') return; localStorage.setItem(STORAGE_KEY, JSON.stringify(hackathons)); }
  function syncCloud(operation) {
    if (mode !== 'cloud' || !currentUser || !firebaseApi) return;
    const uid = currentUser.uid;
    operation(firebaseApi, uid).catch(error => {
      console.error('HackTrack: cloud save failed', error);
      if (currentUser && currentUser.uid === uid) setNotice('Couldn’t save your last change to your account. Check your connection and try again.');
    });
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }
  function prettyDate(value) {
    if (!value) return 'Not set';
    const parts = /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:T([0-9]{2}):([0-9]{2}))?$/.exec(value);
    if (!parts) return value;
    const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), Number(parts[4] || 0), Number(parts[5] || 0));
    if (Number.isNaN(date.getTime())) return value;
    const options = { day: '2-digit', month: 'short', year: 'numeric' };
    if (parts[4]) Object.assign(options, { hour: 'numeric', minute: '2-digit' });
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
  function prettyHomepage(value) {
    if (!value) return 'Not set';
    try { return new URL(value).hostname.replace(/^www\./, ''); } catch (_) { return value; }
  }
  function safeHomepageUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_) { return ''; }
  }
  function renderHackathons() {
    sortHackathons();
    list.innerHTML = hackathons.map(hackathon => `
      <li class="hack-item" data-id="${escapeHtml(hackathon.id)}">
        <h2 class="hack-name">${escapeHtml(hackathon.name)}</h2>
        <div class="details">
          <div class="detail"><span class="detail-label">Stage</span><button class="detail-value" type="button" data-action="edit-stage" aria-label="Edit stage for ${escapeHtml(hackathon.name)}">${escapeHtml(hackathon.stage || 'Not set')}</button></div>
          <div class="detail"><span class="detail-label">Next deadline</span><button class="detail-value" type="button" data-action="edit-deadline" aria-label="Edit next deadline for ${escapeHtml(hackathon.name)}">${escapeHtml(prettyDate(hackathon.deadline))}</button></div>
          <div class="detail"><span class="detail-label">Offline round</span><button class="detail-value" type="button" data-action="edit-offline-round" aria-label="Edit offline round for ${escapeHtml(hackathon.name)}">${escapeHtml(prettyDate(hackathon.offlineRound))}</button></div>
          <div class="detail"><span class="detail-label">Homepage</span><span class="homepage-value">
              ${safeHomepageUrl(hackathon.homepage) ? `<a class="homepage-link" href="${escapeHtml(safeHomepageUrl(hackathon.homepage))}" target="_blank" rel="noopener noreferrer">${escapeHtml(prettyHomepage(hackathon.homepage))}</a>` : `<span class="not-set-value">Not set</span>`}
              <button class="edit-icon-button" type="button" data-action="edit-homepage" aria-label="Edit homepage link for ${escapeHtml(hackathon.name)}">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13.5 6.5 17.5 10.5M4 20l3.8-.9L19.1 7.8a2.12 2.12 0 0 0-3-3L4.9 16.1 4 20Z" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </span></div>
        </div>
        <button class="delete-button" type="button" data-action="delete" aria-label="Delete ${escapeHtml(hackathon.name)}">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M9 7l.7-2h4.6l.7 2m-9 0 1 13h10l1-13" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </li>`).join('');
    list.hidden = hackathons.length === 0;
    // While the first Firestore snapshot is loading, don't flash the empty state.
    emptyState.hidden = hackathons.length !== 0 || !dataReady;
  }
  function uuid() { return window.crypto && crypto.randomUUID ? crypto.randomUUID() : `hack-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function closeModal() {
    if (modalRoot.hidden) return;
    modalRoot.hidden = true;
    modalRoot.innerHTML = '';
    document.body.style.overflow = '';
    if (previouslyFocused) previouslyFocused.focus();
    previouslyFocused = null;
  }
  function openModal(markup, focusSelector) {
    previouslyFocused = document.activeElement;
    modalRoot.innerHTML = `<div class="backdrop" data-dismiss></div>${markup}`;
    modalRoot.hidden = false;
    document.body.style.overflow = 'hidden';
    const target = modalRoot.querySelector(focusSelector || '[data-autofocus], input, button');
    if (target) requestAnimationFrame(() => target.focus());
  }
  function modalShell(title, content, actions, extraClass = '') {
    return `<section class="dialog ${extraClass}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="dialog-head"><h2 class="dialog-title" id="modal-title">${title}</h2><button class="close-button" type="button" aria-label="Close dialog" data-dismiss>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button></div>
      <div class="dialog-body">${content}</div><div class="dialog-actions">${actions}</div>
    </section>`;
  }
  function openAddModal() {
    openModal(modalShell('Add hackathon', `<form class="form-stack" id="add-form">
      <div class="field"><label for="hackathon-name">Hackathon name</label><input id="hackathon-name" name="name" type="text" autocomplete="off" placeholder="e.g. Gemma 3 Hackathon" required maxlength="120" data-autofocus></div>
      <div class="field"><label for="hackathon-stage">Current stage <span aria-hidden="true">(optional)</span></label><input id="hackathon-stage" name="stage" type="text" autocomplete="off" placeholder="e.g. Prototype" maxlength="80"></div>
      <div class="field"><label for="hackathon-deadline">Next deadline <span aria-hidden="true">(optional)</span></label><input id="hackathon-deadline" name="deadline" type="datetime-local"></div>
      <div class="field"><label for="hackathon-offline-round">Offline round <span aria-hidden="true">(optional)</span></label><input id="hackathon-offline-round" name="offlineRound" type="datetime-local"></div>
      <div class="field"><label for="hackathon-homepage">Homepage link <span aria-hidden="true">(optional)</span></label><input id="hackathon-homepage" name="homepage" type="url" autocomplete="url" placeholder="https://example.com"></div>
      <p class="validation" id="form-error" role="alert"></p>
    </form>`, `<button class="btn btn-quiet" type="button" data-dismiss>Cancel</button><button class="btn btn-primary" type="submit" form="add-form">Add Hackathon</button>`), '#hackathon-name');
    document.getElementById('add-form').addEventListener('submit', event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const name = form.get('name').trim(), stage = form.get('stage').trim(), deadline = form.get('deadline'), offlineRound = form.get('offlineRound'), homepage = form.get('homepage').trim();
      if (!name) return showError('Please enter a hackathon name.');
      const created = { id: uuid(), name, stage, deadline, offlineRound, homepage };
      hackathons.push(created);
      sortHackathons();
      saveHackathons(); syncCloud((api, uid) => api.createHackathon(uid, created)); renderHackathons(); closeModal();
    });
  }
  function showError(message) { const error = document.getElementById('form-error'); error.textContent = message; error.classList.add('is-visible'); }
  function openEditConfirmation(id, field) {
    const item = hackathons.find(entry => entry.id === id); if (!item) return;
    const fieldTitle = field === 'stage' ? 'stage' : field === 'homepage' ? 'homepage link' : field === 'offlineRound' ? 'offline round' : 'next deadline';
    openModal(modalShell(`Edit ${fieldTitle}?`, `<p class="dialog-copy">Are you sure you want to edit this ${fieldTitle} for ${escapeHtml(item.name)}?</p>`, `<button class="btn btn-quiet" type="button" data-dismiss>Cancel</button><button class="btn btn-primary" type="button" id="confirm-continue" data-autofocus>Continue</button>`, 'confirm-dialog'), '#confirm-continue');
    document.getElementById('confirm-continue').addEventListener('click', () => openFieldEditor(id, field));
  }
  function openFieldEditor(id, field) {
    const item = hackathons.find(entry => entry.id === id); if (!item) return;
    const isStage = field === 'stage';
    const isHomepage = field === 'homepage';
    const isOfflineRound = field === 'offlineRound';
    const label = isStage ? 'Current stage' : isHomepage ? 'Homepage link' : isOfflineRound ? 'Offline round' : 'Next deadline';
    const input = isStage
      ? `<input id="field-value" name="value" type="text" autocomplete="off" maxlength="80" value="${escapeHtml(item.stage)}" data-autofocus>`
      : isHomepage
        ? `<input id="field-value" name="value" type="url" autocomplete="url" placeholder="https://example.com" value="${escapeHtml(item.homepage || '')}" data-autofocus>`
        : `<input id="field-value" name="value" type="datetime-local" value="${escapeHtml(item[field] || '')}" data-autofocus>`;
    openModal(modalShell(`Edit ${isStage ? 'stage' : isHomepage ? 'homepage link' : isOfflineRound ? 'offline round' : 'next deadline'}`, `<form class="form-stack" id="edit-form"><div class="field"><label for="field-value">${label}</label>${input}</div><p class="validation" id="form-error" role="alert"></p></form>`, `<button class="btn btn-quiet" type="button" data-dismiss>Cancel</button><button class="btn btn-primary" type="submit" form="edit-form">Save</button>`), '#field-value');
    document.getElementById('edit-form').addEventListener('submit', event => {
      event.preventDefault(); const value = new FormData(event.currentTarget).get('value').trim();
      const target = hackathons.find(entry => entry.id === id); if (!target) return closeModal();
      target[field] = value;
      if (field === 'deadline' || field === 'offlineRound') sortHackathons();
      saveHackathons(); syncCloud((api, uid) => api.updateHackathon(uid, id, { [field]: value })); renderHackathons(); closeModal();
    });
  }
  function openDeleteConfirmation(id) {
    const item = hackathons.find(entry => entry.id === id); if (!item) return;
    openModal(modalShell('Delete hackathon?', `<p class="dialog-copy">Are you sure you want to delete <strong>${escapeHtml(item.name)}</strong>? This can’t be undone.</p>`, `<button class="btn btn-quiet" type="button" data-dismiss>Cancel</button><button class="btn btn-danger" type="button" id="confirm-delete" data-autofocus>Delete</button>`, 'confirm-dialog'), '#confirm-delete');
    document.getElementById('confirm-delete').addEventListener('click', () => { hackathons = hackathons.filter(entry => entry.id !== id); saveHackathons(); syncCloud((api, uid) => api.deleteHackathon(uid, id)); renderHackathons(); closeModal(); });
  }

  // ---- Authentication + storage mode -------------------------------------------------

  function showView(view) {
    authLoading.hidden = view !== 'loading';
    authScreen.hidden = view !== 'choice';
    appShell.hidden = view !== 'guest' && view !== 'cloud';
  }
  function setNotice(message, retry) {
    appNotice.innerHTML = '';
    appNotice.hidden = !message;
    if (!message) return;
    const text = document.createElement('span');
    text.textContent = message;
    appNotice.appendChild(text);
    if (retry) {
      const button = document.createElement('button');
      button.className = 'btn btn-quiet';
      button.type = 'button';
      button.textContent = 'Retry';
      button.addEventListener('click', retry);
      appNotice.appendChild(button);
    }
  }
  function setAuthError(message) {
    authError.textContent = message || '';
    authError.hidden = !message;
  }
  function updateAccountButton() {
    accountButton.disabled = false;
    if (mode === 'cloud') {
      accountButton.textContent = 'Sign out';
      accountButton.title = currentUser && currentUser.email ? `Signed in as ${currentUser.email}` : 'Signed in with Google';
    } else {
      accountButton.textContent = 'Sign in';
      accountButton.title = 'Sign in with Google to sync your hackathons';
    }
  }
  function stopCloudListener() {
    if (unsubscribeHackathons) { unsubscribeHackathons(); unsubscribeHackathons = null; }
  }
  function clearCloudState() {
    stopCloudListener();
    currentUser = null;
    hackathons = [];
    dataReady = false;
  }
  function showChoice(errorMessage) {
    closeModal();
    clearCloudState();
    mode = 'choice';
    setNotice('');
    renderHackathons();
    googleButton.disabled = false;
    guestButton.disabled = false;
    setAuthError(errorMessage);
    showView('choice');
  }
  function enterGuest() {
    closeModal();
    clearCloudState();
    mode = 'guest';
    hackathons = loadHackathons();
    dataReady = true;
    setNotice('');
    updateAccountButton();
    renderHackathons();
    showView('guest');
  }
  function enterCloud(user) {
    if (mode === 'cloud' && currentUser && currentUser.uid === user.uid) return;
    closeModal();
    clearCloudState();
    mode = 'cloud';
    currentUser = user;
    setNotice('');
    updateAccountButton();
    renderHackathons();
    showView('cloud');
    const uid = user.uid;
    unsubscribeHackathons = firebaseApi.subscribeHackathons(uid, items => {
      if (mode !== 'cloud' || !currentUser || currentUser.uid !== uid) return;
      hackathons = items;
      dataReady = true;
      renderHackathons();
    }, error => {
      console.error('HackTrack: Firestore listener failed', error);
      if (mode !== 'cloud' || !currentUser || currentUser.uid !== uid) return;
      dataReady = true;
      renderHackathons();
      setNotice('Couldn’t load your hackathons from your account. Refresh to try again.');
    });
    migrateLocalData(user);
  }
  // Moves guest (localStorage) hackathons into the signed-in user's Firestore collection.
  // localStorage is only cleaned up after Firestore confirms the upload, and only for the
  // records that were actually migrated (or already exist in the cloud).
  async function migrateLocalData(user) {
    if (migrationInFlight || !firebaseApi) return;
    let localItems;
    try { localItems = readStoredHackathons() || []; } catch (_) { localItems = []; }
    if (!localItems.length) return;
    migrationInFlight = true;
    try {
      await firebaseApi.migrateHackathons(user.uid, localItems);
      const migratedIds = new Set(localItems.map(item => item.id));
      let remaining = [];
      try { remaining = (readStoredHackathons() || []).filter(item => !migratedIds.has(item.id)); } catch (_) { remaining = []; }
      if (remaining.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
      else localStorage.removeItem(STORAGE_KEY);
      if (mode === 'cloud' && currentUser && currentUser.uid === user.uid) setNotice('');
    } catch (error) {
      console.error('HackTrack: local data migration failed', error);
      if (mode === 'cloud' && currentUser && currentUser.uid === user.uid) {
        setNotice('Couldn’t move the hackathons saved on this device to your account. They’re still saved on this device.', () => { setNotice(''); migrateLocalData(user); });
      }
    } finally {
      migrationInFlight = false;
    }
  }
  function startGoogleSignIn() {
    if (signInInFlight) return;
    if (!firebaseApi) {
      const message = 'Google sign-in isn’t available. Add your Firebase config in js/firebase-config.js and run HackTrack from a local server.';
      if (mode === 'choice') setAuthError(message); else setNotice(message);
      return;
    }
    signInInFlight = true;
    googleButton.disabled = true;
    accountButton.disabled = true;
    setAuthError('');
    // Called synchronously from the click handler so the browser allows the popup.
    firebaseApi.signInWithGoogle().catch(error => {
      const code = error && error.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      console.error('HackTrack: Google sign-in failed', error);
      const message = code === 'auth/popup-blocked' ? 'Your browser blocked the sign-in popup. Allow popups for this site and try again.'
        : code === 'auth/unauthorized-domain' ? 'This domain isn’t authorized for Google sign-in. Add it in Firebase Console → Authentication → Settings → Authorized domains.'
        : code === 'auth/network-request-failed' ? 'Couldn’t reach Google. Check your connection and try again.'
        : 'Couldn’t sign in with Google. Please try again.';
      if (mode === 'choice') setAuthError(message); else setNotice(message);
    }).finally(() => {
      signInInFlight = false;
      googleButton.disabled = false;
      if (mode !== 'cloud') accountButton.disabled = false;
    });
  }
  function signOutUser() {
    // Hide cloud data immediately; onAuthStateChanged(null) then finds us already on the entry screen.
    showChoice();
    if (!firebaseApi) return;
    firebaseApi.signOutUser().catch(error => {
      console.error('HackTrack: sign-out failed', error);
      setAuthError('Couldn’t sign out completely. Please try again.');
    });
  }
  function handleAuthState(user) {
    if (user) enterCloud(user);
    else if (mode === 'cloud' || mode === 'loading') showChoice();
  }
  function isFirebaseConfigured(config) {
    if (!config || typeof config !== 'object') return false;
    return ['apiKey', 'authDomain', 'projectId', 'appId'].every(key => typeof config[key] === 'string' && config[key] && !config[key].startsWith('PASTE_YOUR_'));
  }
  async function initAuth() {
    const config = window.HACKTRACK_FIREBASE_CONFIG;
    if (!isFirebaseConfigured(config) || location.protocol === 'file:') { showChoice(); return; }
    // Safety net: never leave the user on the loading state if Firebase can't be reached.
    const fallback = setTimeout(() => { if (mode === 'loading') showChoice(); }, 10000);
    try {
      const { createFirebase } = await import(FIREBASE_MODULE_URL);
      firebaseApi = createFirebase(config);
      // onAuthStateChanged is the single source of truth for the signed-in state. Its first
      // call happens once Firebase has restored (or ruled out) a persisted session.
      firebaseApi.watchAuth(user => { clearTimeout(fallback); handleAuthState(user); });
    } catch (error) {
      clearTimeout(fallback);
      console.error('HackTrack: Firebase failed to load', error);
      firebaseApi = null;
      if (mode === 'loading') showChoice();
    }
  }

  addButton.addEventListener('click', openAddModal);
  list.addEventListener('click', event => {
    const action = event.target.closest('[data-action]'); if (!action) return;
    const item = action.closest('.hack-item'); if (!item) return;
    if (action.dataset.action === 'edit-stage') openEditConfirmation(item.dataset.id, 'stage');
    if (action.dataset.action === 'edit-deadline') openEditConfirmation(item.dataset.id, 'deadline');
    if (action.dataset.action === 'edit-offline-round') openEditConfirmation(item.dataset.id, 'offlineRound');
    if (action.dataset.action === 'edit-homepage') openFieldEditor(item.dataset.id, 'homepage');
    if (action.dataset.action === 'delete') openDeleteConfirmation(item.dataset.id);
  });
  modalRoot.addEventListener('click', event => { if (event.target.closest('[data-dismiss]')) closeModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modalRoot.hidden) closeModal(); });
  googleButton.addEventListener('click', startGoogleSignIn);
  guestButton.addEventListener('click', enterGuest);
  accountButton.addEventListener('click', () => { if (mode === 'cloud') signOutUser(); else startGoogleSignIn(); });
  showView('loading');
  initAuth();
})();
