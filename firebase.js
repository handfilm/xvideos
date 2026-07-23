/* ============================================================
   RAWX MOTION LAB — FIREBASE LAYER (additive only)
   Loaded after app.js/dashboard.js AND after super.js. Never edits,
   calls into, or depends on internals of any of those files — it
   injects its own tiny UI (account button + modal) into the top bar
   and works purely through Firebase + the DOM, so it can be dropped
   onto both pages with a single <script> include and cannot break
   any existing feature.

   >>> FILL IN YOUR firebaseConfig BELOW BEFORE USE <<<
============================================================ */
(function () {
  'use strict';

  /* ----------------------------------------------------------
     0. CONFIG — paste your Firebase project's config object here.
     Firebase Console → Project settings → Your apps → Web app.
  ---------------------------------------------------------- */
  var firebaseConfig = {
    apiKey: 'YOUR_API_KEY',
    authDomain: 'YOUR_PROJECT.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT.appspot.com',
    messagingSenderId: 'YOUR_SENDER_ID',
    appId: 'YOUR_APP_ID'
  };

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function showToast(msg) {
    var t = document.getElementById('toast');
    if (!t) { console.log('[RAWX AUTH]', msg); return; }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }

  /* ----------------------------------------------------------
     1. Load Firebase SDKs (v10 modular, via CDN) only once,
     then initialize app + auth. Exposed globally as window.RAWX_FB
     so Phase 2+ layers (boards/pins, feed, blog, chatbot) can reuse
     the same initialized app without re-configuring anything.
  ---------------------------------------------------------- */
  var fbReadyPromise = (function () {
    return Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js')
    ]).then(function (mods) {
      var appMod = mods[0], authMod = mods[1];
      var app = appMod.initializeApp(firebaseConfig);
      var auth = authMod.getAuth(app);
      var googleProvider = new authMod.GoogleAuthProvider();

      window.RAWX_FB = {
        app: app,
        auth: auth,
        authMod: authMod,          // exposes signInWithEmailAndPassword etc. for reuse
        googleProvider: googleProvider,
        user: null                 // kept in sync below
      };

      authMod.onAuthStateChanged(auth, function (user) {
        window.RAWX_FB.user = user || null;
        updateAccountButton(user);
        document.dispatchEvent(new CustomEvent('rawx-auth-changed', { detail: { user: user || null } }));
      });

      return window.RAWX_FB;
    }).catch(function (err) {
      console.error('[RAWX FB] Firebase failed to load/initialize:', err);
      showToast('ACCOUNT SYSTEM UNAVAILABLE');
      return null;
    });
  })();

  /* ----------------------------------------------------------
     2. Account button — injected into the top bar next to the
     PANELS dropdown on index.html, and the equivalent bar on
     dashboard.html. Falls back to appending to <body> if neither
     expected container is found, so it never throws.
  ---------------------------------------------------------- */
  var accountBtn;

  function buildAccountButton() {
    accountBtn = el('button', 'panels-nav-btn rawx-account-btn', 'ACCOUNT');
    accountBtn.style.marginLeft = '8px';
    accountBtn.addEventListener('click', function () {
      if (window.RAWX_FB && window.RAWX_FB.user) openAccountModal();
      else openSignInModal();
    });

    var wrap = qs('.panels-nav-wrap');
    if (wrap && wrap.parentNode) {
      wrap.parentNode.insertBefore(accountBtn, wrap.nextSibling);
    } else {
      accountBtn.style.position = 'fixed';
      accountBtn.style.top = '10px';
      accountBtn.style.right = '10px';
      accountBtn.style.zIndex = '9999';
      document.body.appendChild(accountBtn);
    }
  }

  function updateAccountButton(user) {
    if (!accountBtn) return;
    accountBtn.textContent = user ? ('◉ ' + (user.displayName || user.email || 'ACCOUNT').toUpperCase()) : 'SIGN IN';
  }

  /* ----------------------------------------------------------
     3. Minimal modal shell (reused for sign-in and account-menu
     states) so we don't need any new CSS file — inline styles only,
     scoped under .rawx-fb-modal so nothing else can collide with it.
  ---------------------------------------------------------- */
  var modalOverlay;

  function ensureModal() {
    if (modalOverlay) return modalOverlay;
    modalOverlay = el('div', 'rawx-fb-modal-overlay');
    modalOverlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10000;' +
      'display:flex;align-items:center;justify-content:center;';
    modalOverlay.addEventListener('click', function (e) {
      if (e.target === modalOverlay) closeModal();
    });

    var box = el('div', 'rawx-fb-modal');
    box.style.cssText =
      'background:#111;border:1px solid #444;padding:24px;width:min(340px,90vw);' +
      'font-family:"Space Mono",monospace;color:#eee;';
    modalOverlay.appendChild(box);
    modalOverlay._box = box;

    document.body.appendChild(modalOverlay);
    return modalOverlay;
  }

  function closeModal() {
    if (modalOverlay) modalOverlay.style.display = 'none';
  }

  function openSignInModal() {
    var overlay = ensureModal();
    var box = overlay._box;
    box.innerHTML = '';

    box.appendChild(el('div', '', '<strong style="letter-spacing:1px;">SIGN IN</strong>'));

    var googleBtn = el('button', '', 'CONTINUE WITH GOOGLE');
    googleBtn.style.cssText = 'display:block;width:100%;margin:14px 0;padding:10px;background:#fff;color:#111;border:none;font-family:inherit;cursor:pointer;';
    googleBtn.addEventListener('click', function () {
      fbReadyPromise.then(function (fb) {
        if (!fb) return;
        fb.authMod.signInWithPopup(fb.auth, fb.googleProvider)
          .then(function () { showToast('SIGNED IN'); closeModal(); })
          .catch(function (err) { showToast('SIGN-IN FAILED'); console.error(err); });
      });
    });
    box.appendChild(googleBtn);

    box.appendChild(el('div', '', '<hr style="border-color:#333;margin:14px 0;">'));

    var emailInput = el('input');
    emailInput.type = 'email';
    emailInput.placeholder = 'EMAIL';
    emailInput.style.cssText = 'display:block;width:100%;margin-bottom:8px;padding:8px;background:#1a1a1a;border:1px solid #444;color:#eee;font-family:inherit;box-sizing:border-box;';
    box.appendChild(emailInput);

    var pwInput = el('input');
    pwInput.type = 'password';
    pwInput.placeholder = 'PASSWORD';
    pwInput.style.cssText = emailInput.style.cssText;
    box.appendChild(pwInput);

    var row = el('div');
    row.style.cssText = 'display:flex;gap:8px;margin-top:10px;';
    var signInBtn = el('button', '', 'SIGN IN');
    var signUpBtn = el('button', '', 'CREATE ACCOUNT');
    [signInBtn, signUpBtn].forEach(function (b) {
      b.style.cssText = 'flex:1;padding:10px;background:#c0392b;color:#fff;border:none;font-family:inherit;cursor:pointer;';
    });
    signUpBtn.style.background = '#333';
    row.appendChild(signInBtn);
    row.appendChild(signUpBtn);
    box.appendChild(row);

    function withEmailAuth(fn) {
      fbReadyPromise.then(function (fb) {
        if (!fb) return;
        if (!emailInput.value || !pwInput.value) { showToast('ENTER EMAIL + PASSWORD'); return; }
        fn(fb).then(function () { showToast('SIGNED IN'); closeModal(); })
          .catch(function (err) { showToast(err.code === 'auth/email-already-in-use' ? 'EMAIL ALREADY IN USE' : 'AUTH FAILED'); console.error(err); });
      });
    }
    signInBtn.addEventListener('click', function () {
      withEmailAuth(function (fb) { return fb.authMod.signInWithEmailAndPassword(fb.auth, emailInput.value, pwInput.value); });
    });
    signUpBtn.addEventListener('click', function () {
      withEmailAuth(function (fb) { return fb.authMod.createUserWithEmailAndPassword(fb.auth, emailInput.value, pwInput.value); });
    });

    var closeBtn = el('button', '', 'CANCEL');
    closeBtn.style.cssText = 'display:block;width:100%;margin-top:14px;padding:8px;background:none;color:#888;border:1px solid #333;font-family:inherit;cursor:pointer;';
    closeBtn.addEventListener('click', closeModal);
    box.appendChild(closeBtn);

    overlay.style.display = 'flex';
  }

  function openAccountModal() {
    var overlay = ensureModal();
    var box = overlay._box;
    box.innerHTML = '';
    var user = window.RAWX_FB && window.RAWX_FB.user;
    box.appendChild(el('div', '', '<strong style="letter-spacing:1px;">ACCOUNT</strong>'));
    box.appendChild(el('div', '', '<div style="margin:14px 0;color:#aaa;">' +
      (user ? (user.displayName || user.email || user.uid) : '') + '</div>'));

    var signOutBtn = el('button', '', 'SIGN OUT');
    signOutBtn.style.cssText = 'display:block;width:100%;padding:10px;background:#c0392b;color:#fff;border:none;font-family:inherit;cursor:pointer;';
    signOutBtn.addEventListener('click', function () {
      fbReadyPromise.then(function (fb) {
        if (!fb) return;
        fb.authMod.signOut(fb.auth).then(function () { showToast('SIGNED OUT'); closeModal(); });
      });
    });
    box.appendChild(signOutBtn);

    var closeBtn = el('button', '', 'CLOSE');
    closeBtn.style.cssText = 'display:block;width:100%;margin-top:10px;padding:8px;background:none;color:#888;border:1px solid #333;font-family:inherit;cursor:pointer;';
    closeBtn.addEventListener('click', closeModal);
    box.appendChild(closeBtn);

    overlay.style.display = 'flex';
  }

  /* ----------------------------------------------------------
     4. Boot
  ---------------------------------------------------------- */
  function boot() {
    buildAccountButton();
    fbReadyPromise.then(function (fb) {
      if (fb) updateAccountButton(fb.user);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
