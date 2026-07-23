/* ============================================================
   RAWX MOTION LAB — CONTENT STUDIO (additive only)
   A fifth additive layer, same philosophy as super.js/firebase.js/
   chatbot.js: never edits, calls into, or depends on internals of
   app.js, dashboard.js, super.js, firebase.js, or chatbot.js.

   MODE-AWARE (same detection pattern as chatbot.js):
     - #dash-feed present  -> "dashboard" mode
     - #cat-tabs present   -> "index"     mode
     - neither present     -> no-op

   WHAT IT DOES: a small "CONTENT STUDIO" panel (bottom-right,
   mirrors the chatbot toggle on the bottom-left) for drafting a
   structured AI shot brief — category, style, notes — with a
   running local history kept in localStorage.

   OFFLINE-SAFE BY DEFAULT: CONFIG.apiEndpoint below is empty, so
   "GENERATE" always falls back to composing a clean, structured
   brief locally (nothing leaves the browser). Point
   CONFIG.apiEndpoint at your own backend (which should hold any
   provider API key server-side) to switch to live generation — this
   file never embeds a provider API key client-side, the same rule
   the rest of this codebase follows.
============================================================ */
(function () {
  'use strict';

  var MODE = document.getElementById('dash-feed') ? 'dashboard'
           : document.getElementById('cat-tabs') ? 'index'
           : null;
  if (!MODE) return;

  /* ---------------- Config ---------------- */
  var CONFIG = {
    // Point this at your own backend to enable live AI generation.
    // Left blank on purpose: no provider API key is ever embedded
    // client-side in this codebase.
    apiEndpoint: '',
    driveRootFolderId: '1zno_n1n23dbIb4HE8giapSAqGS9WZd33',
    driveApiKey: 'AIzaSyCqU3qT5SaRYTZev6ZfChJvApRDGDzv88Y',
    historyKey: 'rwxContentStudioHistory',
    historyLimit: 30
  };
  var FOLDER_MIME = 'application/vnd.google-apps.folder';
  var DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function titleFromName(name) {
    return name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function nowStamp() {
    var d = new Date();
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' \u00b7 ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------------- Categories (reuse public Drive folder listing, read-only) ---------------- */
  var catalog = { categories: null };
  function driveListFolders(parentId) {
    var q = encodeURIComponent("'" + parentId + "' in parents and trashed=false and mimeType='" + FOLDER_MIME + "'");
    var url = DRIVE_FILES_URL + '?q=' + q + '&key=' + CONFIG.driveApiKey +
      '&fields=' + encodeURIComponent('files(id,name)') + '&pageSize=1000&orderBy=name';
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('Drive API error ' + r.status); return r.json(); })
      .then(function (data) { return (data.files || []).map(function (f) { return { id: f.id, name: f.name, title: titleFromName(f.name) }; }); });
  }
  function getCategories() {
    if (catalog.categories) return Promise.resolve(catalog.categories);
    return driveListFolders(CONFIG.driveRootFolderId).then(function (cats) { catalog.categories = cats; return cats; }).catch(function () { return []; });
  }

  /* ---------------- History (localStorage) ---------------- */
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(CONFIG.historyKey)) || []; }
    catch (e) { return []; }
  }
  function saveHistory(list) {
    try { localStorage.setItem(CONFIG.historyKey, JSON.stringify(list.slice(0, CONFIG.historyLimit))); }
    catch (e) { /* storage unavailable — history just won't persist */ }
  }
  function pushHistory(entry) {
    var list = loadHistory();
    list.unshift(entry);
    saveHistory(list);
    return list;
  }

  /* ---------------- Brief composition (offline-safe fallback) ---------------- */
  function composeBriefLocally(fields) {
    var lines = [];
    lines.push('SHOT BRIEF');
    lines.push('Category: ' + (fields.category || 'Unspecified'));
    lines.push('Style: ' + (fields.style || 'Unspecified'));
    lines.push('');
    lines.push('Concept');
    lines.push((fields.notes || 'No notes provided.').trim());
    lines.push('');
    lines.push('Suggested coverage');
    lines.push('\u2022 Wide establishing pass, character centered, consistent lighting key');
    lines.push('\u2022 Medium loop with subtle wardrobe/prop motion to sell "alive" texture');
    lines.push('\u2022 Close detail insert (fabric, material, or expression) for edit cutaways');
    lines.push('');
    lines.push('Continuity notes');
    lines.push('Keep character identity, palette, and lighting direction locked across all takes in this category so clips can be interleaved on the feed without a visible seam.');
    return lines.join('\n');
  }

  function generateBrief(fields) {
    if (!CONFIG.apiEndpoint) {
      return Promise.resolve({ text: composeBriefLocally(fields), source: 'offline' });
    }
    return fetch(CONFIG.apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    }).then(function (r) {
      if (!r.ok) throw new Error('Backend error ' + r.status);
      return r.json();
    }).then(function (data) {
      return { text: data.text || composeBriefLocally(fields), source: 'live' };
    }).catch(function () {
      return { text: composeBriefLocally(fields), source: 'offline-fallback' };
    });
  }

  /* ---------------- UI shell ---------------- */
  var panel, toggleBtn, views = {}, tabs = {};
  var els = {};

  function buildUI() {
    toggleBtn = el('button', 'rwx-cs-toggle', '<span class="rwx-cs-dot"></span><span>CONTENT STUDIO</span>');
    toggleBtn.addEventListener('click', openPanel);
    document.body.appendChild(toggleBtn);

    panel = el('div', 'rwx-cs-panel');
    panel.innerHTML =
      '<div class="rwx-cs-head">' +
        '<span class="rwx-cs-head-title">CONTENT <b>STUDIO</b></span>' +
        '<button class="rwx-cs-close" title="Close">\u2715</button>' +
      '</div>' +
      '<div class="rwx-cs-tabs">' +
        '<button class="rwx-cs-tab rwx-active" data-view="generate">GENERATE</button>' +
        '<button class="rwx-cs-tab" data-view="history">HISTORY</button>' +
        '<button class="rwx-cs-tab" data-view="settings">SETTINGS</button>' +
      '</div>' +
      '<div class="rwx-cs-view rwx-active" data-view="generate">' +
        '<div class="rwx-cs-row">' +
          '<div class="rwx-cs-field">' +
            '<label>CATEGORY</label>' +
            '<select class="rwx-cs-select" id="rwx-cs-category"><option value="">Loading\u2026</option></select>' +
          '</div>' +
          '<div class="rwx-cs-field">' +
            '<label>STYLE</label>' +
            '<input type="text" class="rwx-cs-input" id="rwx-cs-style" placeholder="e.g. moody, editorial, sun-lit">' +
          '</div>' +
        '</div>' +
        '<div class="rwx-cs-field">' +
          '<label>NOTES</label>' +
          '<textarea class="rwx-cs-textarea" id="rwx-cs-notes" placeholder="Describe the shot, mood, wardrobe, motion\u2026"></textarea>' +
        '</div>' +
        '<button class="rwx-cs-generate-btn" id="rwx-cs-generate">GENERATE BRIEF</button>' +
        '<div class="rwx-cs-output-wrap" id="rwx-cs-output-wrap">' +
          '<div class="rwx-cs-output-meta"><span id="rwx-cs-output-source"></span><span id="rwx-cs-output-time"></span></div>' +
          '<div class="rwx-cs-output" id="rwx-cs-output"></div>' +
          '<div class="rwx-cs-output-actions">' +
            '<button id="rwx-cs-copy">COPY</button>' +
            '<button id="rwx-cs-save">SAVE TO HISTORY</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="rwx-cs-view" data-view="history">' +
        '<button class="rwx-cs-history-clear" id="rwx-cs-history-clear">CLEAR HISTORY</button>' +
        '<div id="rwx-cs-history-list"></div>' +
      '</div>' +
      '<div class="rwx-cs-view" data-view="settings">' +
        '<div class="rwx-cs-status-row"><span class="rwx-cs-status-dot" id="rwx-cs-status-dot"></span><span id="rwx-cs-status-text">Checking generation mode\u2026</span></div>' +
        '<p class="rwx-cs-hint">Content Studio drafts a structured shot brief from a category, a style, and free-form notes. By default it composes the brief locally in your browser \u2014 nothing is sent anywhere.</p>' +
        '<p class="rwx-cs-hint">To connect a live AI backend, set <code>CONFIG.apiEndpoint</code> at the top of <code>content-studio.js</code> to your own server route. That server should hold any provider API key \u2014 this file never embeds one client-side.</p>' +
        '<p class="rwx-cs-hint">History is stored only in this browser (<code>localStorage</code>), up to ' + CONFIG.historyLimit + ' entries.</p>' +
      '</div>';
    document.body.appendChild(panel);

    els.category = qs('#rwx-cs-category', panel);
    els.style = qs('#rwx-cs-style', panel);
    els.notes = qs('#rwx-cs-notes', panel);
    els.generateBtn = qs('#rwx-cs-generate', panel);
    els.outputWrap = qs('#rwx-cs-output-wrap', panel);
    els.output = qs('#rwx-cs-output', panel);
    els.outputSource = qs('#rwx-cs-output-source', panel);
    els.outputTime = qs('#rwx-cs-output-time', panel);
    els.copyBtn = qs('#rwx-cs-copy', panel);
    els.saveBtn = qs('#rwx-cs-save', panel);
    els.historyList = qs('#rwx-cs-history-list', panel);
    els.historyClear = qs('#rwx-cs-history-clear', panel);
    els.statusDot = qs('#rwx-cs-status-dot', panel);
    els.statusText = qs('#rwx-cs-status-text', panel);

    qs('.rwx-cs-close', panel).addEventListener('click', closePanel);

    Array.prototype.forEach.call(panel.querySelectorAll('.rwx-cs-tab'), function (btn) {
      tabs[btn.dataset.view] = btn;
      btn.addEventListener('click', function () { showView(btn.dataset.view); });
    });
    Array.prototype.forEach.call(panel.querySelectorAll('.rwx-cs-view'), function (v) {
      views[v.dataset.view] = v;
    });

    els.generateBtn.addEventListener('click', onGenerate);
    els.copyBtn.addEventListener('click', onCopy);
    els.saveBtn.addEventListener('click', onSaveCurrent);
    els.historyClear.addEventListener('click', onClearHistory);

    populateCategories();
    renderHistory();
    renderStatus();
  }

  function showView(name) {
    Object.keys(views).forEach(function (k) {
      views[k].classList.toggle('rwx-active', k === name);
      tabs[k].classList.toggle('rwx-active', k === name);
    });
    if (name === 'history') renderHistory();
  }

  function openPanel() {
    panel.classList.add('open');
    toggleBtn.classList.add('rwx-cs-hide');
  }
  function closePanel() {
    panel.classList.remove('open');
    toggleBtn.classList.remove('rwx-cs-hide');
  }

  function populateCategories() {
    getCategories().then(function (cats) {
      if (!cats.length) { els.category.innerHTML = '<option value="">General / uncategorized</option>'; return; }
      els.category.innerHTML = cats.map(function (c) { return '<option value="' + escapeHtml(c.title) + '">' + escapeHtml(c.title) + '</option>'; }).join('');
    });
  }

  function renderStatus() {
    var live = !!CONFIG.apiEndpoint;
    els.statusDot.classList.toggle('rwx-ok', live);
    els.statusDot.classList.toggle('rwx-bad', !live);
    els.statusText.textContent = live ? 'Live backend configured' : 'Offline mode \u2014 briefs are composed locally';
  }

  var currentEntry = null;

  function onGenerate() {
    var fields = { category: els.category.value, style: els.style.value.trim(), notes: els.notes.value.trim() };
    els.generateBtn.disabled = true;
    els.generateBtn.textContent = 'GENERATING\u2026';
    generateBrief(fields).then(function (result) {
      els.generateBtn.disabled = false;
      els.generateBtn.textContent = 'GENERATE BRIEF';
      els.output.textContent = result.text;
      els.outputSource.textContent = result.source === 'live' ? 'LIVE' : 'OFFLINE DRAFT';
      els.outputTime.textContent = nowStamp();
      els.outputWrap.classList.add('rwx-show');
      currentEntry = { fields: fields, text: result.text, source: result.source, time: nowStamp() };
    });
  }

  function onCopy() {
    if (!currentEntry) return;
    var doCopy = function () {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(currentEntry.text);
      var ta = document.createElement('textarea');
      ta.value = currentEntry.text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
      return Promise.resolve();
    };
    doCopy().then(function () {
      var original = els.copyBtn.textContent;
      els.copyBtn.textContent = 'COPIED';
      setTimeout(function () { els.copyBtn.textContent = original; }, 1400);
    });
  }

  function onSaveCurrent() {
    if (!currentEntry) return;
    pushHistory(currentEntry);
    var original = els.saveBtn.textContent;
    els.saveBtn.textContent = 'SAVED';
    setTimeout(function () { els.saveBtn.textContent = original; }, 1400);
  }

  function renderHistory() {
    var list = loadHistory();
    if (!list.length) {
      els.historyList.innerHTML = '<div class="rwx-cs-history-empty">No saved briefs yet \u2014 generate one and hit "Save to history".</div>';
      return;
    }
    els.historyList.innerHTML = '';
    list.forEach(function (entry, idx) {
      var item = el('div', 'rwx-cs-history-item');
      item.innerHTML =
        '<div class="rwx-cs-history-item-meta"><span>' + escapeHtml(entry.fields.category || 'General') + '</span><span>' + escapeHtml(entry.time || '') + '</span></div>' +
        '<div class="rwx-cs-history-item-preview">' + escapeHtml(entry.text.slice(0, 160)) + '</div>';
      item.addEventListener('click', function () {
        currentEntry = entry;
        els.output.textContent = entry.text;
        els.outputSource.textContent = entry.source === 'live' ? 'LIVE' : 'OFFLINE DRAFT';
        els.outputTime.textContent = entry.time || '';
        els.outputWrap.classList.add('rwx-show');
        if (entry.fields) {
          els.style.value = entry.fields.style || '';
          els.notes.value = entry.fields.notes || '';
          if (entry.fields.category) els.category.value = entry.fields.category;
        }
        showView('generate');
      });
      els.historyList.appendChild(item);
    });
  }

  function onClearHistory() {
    saveHistory([]);
    renderHistory();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI);
  else buildUI();
})();
