/* ============================================================
   RAWX MOTION LAB — CATALOG CHATBOT (additive only)
   A fourth additive layer, same philosophy as super.js/firebase.js:
   never edits, calls into, or depends on internals of app.js,
   dashboard.js, super.js, or firebase.js.

   MODE-AWARE: this file runs on BOTH shells and detects which one
   it's in at boot, purely by DOM shape:
     - #dash-feed present  -> "dashboard" mode (THE FEED / DEEPER)
     - #cat-tabs present   -> "index"     mode (LAB desktop OS)
     - neither present     -> no-ops (safe to include anywhere)

   WHAT IT DOES: answers questions about the RAWX catalog — what
   categories/sections exist, what's inside a given category — and
   drives the existing UI to actually open/filter things, all
   through public DOM events/clicks (never touching either file's
   private closures):
     - dashboard mode: clicks the matching .side-link, drives
       #side-search-input, opens the board via #side-board-btn.
     - index mode: clicks the matching .cat-tab (spawns a floating
       window via app.js's own click handler); there's no feed
       search on this page, so a search request here just points
       the person at the dashboard/DEEPER page instead of failing
       silently.

   No server, no LLM API key in THIS file: this is a lightweight
   rule-based catalog assistant over real Drive folder names, not a
   hosted AI backend. (See content-studio.js for the actual
   AI-generation panel, which talks to a separate backend contract
   instead of embedding provider keys client-side.)
============================================================ */
(function () {
  'use strict';

  var MODE = document.getElementById('dash-feed') ? 'dashboard'
           : document.getElementById('cat-tabs') ? 'index'
           : null;
  if (!MODE) return; // neither known shell — safe no-op

  /* ---------------- Config (read-only, mirrors app.js/dashboard.js) ---------------- */
  var CONFIG = {
    driveRootFolderId: '1zno_n1n23dbIb4HE8giapSAqGS9WZd33',
    driveApiKey: 'AIzaSyCqU3qT5SaRYTZev6ZfChJvApRDGDzv88Y'
  };
  var FOLDER_MIME = 'application/vnd.google-apps.folder';
  var DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function titleFromName(name) {
    return name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  /* ---------------- Minimal, cached, read-only catalog lookup ---------------- */
  var catalog = { categories: null, tags: {} };

  function driveListFolders(parentId) {
    var q = encodeURIComponent("'" + parentId + "' in parents and trashed=false and mimeType='" + FOLDER_MIME + "'");
    var url = DRIVE_FILES_URL + '?q=' + q + '&key=' + CONFIG.driveApiKey +
      '&fields=' + encodeURIComponent('files(id,name)') + '&pageSize=1000&orderBy=name';
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('Drive API error ' + r.status); return r.json(); })
      .then(function (data) { return (data.files || []).map(function (f) { return { id: f.id, name: f.name, title: titleFromName(f.name) }; }); });
  }

  function getCategories() {
    if (catalog.categories) return Promise.resolve(catalog.categories);
    return driveListFolders(CONFIG.driveRootFolderId).then(function (cats) { catalog.categories = cats; return cats; });
  }

  function getTags(cat) {
    if (catalog.tags[cat.id]) return Promise.resolve(catalog.tags[cat.id]);
    return driveListFolders(cat.id).then(function (tags) { catalog.tags[cat.id] = tags; return tags; });
  }

  function findCategoryInText(text, cats) {
    var lower = text.toLowerCase();
    var best = null;
    cats.forEach(function (c) {
      if (lower.indexOf(c.title.toLowerCase()) !== -1 || lower.indexOf(c.name.toLowerCase()) !== -1) {
        if (!best || c.title.length > best.title.length) best = c;
      }
    });
    return best;
  }

  /* ---------------- UI shell ---------------- */
  var panel, body, input, sendBtn, toggleBtn;

  function buildUI() {
    toggleBtn = el('button', 'rwx-chat-toggle', '<span class="rwx-chat-dot"></span><span>ASK RAWX</span>');
    toggleBtn.addEventListener('click', openPanel);
    document.body.appendChild(toggleBtn);

    panel = el('div', 'rwx-chat-panel');
    panel.innerHTML =
      '<div class="rwx-chat-head">' +
        '<span class="rwx-chat-head-title">CATALOG <b>ASSISTANT</b></span>' +
        '<button class="rwx-chat-close" title="Close">✕</button>' +
      '</div>' +
      '<div class="rwx-chat-body" id="rwx-chat-body"></div>' +
      '<div class="rwx-chat-input-row">' +
        '<input type="text" id="rwx-chat-input" placeholder="ASK ABOUT THE CATALOG…" autocomplete="off">' +
        '<button class="rwx-chat-send" id="rwx-chat-send">SEND</button>' +
      '</div>';
    document.body.appendChild(panel);

    body = qs('#rwx-chat-body', panel);
    input = qs('#rwx-chat-input', panel);
    sendBtn = qs('#rwx-chat-send', panel);

    qs('.rwx-chat-close', panel).addEventListener('click', closePanel);
    sendBtn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });

    greet();
  }

  function openPanel() {
    panel.classList.add('open');
    toggleBtn.classList.add('rwx-chat-hide');
    input.focus();
  }
  function closePanel() {
    panel.classList.remove('open');
    toggleBtn.classList.remove('rwx-chat-hide');
  }

  function scrollToEnd() { body.scrollTop = body.scrollHeight; }

  function addMessage(role, html) {
    var msg = el('div', 'rwx-chat-msg rwx-chat-msg-' + role, html);
    body.appendChild(msg);
    scrollToEnd();
    return msg;
  }

  function addChips(labels, onPick) {
    var wrap = el('div', 'rwx-chat-chips');
    labels.forEach(function (label) {
      var chip = el('button', 'rwx-chat-chip', escapeHtml(label));
      chip.addEventListener('click', function () { onPick(label); });
      wrap.appendChild(chip);
    });
    body.appendChild(wrap);
    scrollToEnd();
  }

  function showTyping() {
    var t = el('div', 'rwx-chat-typing', '<span></span><span></span><span></span>');
    body.appendChild(t);
    scrollToEnd();
    return t;
  }

  function greet() {
    if (MODE === 'dashboard') {
      addMessage('bot', 'Hey — I can answer questions about what\u2019s in the RAWX catalog: sections, what\u2019s inside one, or filter the feed for you. Try one below, or just type.');
      addChips(['What sections do you have?', 'Search the feed'], function (label) { input.value = label; submit(); });
    } else {
      addMessage('bot', 'Hey — I can tell you what sections are on the LAB desktop and open one as a floating window for you. Try one below, or just type.');
      addChips(['What sections do you have?'], function (label) { input.value = label; submit(); });
    }
  }

  /* ---------------- Actions on the existing UI (mode-aware) ---------------- */
  function runSearch(term) {
    if (MODE !== 'dashboard') return false;
    var all = qs('#side-link-all');
    if (all) all.click();
    var searchInput = qs('#side-search-input');
    if (!searchInput) return false;
    searchInput.value = term;
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('dash-feed').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }

  function openCategory(catTitle) {
    if (MODE === 'dashboard') {
      var link = Array.prototype.find.call(document.querySelectorAll('.side-link'), function (a) {
        return qs('.side-link-name', a) && qs('.side-link-name', a).textContent.trim().toLowerCase() === catTitle.toLowerCase();
      });
      if (link) { link.click(); document.getElementById('dash-feed').scrollIntoView({ behavior: 'smooth', block: 'start' }); return true; }
      return false;
    }
    // index mode: click the matching .cat-tab, which app.js's own
    // handler turns into spawnWindow(cat) — a floating window.
    var tab = Array.prototype.find.call(document.querySelectorAll('.cat-tab'), function (b) {
      return b.textContent.trim().toLowerCase() === catTitle.toLowerCase();
    });
    if (tab) { tab.click(); return true; }
    return false;
  }

  function openBoard() {
    var btn = MODE === 'dashboard' ? qs('#side-board-btn') : qs('#taskbar-board-btn');
    if (btn) btn.click();
  }

  /* ---------------- Intent handling ---------------- */
  function submit() {
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMessage('user', escapeHtml(text));
    respond(text);
  }

  function respond(text) {
    var lower = text.toLowerCase();
    var typing = showTyping();

    function finish(render) {
      typing.remove();
      render();
    }

    if (/\b(hi|hello|hey)\b/.test(lower) && lower.length < 20) {
      finish(function () {
        addMessage('bot', MODE === 'dashboard'
          ? 'Hi! Ask me about sections, what\u2019s inside one, or say "search for <something>".'
          : 'Hi! Ask me about sections, or say "open <section name>" and I\u2019ll spawn its window.');
      });
      return;
    }

    if (/help|what can you do/.test(lower)) {
      finish(function () {
        addMessage('bot', MODE === 'dashboard'
          ? 'I can:<br>\u2022 List the catalog\u2019s sections<br>\u2022 List what\u2019s inside a section<br>\u2022 Filter the feed by a search term<br>\u2022 Open your pinned board'
          : 'I can:<br>\u2022 List the catalog\u2019s sections<br>\u2022 List what\u2019s inside a section<br>\u2022 Open a section as a floating window<br>\u2022 Open your pinned board');
      });
      return;
    }

    if (/pinned|board/.test(lower)) {
      finish(function () { addMessage('bot', 'Opening your pinned-assets board.'); openBoard(); });
      return;
    }

    if (/section|categor/.test(lower) && /what|list|show|which/.test(lower)) {
      getCategories().then(function (cats) {
        finish(function () {
          if (!cats.length) { addMessage('bot', 'The catalog hasn\u2019t finished loading its sections yet — give it a second and try again.'); return; }
          addMessage('bot', 'The catalog has ' + cats.length + ' section' + (cats.length === 1 ? '' : 's') + ':');
          addChips(cats.map(function (c) { return c.title; }), function (label) {
            input.value = (MODE === 'dashboard' ? 'what\'s in ' : 'open ') + label;
            submit();
          });
        });
      }).catch(function () { finish(function () { addMessage('bot', 'Couldn\u2019t reach the catalog just now — try again in a moment.'); }); });
      return;
    }

    if (/search|find/.test(lower)) {
      var term = text.replace(/^(search( the feed)? for|find|search)\s*/i, '').trim();
      finish(function () {
        if (MODE !== 'dashboard') {
          addMessage('bot', 'Search only works on THE FEED page. Head to <a href="dashboard.html" style="color:var(--red);">dashboard.html</a> (DEEPER) and I can filter it for you there — or tell me a section name and I\u2019ll open it right here instead.');
          return;
        }
        if (!term) { addMessage('bot', 'What should I search the feed for?'); return; }
        addMessage('bot', 'Filtering the feed for \u201c' + escapeHtml(term) + '\u201d.');
        runSearch(term);
      });
      return;
    }

    getCategories().then(function (cats) {
      var matchedCat = findCategoryInText(lower, cats);
      if (matchedCat && /what|in |inside|open|go to|show/.test(lower)) {
        return getTags(matchedCat).then(function (tags) {
          finish(function () {
            if (!tags.length) {
              addMessage('bot', '"' + escapeHtml(matchedCat.title) + '" has no sub-sections \u2014 opening it now.');
            } else {
              addMessage('bot', '"' + escapeHtml(matchedCat.title) + '" contains: ' + tags.map(function (t) { return escapeHtml(t.title); }).join(', ') + '.');
            }
            openCategory(matchedCat.title);
          });
        });
      }
      if (matchedCat) {
        finish(function () { addMessage('bot', 'Opening "' + escapeHtml(matchedCat.title) + '".'); openCategory(matchedCat.title); });
        return;
      }
      finish(function () {
        addMessage('bot', MODE === 'dashboard'
          ? 'Not sure I caught that. I can list sections, tell you what\u2019s inside one, filter the feed, or open your board \u2014 try asking one of those.'
          : 'Not sure I caught that. I can list sections, tell you what\u2019s inside one, open a section as a window, or open your board \u2014 try asking one of those.');
      });
    }).catch(function () {
      finish(function () { addMessage('bot', 'Couldn\u2019t reach the catalog just now \u2014 try again in a moment.'); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI);
  else buildUI();
})();
