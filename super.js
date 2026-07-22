/* ============================================================
   RAWX MOTION LAB — SUPER-APP LAYER (additive only)
   Loaded after app.js (index.html) or dashboard.js (dashboard.html).
   Never edits, calls into, or depends on internals of either file —
   everything here works purely through the DOM and localStorage, so
   it can be dropped onto both pages with a single <link>+<script>
   include and cannot break any existing feature.
============================================================ */
(function () {
  'use strict';

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function loadPref(key, fallback) { try { var v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; } }
  function savePref(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
  function showToast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }
  var isDashboard = !!document.getElementById('dash-feed');
  var isDesktopOS = !!document.getElementById('desktop');

  /* ================================================================
     1. HLS.js auto-attach — any <video> whose src is a .m3u8 gets
     adaptive playback the moment it lands in the DOM. Native Safari/
     iOS HLS is left alone (it already plays .m3u8 without help).
     Everything else (.mp4 from R2/Drive, the vast majority of assets
     today) is completely untouched.
  ================================================================ */
  var hlsJsPromise = null;
  function loadHlsJs() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsJsPromise) return hlsJsPromise;
    hlsJsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
      s.onload = function () { resolve(window.Hls); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return hlsJsPromise;
  }
  function maybeHlsify(video) {
    var src = video.getAttribute('src') || video.getAttribute('data-base-src') || '';
    if (!/\.m3u8(\?|$)/i.test(src) || video.dataset.rwxHls) return;
    video.dataset.rwxHls = '1';
    if (video.canPlayType && video.canPlayType('application/vnd.apple.mpegurl')) return; // native support
    loadHlsJs().then(function (Hls) {
      if (!Hls || !Hls.isSupported()) return;
      var hls = new Hls({ maxBufferLength: 30 });
      hls.loadSource(src);
      hls.attachMedia(video);
    }).catch(function () {});
  }
  function scanForHls(root) {
    if (root.tagName === 'VIDEO') maybeHlsify(root);
    qsa('video', root).forEach(maybeHlsify);
  }
  new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      m.addedNodes.forEach(function (n) { if (n.nodeType === 1) scanForHls(n); });
    });
  }).observe(document.body, { childList: true, subtree: true });

  /* ================================================================
     2. Ecosystem PANELS menu — adds BLOOM / VAULT / OS to whatever
     is already in #panels-menu, and gives every entry a small "open
     as floating window" launch button next to the existing link
     (which still navigates normally on its own).
  ================================================================ */
  var ECOSYSTEM_EXTRA = [
    { href: 'https://bloom-app.handsandhead.com', label: 'BLOOM', sub: 'AI text generator' },
    { href: 'https://vault.handsandhead.com', label: 'VAULT', sub: 'RAW asset & storage terminal' },
    { href: 'https://os.handsandhead.com', label: 'OS', sub: 'Full Motion OS workstation' }
  ];
  function initPanelsMenu() {
    var menu = document.getElementById('panels-menu');
    if (!menu) return;
    var existingHrefs = qsa('a.panels-item', menu).map(function (a) { return a.getAttribute('href'); });
    ECOSYSTEM_EXTRA.forEach(function (item) {
      if (existingHrefs.indexOf(item.href) !== -1) return;
      var a = el('a', 'panels-item', item.label + ' <span>' + escapeHtml(item.sub) + '</span>');
      a.href = item.href;
      a.target = '_blank';
      a.rel = 'noopener';
      menu.appendChild(a);
    });
    // Launch-as-window button next to every panel link (own tab/window nav untouched).
    qsa('a.panels-item', menu).forEach(function (a) {
      if (a.classList.contains('panels-item-current') || a.dataset.rwxLaunch) return;
      a.dataset.rwxLaunch = '1';
      var btn = el('button', 'rwx-iwin-launch-btn', '\u25a2 WINDOW');
      btn.title = 'Open ' + a.textContent.trim() + ' as a floating window';
      btn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        openIframeWindow(a.href, a.childNodes[0] ? a.childNodes[0].textContent.trim() : 'PANEL');
        menu.classList.remove('open');
        var navBtn = document.getElementById('panels-nav-btn');
        if (navBtn) navBtn.classList.remove('open');
      });
      a.appendChild(btn);
    });
  }

  /* ================================================================
     3. Floating iframe launcher window — generic, draggable,
     resizable, with a visible "open in new tab instead" fallback in
     case the target blocks framing (X-Frame-Options / CSP).
  ================================================================ */
  var iwinZ = 2500;
  function openIframeWindow(url, title) {
    var count = qsa('.rwx-iwin').length;
    var box = el('div', 'rwx-iwin');
    box.style.left = (80 + count * 28) + 'px';
    box.style.top = (70 + count * 24) + 'px';
    box.style.width = '760px';
    box.style.height = '520px';
    box.style.zIndex = ++iwinZ;
    box.innerHTML =
      '<div class="rwx-iwin-bar">' +
        '<span>' + escapeHtml(title || 'PANEL') + '</span>' +
        '<div class="rwx-iwin-bar-actions">' +
          '<button class="rwx-iwin-tab" title="Open in new tab">\u2197</button>' +
          '<button class="rwx-iwin-close" title="Close">\u2715</button>' +
        '</div>' +
      '</div>' +
      '<div class="rwx-iwin-body">' +
        '<iframe src="' + url + '" referrerpolicy="no-referrer"></iframe>' +
        '<div class="rwx-iwin-fallback"><span>THIS SITE CAN\u2019T BE EMBEDDED.</span><a href="' + url + '" target="_blank" rel="noopener">OPEN IN NEW TAB \u2192</a></div>' +
      '</div>' +
      '<div class="rwx-iwin-resize"></div>';
    document.body.appendChild(box);

    var iframe = qs('iframe', box);
    var fallback = qs('.rwx-iwin-fallback', box);
    var loaded = false;
    iframe.addEventListener('load', function () { loaded = true; });
    // Heuristic: most framing blocks never fire 'load' with real content,
    // or fire it near-instantly with an empty document. Give it a window,
    // then reveal the "open in new tab" fallback if nothing rendered.
    setTimeout(function () {
      var blocked = false;
      try { blocked = !loaded; } catch (e) { blocked = true; }
      if (blocked) fallback.classList.add('show');
    }, 4000);

    qs('.rwx-iwin-close', box).addEventListener('click', function () { box.remove(); });
    qs('.rwx-iwin-tab', box).addEventListener('click', function () { window.open(url, '_blank', 'noopener'); });
    box.addEventListener('mousedown', function () { box.style.zIndex = ++iwinZ; });

    // Drag
    var bar = qs('.rwx-iwin-bar', box);
    var dragging = false, sx, sy, ox, oy;
    bar.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return;
      dragging = true; sx = e.clientX; sy = e.clientY;
      ox = parseInt(box.style.left, 10); oy = parseInt(box.style.top, 10);
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      box.style.left = Math.max(0, ox + (e.clientX - sx)) + 'px';
      box.style.top = Math.max(0, oy + (e.clientY - sy)) + 'px';
    });
    window.addEventListener('mouseup', function () { dragging = false; });

    // Resize
    var resizing = false, rsx, rsy, ow, oh;
    qs('.rwx-iwin-resize', box).addEventListener('mousedown', function (e) {
      resizing = true; rsx = e.clientX; rsy = e.clientY;
      ow = box.offsetWidth; oh = box.offsetHeight;
      e.preventDefault(); e.stopPropagation();
    });
    window.addEventListener('mousemove', function (e) {
      if (!resizing) return;
      box.style.width = Math.max(320, ow + (e.clientX - rsx)) + 'px';
      box.style.height = Math.max(220, oh + (e.clientY - rsy)) + 'px';
    });
    window.addEventListener('mouseup', function () { resizing = false; });

    return box;
  }

  /* ================================================================
     4. Command palette — Ctrl/Cmd+K or "/" (outside inputs) opens a
     fuzzy-filterable list of categories/sections + system commands.
  ================================================================ */
  function buildPaletteCommands() {
    var cmds = [];
    if (isDesktopOS) {
      qsa('.cat-tab').forEach(function (btn) {
        cmds.push({ label: 'OPEN WINDOW \u2014 ' + btn.textContent, tag: 'category', run: function () { btn.click(); } });
      });
    }
    if (isDashboard) {
      qsa('.side-link').forEach(function (a) {
        var name = qs('.side-link-name', a);
        cmds.push({ label: 'SECTION \u2014 ' + (name ? name.textContent : a.textContent), tag: 'section', run: function () { a.click(); } });
      });
    }
    qsa('.theme-select option').slice(0, 0); // no-op guard if selects differ
    ['brutalist-red', 'cyberpunk-green', 'electric-blue'].forEach(function (theme) {
      cmds.push({
        label: 'THEME \u2014 ' + theme.replace('-', ' ').toUpperCase(), tag: 'theme',
        run: function () {
          qsa('.theme-select').forEach(function (sel) {
            sel.value = theme;
            sel.dispatchEvent(new Event('change'));
          });
        }
      });
    });
    if (qs('.res-select')) {
      ['auto', '4k', '1080p', '720p'].forEach(function (res) {
        cmds.push({
          label: 'RESOLUTION \u2014 ' + res.toUpperCase(), tag: 'stream',
          run: function () {
            qsa('.res-select').forEach(function (sel) { sel.value = res; sel.dispatchEvent(new Event('change')); });
          }
        });
      });
    }
    cmds.push({ label: 'TOGGLE CRT / SCANLINE FX', tag: 'system', run: toggleCrt });
    cmds.push({ label: 'TOGGLE AMBIENT SOUNDSCAPE', tag: 'system', run: toggleSoundscape });
    if (qs('.spotlight-btn')) cmds.push({ label: 'TOGGLE SPOTLIGHT HOVER', tag: 'system', run: function () { qs('.spotlight-btn').click(); } });
    if (qs('.sync-loops-btn')) cmds.push({ label: 'SYNC ALL LOOPS', tag: 'system', run: function () { qs('.sync-loops-btn').click(); } });
    if (isDesktopOS) cmds.push({ label: 'TOGGLE PRESENTATION MODE', tag: 'system', run: function () { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', shiftKey: true })); } });
    var boardBtn = document.getElementById('taskbar-board-btn') || document.getElementById('side-board-btn');
    if (boardBtn) cmds.push({ label: 'OPEN BOARD / B2B TERMINAL', tag: 'system', run: function () { boardBtn.click(); } });
    qsa('#panels-menu a.panels-item').forEach(function (a) {
      var label = (a.childNodes[0] && a.childNodes[0].textContent || a.textContent).trim();
      cmds.push({ label: 'GO TO ' + label, tag: 'panel', run: function () { window.location.href = a.href; } });
      cmds.push({ label: 'OPEN ' + label + ' AS WINDOW', tag: 'panel', run: function () { openIframeWindow(a.href, label); } });
    });
    return cmds;
  }

  var palette = { overlay: null, input: null, list: null, items: [], active: 0 };
  function buildPaletteDOM() {
    var overlay = el('div', 'rwx-palette-overlay');
    overlay.innerHTML =
      '<div class="rwx-palette">' +
        '<input class="rwx-palette-input" placeholder="TYPE A COMMAND OR SECTION\u2026 (ESC TO CLOSE)" autocomplete="off">' +
        '<div class="rwx-palette-list"></div>' +
        '<div class="rwx-palette-hint">\u2191\u2193 NAVIGATE \u00b7 ENTER SELECT \u00b7 ESC CLOSE</div>' +
      '</div>';
    document.body.appendChild(overlay);
    palette.overlay = overlay;
    palette.input = qs('.rwx-palette-input', overlay);
    palette.list = qs('.rwx-palette-list', overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closePalette(); });
    palette.input.addEventListener('input', function () { renderPaletteList(palette.input.value); });
    palette.input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); runPaletteActive(); }
      else if (e.key === 'Escape') { closePalette(); }
    });
  }
  function renderPaletteList(query) {
    var q = (query || '').trim().toLowerCase();
    var all = buildPaletteCommands();
    var filtered = q ? all.filter(function (c) { return c.label.toLowerCase().indexOf(q) !== -1; }) : all.slice(0, 40);
    palette.items = filtered.slice(0, 40);
    palette.active = 0;
    palette.list.innerHTML = '';
    if (!palette.items.length) { palette.list.innerHTML = '<div class="rwx-palette-empty">NO MATCHES</div>'; return; }
    palette.items.forEach(function (cmd, i) {
      var row = el('div', 'rwx-palette-item' + (i === 0 ? ' rwx-active' : ''));
      row.innerHTML = '<span>' + escapeHtml(cmd.label) + '</span><span>' + escapeHtml(cmd.tag.toUpperCase()) + '</span>';
      row.addEventListener('mousedown', function (e) { e.preventDefault(); cmd.run(); closePalette(); });
      palette.list.appendChild(row);
    });
  }
  function movePalette(dir) {
    if (!palette.items.length) return;
    palette.active = (palette.active + dir + palette.items.length) % palette.items.length;
    qsa('.rwx-palette-item', palette.list).forEach(function (r, i) { r.classList.toggle('rwx-active', i === palette.active); });
    var activeEl = qsa('.rwx-palette-item', palette.list)[palette.active];
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }
  function runPaletteActive() {
    var cmd = palette.items[palette.active];
    if (cmd) cmd.run();
    closePalette();
  }
  function openPalette() {
    if (!palette.overlay) buildPaletteDOM();
    palette.overlay.classList.add('open');
    palette.input.value = '';
    renderPaletteList('');
    setTimeout(function () { palette.input.focus(); }, 0);
  }
  function closePalette() {
    if (palette.overlay) palette.overlay.classList.remove('open');
  }

  /* ================================================================
     5. CRT / scanline toggle
  ================================================================ */
  var crtOn = loadPref('rawx_crt', '0') === '1';
  function applyCrt() { document.body.classList.toggle('rwx-crt-on', crtOn); qsa('.rwx-crt-btn').forEach(function (b) { b.classList.toggle('rwx-active', crtOn); }); }
  function toggleCrt() {
    crtOn = !crtOn;
    savePref('rawx_crt', crtOn ? '1' : '0');
    applyCrt();
    showToast(crtOn ? 'CRT / SCANLINE FX ON' : 'CRT / SCANLINE FX OFF');
  }

  /* ================================================================
     6. Lo-fi ambient soundscape — fully procedural (Web Audio pad),
     no external audio file, so nothing to license or fail to load.
  ================================================================ */
  var Sound = { ctx: null, on: false, nodes: null, vol: parseFloat(loadPref('rawx_vol', '0.18')) };
  function ensureAudioGraph() {
    if (Sound.ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var ctx = new AC();
    var master = ctx.createGain();
    master.gain.value = Sound.vol;
    master.connect(ctx.destination);

    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    filter.connect(master);

    function pad(freq, detune) {
      var osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      var g = ctx.createGain();
      g.gain.value = 0.5;
      osc.connect(g); g.connect(filter);
      osc.start();
      return { osc: osc, gain: g };
    }
    var voices = [pad(110, 0), pad(164.81, 6), pad(220, -5)];

    // slow LFO breathing the filter cutoff for a drifting ambient feel
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 300;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    Sound.ctx = ctx;
    Sound.nodes = { master: master, voices: voices, lfo: lfo };
    ctx.suspend();
  }
  function toggleSoundscape() {
    ensureAudioGraph();
    if (!Sound.ctx) { showToast('AMBIENT AUDIO NOT SUPPORTED IN THIS BROWSER'); return; }
    Sound.on = !Sound.on;
    if (Sound.on) Sound.ctx.resume(); else Sound.ctx.suspend();
    qsa('.rwx-sound-btn').forEach(function (b) { b.classList.toggle('rwx-active', Sound.on); });
    showToast(Sound.on ? 'AMBIENT SOUNDSCAPE ON' : 'AMBIENT SOUNDSCAPE OFF');
  }
  function setSoundVolume(v) {
    Sound.vol = v;
    savePref('rawx_vol', String(v));
    if (Sound.nodes) Sound.nodes.master.gain.value = v;
  }

  /* ================================================================
     7. Floating action cluster (CRT / soundscape) — fixed position,
     works identically on both pages regardless of topbar layout.
  ================================================================ */
  function buildFab() {
    var fab = el('div', 'rwx-fab');
    fab.style.bottom = isDesktopOS ? '54px' : '16px';
    fab.innerHTML =
      '<button class="rwx-chip-btn rwx-crt-btn" title="Toggle CRT / scanline FX">\u25a3 CRT</button>' +
      '<div class="rwx-inline-controls">' +
        '<button class="rwx-chip-btn rwx-sound-btn" title="Toggle ambient soundscape">\u266b SOUND</button>' +
        '<input type="range" class="rwx-vol-slider" min="0" max="0.6" step="0.02" title="Soundscape volume">' +
      '</div>' +
      '<button class="rwx-chip-btn rwx-palette-btn" title="Command palette (Ctrl/Cmd+K)">\u2318K PALETTE</button>';
    document.body.appendChild(fab);
    qs('.rwx-crt-btn', fab).addEventListener('click', toggleCrt);
    qs('.rwx-sound-btn', fab).addEventListener('click', toggleSoundscape);
    qs('.rwx-vol-slider', fab).value = Sound.vol;
    qs('.rwx-vol-slider', fab).addEventListener('input', function (e) { setSoundVolume(parseFloat(e.target.value)); });
    qs('.rwx-palette-btn', fab).addEventListener('click', openPalette);
    applyCrt();
  }

  /* ================================================================
     8. Cross-tab sync bus — rawx_pinned / rawx_theme / rawx_resolution
     / rawx_recents already live in localStorage (written by app.js /
     dashboard.js). This just listens for the native 'storage' event
     (fires in *other* tabs automatically) and refreshes the on-screen
     counters/attributes here without re-implementing pin/theme logic.
  ================================================================ */
  function refreshPinCounts() {
    var n = 0;
    try { n = (JSON.parse(localStorage.getItem('rawx_pinned') || '[]')).length; } catch (e) {}
    ['#stat-pinned', '#taskbar-board-count', '#side-board-count'].forEach(function (sel) {
      var e = qs(sel); if (e) e.textContent = n;
    });
  }
  window.addEventListener('storage', function (e) {
    if (e.key === 'rawx_pinned') refreshPinCounts();
    if (e.key === 'rawx_theme' && e.newValue) {
      document.documentElement.setAttribute('data-theme', e.newValue);
      qsa('.theme-select').forEach(function (sel) { sel.value = e.newValue; });
    }
    if (e.key === 'rawx_resolution' && e.newValue) {
      qsa('.res-select').forEach(function (sel) { sel.value = e.newValue; });
    }
  });

  /* ================================================================
     9. Lightbox add-ons — frame-by-frame stepper (,/. keys + buttons)
     and a precision 0.25x–4.0x speed slider. Works against whichever
     lightbox video element exists (#lb-video, or any video inside
     #lb-media) on either page.
  ================================================================ */
  function currentLbVideo() { return qs('#lb-video') || qs('#lb-media video'); }
  function stepFrame(dir) {
    var v = currentLbVideo();
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, v.currentTime + dir * (1 / 30));
  }
  function initLightboxAddons() {
    var actions = qs('.lb-head-actions');
    if (!actions || qs('.rwx-lb-stepper')) return;
    var closeBtn = qs('.lb-close', actions);

    var stepper = el('div', 'rwx-lb-stepper');
    stepper.innerHTML =
      '<button class="rwx-lb-step-btn" title="Step back 1 frame (,)">\u25c0\u258e</button>' +
      '<button class="rwx-lb-step-btn" title="Step forward 1 frame (.)">\u258e\u25b6</button>';
    var speedWrap = el('div', 'rwx-lb-speed-wrap');
    speedWrap.innerHTML =
      '<input type="range" class="rwx-lb-speed-slider" min="0.25" max="4" step="0.05" value="1" title="Precision playback speed">' +
      '<span class="rwx-lb-speed-val">1.00x</span>';

    if (closeBtn) { actions.insertBefore(speedWrap, closeBtn); actions.insertBefore(stepper, speedWrap); }
    else { actions.appendChild(stepper); actions.appendChild(speedWrap); }

    qsa('.rwx-lb-step-btn', stepper)[0].addEventListener('click', function () { stepFrame(-1); });
    qsa('.rwx-lb-step-btn', stepper)[1].addEventListener('click', function () { stepFrame(1); });
    var slider = qs('.rwx-lb-speed-slider', speedWrap);
    var val = qs('.rwx-lb-speed-val', speedWrap);
    slider.addEventListener('input', function () {
      var v = currentLbVideo();
      var rate = parseFloat(slider.value);
      val.textContent = rate.toFixed(2) + 'x';
      if (v) v.playbackRate = rate;
    });
  }
  document.addEventListener('keydown', function (e) {
    var typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (typing) return;
    var lightboxOpen = qs('.lightbox') && qs('.lightbox').classList.contains('open');
    if (!lightboxOpen) return;
    if (e.key === ',') { e.preventDefault(); stepFrame(-1); }
    if (e.key === '.') { e.preventDefault(); stepFrame(1); }
  });
  // Lightbox markup gets rebuilt (innerHTML reset) each time it opens on
  // the OS shell page, so re-inject the addons whenever it changes.
  var lbHost = document.getElementById('lightbox');
  if (lbHost) new MutationObserver(initLightboxAddons).observe(lbHost, { childList: true, subtree: true });

  /* ================================================================
     10. Ambient glow — samples the poster/video frame's average color
     the first time a card is hovered and stores it as a CSS var, so
     the box-shadow glow (see super.css) roughly matches the clip.
  ================================================================ */
  var glowCanvas = document.createElement('canvas');
  glowCanvas.width = 8; glowCanvas.height = 8;
  var glowCtx = glowCanvas.getContext && glowCanvas.getContext('2d', { willReadFrequently: true });
  function sampleGlow(mediaEl, card) {
    if (!glowCtx || card.dataset.rwxGlowed) return;
    try {
      glowCtx.drawImage(mediaEl, 0, 0, 8, 8);
      var data = glowCtx.getImageData(0, 0, 8, 8).data;
      var r = 0, g = 0, b = 0, n = 0;
      for (var i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      card.style.setProperty('--rwx-glow', 'rgba(' + r + ',' + g + ',' + b + ',.55)');
      card.dataset.rwxGlowed = '1';
    } catch (e) { /* tainted canvas (cross-origin) — skip silently */ }
  }
  document.addEventListener('mouseover', function (e) {
    var card = e.target.closest && e.target.closest('.asset-card');
    if (!card) return;
    var media = qs('video, img', card);
    if (!media) return;
    if (media.tagName === 'VIDEO') {
      if (media.readyState >= 2) sampleGlow(media, card);
      else media.addEventListener('loadeddata', function once() { sampleGlow(media, card); media.removeEventListener('loadeddata', once); });
    } else if (media.complete) sampleGlow(media, card);
    else media.addEventListener('load', function once() { sampleGlow(media, card); media.removeEventListener('load', once); });
  }, true);

  /* ================================================================
     11. Dashboard-only: feed toolbar (shuffle / interleave / recency /
     media filter), masonry + density toggle, hero carousel built from
     whatever's already rendered. All DOM-level — never touches
     dashboard.js's internal Feed/Drive state.
  ================================================================ */
  function initDashboardExtras() {
    var feed = document.getElementById('dash-feed');
    var feedHead = document.querySelector('.feed-head');
    if (!feed || !feedHead) return;

    /* ---- Toolbar ---- */
    var toolbar = el('div', 'rwx-feed-toolbar');
    toolbar.innerHTML =
      '<select class="rwx-sort-select">' +
        '<option value="default">ORDER: AS LOADED</option>' +
        '<option value="newest">ORDER: NEWEST FIRST</option>' +
        '<option value="shuffle">ORDER: SHUFFLE (RANDOM SEED)</option>' +
        '<option value="interleave">ORDER: CATEGORY INTERLEAVE</option>' +
      '</select>' +
      '<select class="rwx-media-select">' +
        '<option value="all">MEDIA: ALL</option>' +
        '<option value="video">MEDIA: VIDEO ONLY</option>' +
        '<option value="image">MEDIA: IMAGE ONLY</option>' +
      '</select>' +
      '<button class="rwx-chip-btn rwx-masonry-btn" title="Toggle masonry layout">\u25a4 MASONRY</button>' +
      '<div class="win-size-toggle" style="display:inline-flex;border:1px solid var(--panel-line)">' +
        '<button data-size="s">S</button><button data-size="m" class="active">M</button><button data-size="l">L</button>' +
      '</div>';
    feedHead.insertAdjacentElement('afterend', toolbar);

    var sortSelect = qs('.rwx-sort-select', toolbar);
    var mediaSelect = qs('.rwx-media-select', toolbar);
    var masonryBtn = qs('.rwx-masonry-btn', toolbar);

    function cardsExcludingDividers() { return qsa('.asset-card', feed); }

    function applySort() {
      var mode = sortSelect.value;
      feed.classList.toggle('rwx-sort-active', mode !== 'default');
      var cards = cardsExcludingDividers();
      if (mode === 'default') return; // DOM already reflects load order; dividers stay visible
      var ordered;
      if (mode === 'newest') {
        ordered = cards.slice().reverse();
      } else if (mode === 'shuffle') {
        ordered = cards.slice();
        for (var i = ordered.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var tmp = ordered[i]; ordered[i] = ordered[j]; ordered[j] = tmp;
        }
      } else if (mode === 'interleave') {
        var buckets = {}, order = [];
        cards.forEach(function (c) {
          var kindEl = qs('.asset-card-kind', c);
          var key = kindEl ? kindEl.textContent : '';
          if (!buckets[key]) { buckets[key] = []; order.push(key); }
          buckets[key].push(c);
        });
        ordered = [];
        var more = true, idx = 0;
        while (more) {
          more = false;
          order.forEach(function (key) {
            if (buckets[key][idx]) { ordered.push(buckets[key][idx]); more = true; }
          });
          idx++;
        }
      } else { ordered = cards; }
      ordered.forEach(function (c) { feed.appendChild(c); });
    }
    sortSelect.addEventListener('change', applySort);
    // Re-apply whenever more cards stream in, so late-loading batches respect the chosen order too.
    new MutationObserver(function () { if (sortSelect.value !== 'default') applySort(); }).observe(feed, { childList: true });

    mediaSelect.addEventListener('change', function () {
      var mode = mediaSelect.value;
      cardsExcludingDividers().forEach(function (c) {
        var isVideo = !!qs('video', c);
        var hide = (mode === 'video' && !isVideo) || (mode === 'image' && isVideo);
        c.classList.toggle('rwx-media-hidden', hide);
      });
    });

    var masonryOn = loadPref('rawx_masonry', '0') === '1';
    function applyMasonry() {
      feed.classList.toggle('rwx-masonry', masonryOn);
      masonryBtn.classList.toggle('rwx-active', masonryOn);
    }
    masonryBtn.addEventListener('click', function () {
      masonryOn = !masonryOn;
      savePref('rawx_masonry', masonryOn ? '1' : '0');
      applyMasonry();
    });
    applyMasonry();

    var density = loadPref('rawx_density', 'm');
    function applyDensity() {
      feed.classList.remove('rwx-density-s', 'rwx-density-m', 'rwx-density-l');
      feed.classList.add('rwx-density-' + density);
      qsa('.win-size-toggle button', toolbar).forEach(function (b) { b.classList.toggle('active', b.dataset.size === density); });
    }
    qsa('.win-size-toggle button', toolbar).forEach(function (btn) {
      btn.addEventListener('click', function () { density = btn.dataset.size; savePref('rawx_density', density); applyDensity(); });
    });
    applyDensity();

    /* ---- Hero carousel: built once enough distinct categories have streamed in ---- */
    var heroBuilt = false;
    function tryBuildHero() {
      if (heroBuilt) return;
      var seen = {}, slides = [];
      qsa('.asset-card', feed).forEach(function (c) {
        var kindEl = qs('.asset-card-kind', c);
        var key = kindEl ? kindEl.textContent : '';
        if (!key || seen[key]) return;
        var video = qs('video', c), img = qs('img', c);
        seen[key] = true;
        slides.push({
          label: (qs('.asset-card-label span', c) || {}).textContent || key,
          kind: key,
          videoSrc: video ? (video.getAttribute('data-base-src') || video.currentSrc) : null,
          poster: video ? video.getAttribute('poster') : (img ? img.getAttribute('src') : null)
        });
      });
      if (slides.length < 3) return;
      slides = slides.slice(0, 6);
      heroBuilt = true;

      var hero = el('div', 'rwx-hero-carousel');
      var slidesHtml = slides.map(function (s, i) {
        var media = s.videoSrc
          ? '<video src="' + s.videoSrc + '" poster="' + (s.poster || '') + '" muted loop playsinline preload="none"></video>'
          : '<img src="' + (s.poster || '') + '" alt="">';
        return '<div class="rwx-hero-slide' + (i === 0 ? ' rwx-active' : '') + '" data-i="' + i + '">' + media +
          '<div class="rwx-hero-caption"><b>' + escapeHtml(s.label) + '</b><span>' + escapeHtml(s.kind) + '</span></div></div>';
      }).join('');
      var jumpHtml = slides.map(function (s) { return '<button data-kind="' + escapeHtml(s.kind) + '">' + escapeHtml(s.kind) + '</button>'; }).join('');
      var dotsHtml = slides.map(function (s, i) { return '<button class="rwx-hero-dot' + (i === 0 ? ' rwx-active' : '') + '" data-i="' + i + '"></button>'; }).join('');
      hero.innerHTML =
        '<div class="rwx-hero-jump">' + jumpHtml + '</div>' +
        slidesHtml +
        '<div class="rwx-hero-dots">' + dotsHtml + '</div>';
      feedHead.insertAdjacentElement('beforebegin', hero);

      var active = 0;
      function goTo(i) {
        active = (i + slides.length) % slides.length;
        qsa('.rwx-hero-slide', hero).forEach(function (s, idx) {
          s.classList.toggle('rwx-active', idx === active);
          var v = qs('video', s);
          if (!v) return;
          if (idx === active) v.play().catch(function () {}); else v.pause();
        });
        qsa('.rwx-hero-dot', hero).forEach(function (d, idx) { d.classList.toggle('rwx-active', idx === active); });
      }
      qsa('.rwx-hero-dot', hero).forEach(function (d) { d.addEventListener('click', function () { goTo(parseInt(d.dataset.i, 10)); resetAuto(); }); });
      qsa('.rwx-hero-jump button', hero).forEach(function (b) {
        b.addEventListener('click', function () {
          var link = qsa('.side-link-name').find ? null : null;
          var links = qsa('.side-link');
          var match = links.find(function (a) {
            var n = qs('.side-link-name', a);
            return n && n.textContent.trim() === b.dataset.kind.trim();
          });
          if (match) match.click();
          else showToast('OPEN A SECTION FROM THE SIDEBAR FOR "' + b.dataset.kind + '"');
        });
      });
      var autoTimer;
      function resetAuto() { clearInterval(autoTimer); autoTimer = setInterval(function () { goTo(active + 1); }, 5500); }
      resetAuto();
      goTo(0);
    }
    new MutationObserver(tryBuildHero).observe(feed, { childList: true });
    tryBuildHero();
  }

  /* ================================================================
     Boot
  ================================================================ */
  function boot() {
    initPanelsMenu();
    // Panels menu on the desktop OS page is only built after Drive
    // categories resolve on the taskbar launcher, but #panels-menu
    // itself is static markup present at load — still, re-run once
    // shortly after in case menu contents changed.
    setTimeout(initPanelsMenu, 800);

    buildFab();
    applyCrt();
    refreshPinCounts();
    initLightboxAddons();

    if (isDashboard) initDashboardExtras();

    document.addEventListener('keydown', function (e) {
      var typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); return; }
      if (!typing && e.key === '/') { e.preventDefault(); openPalette(); return; }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
