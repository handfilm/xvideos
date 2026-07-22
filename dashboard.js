/* ============================================================
   RAWX MOTION LAB — FEED DASHBOARD ENGINE
   A second page, same brand. Left rail + one continuous masonry
   feed instead of floating windows. Pulls from the same Drive
   structure and R2 video host as the OS shell (app.js) and shares
   its pin/theme state via localStorage — but this file is fully
   self-contained (no dependency on app.js loading first).

   THE LOOP: this feed does not fabricate infinite content. Once
   every asset that's been loaded so far has been shown, it visibly
   re-circulates the same set and marks the seam with a divider
   ("— LOOP 2 —") rather than pretending there's always more.
============================================================ */
(function () {
  'use strict';

  /* ---------------- Config (mirrors app.js) ---------------- */
  var CONFIG = {
    driveRootFolderId: '1zno_n1n23dbIb4HE8giapSAqGS9WZd33',
    driveApiKey: 'AIzaSyCqU3qT5SaRYTZev6ZfChJvApRDGDzv88Y',
    pageSize: 60,
    r2Enabled: true,
    r2BaseUrl: 'https://xvideos.handsandhead.com'
  };

  var TAGS_PER_BATCH = 6;      // how many tag folders we pull one fresh page from per scroll trigger
  var MAX_RENDERED_CARDS = 240; // memory guard: DOM cards get trimmed from the top past this

  var FOLDER_MIME = 'application/vnd.google-apps.folder';
  var DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

  /* ---------------- Small utils ---------------- */
  function titleFromName(name) {
    return name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function setBootStatus(t) { var e = document.getElementById('boot-status'); if (e) e.textContent = t; }
  function showToast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function loadPref(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; } }
  function savePref(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }

  /* ================================================================
     DRIVE DATA LAYER — identical contract to app.js, kept separate
     since this page has no build step / module system to share it.
  ================================================================ */
  var Drive = { categories: null, tags: {}, filePages: {} };

  function driveList(parentId, foldersOnly, pageToken) {
    var mimeClause = foldersOnly ? " and mimeType='" + FOLDER_MIME + "'" : " and mimeType!='" + FOLDER_MIME + "'";
    var q = encodeURIComponent("'" + parentId + "' in parents and trashed=false" + mimeClause);
    var fields = foldersOnly ? 'nextPageToken,files(id,name)' : 'nextPageToken,files(id,name,mimeType,thumbnailLink)';
    var url = DRIVE_FILES_URL + '?q=' + q + '&key=' + CONFIG.driveApiKey +
      '&fields=' + encodeURIComponent(fields) +
      '&pageSize=' + (foldersOnly ? 1000 : CONFIG.pageSize) + '&orderBy=name' +
      (pageToken ? '&pageToken=' + pageToken : '');
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('Drive API error ' + r.status); return r.json(); });
  }

  function getCategories() {
    if (Drive.categories) return Promise.resolve(Drive.categories);
    return driveList(CONFIG.driveRootFolderId, true).then(function (data) {
      Drive.categories = (data.files || []).map(function (f) { return { id: f.id, name: f.name, title: titleFromName(f.name) }; });
      return Drive.categories;
    });
  }
  function getTags(catId) {
    if (Drive.tags[catId]) return Promise.resolve(Drive.tags[catId]);
    return driveList(catId, true).then(function (data) {
      var tags = (data.files || []).map(function (f) { return { id: f.id, name: f.name, title: titleFromName(f.name) }; });
      Drive.tags[catId] = tags;
      return tags;
    });
  }
  function findFolderNames(tagId) {
    if (!Drive.categories) return null;
    for (var c = 0; c < Drive.categories.length; c++) {
      var cat = Drive.categories[c];
      if (cat.id === tagId) return { category: cat.name, tag: null };
      var tags = Drive.tags[cat.id];
      if (!tags) continue;
      for (var t = 0; t < tags.length; t++) if (tags[t].id === tagId) return { category: cat.name, tag: tags[t].name };
    }
    return null;
  }
  function buildR2StreamSrc(file, folderNames) {
    if (!CONFIG.r2Enabled || !CONFIG.r2BaseUrl || !folderNames) return null;
    var base = CONFIG.r2BaseUrl.replace(/\/+$/, '');
    var parts = [encodeURIComponent(folderNames.category)];
    if (folderNames.tag) parts.push(encodeURIComponent(folderNames.tag));
    parts.push(encodeURIComponent(file.name));
    return base + '/' + parts.join('/');
  }
  function parseDriveFile(file, folderNames) {
    var isVideo = !!(file.mimeType && file.mimeType.indexOf('video/') === 0);
    var driveStreamSrc = isVideo ? DRIVE_FILES_URL + '/' + file.id + '?alt=media&key=' + CONFIG.driveApiKey : null;
    var r2StreamSrc = isVideo ? buildR2StreamSrc(file, folderNames) : null;
    return {
      id: file.id,
      title: titleFromName(file.name),
      isVideo: isVideo,
      src: 'https://drive.google.com/thumbnail?id=' + file.id + '&sz=w800',
      poster: file.thumbnailLink ? file.thumbnailLink.replace(/=s\d+$/, '=s1200') : 'https://drive.google.com/thumbnail?id=' + file.id + '&sz=w1200',
      streamSrc: r2StreamSrc || driveStreamSrc,
      fallbackSrc: driveStreamSrc,
      catName: folderNames ? folderNames.category : null,
      tagName: folderNames ? folderNames.tag : null
    };
  }
  function fetchNextPage(tagId) {
    var cache = Drive.filePages[tagId];
    if (!cache) cache = Drive.filePages[tagId] = { items: [], nextPageToken: undefined, done: false, loading: false };
    if (cache.loading || cache.done) return Promise.resolve(cache);
    cache.loading = true;
    var folderNames = findFolderNames(tagId);
    return driveList(tagId, false, cache.nextPageToken).then(function (data) {
      var items = (data.files || []).map(function (f) { return parseDriveFile(f, folderNames); });
      cache.items = cache.items.concat(items);
      cache.nextPageToken = data.nextPageToken || null;
      cache.done = !cache.nextPageToken;
      cache.loading = false;
      return { cache: cache, freshItems: items };
    }).catch(function (err) { cache.loading = false; cache.error = err; throw err; });
  }

  function bindVideoFallback(video) {
    video.addEventListener('error', function () {
      var fallback = video.getAttribute('data-fallback-src');
      if (!fallback || video.dataset.fallbackTried || video.src === fallback) return;
      video.dataset.fallbackTried = '1';
      video.src = fallback; video.load();
      if (video.hasAttribute('autoplay') || video.matches(':hover')) video.play().catch(function () {});
    });
  }

  /* ---------------- Pins (shared with the OS shell page) ---------------- */
  var pinned = loadPinned();
  function loadPinned() { try { return JSON.parse(localStorage.getItem('rawx_pinned') || '[]'); } catch (e) { return []; } }
  function savePinned() { try { localStorage.setItem('rawx_pinned', JSON.stringify(pinned)); } catch (e) {} }
  function isPinned(item) { return pinned.some(function (p) { return p.id === item.id; }); }
  function togglePin(item) {
    var idx = pinned.findIndex(function (p) { return p.id === item.id; });
    if (idx === -1) pinned.push({ id: item.id, title: item.title, src: item.src, streamSrc: item.streamSrc, isVideo: item.isVideo, cat: item.catName, tag: item.tagName });
    else pinned.splice(idx, 1);
    savePinned(); renderPinStats();
  }
  function renderPinStats() {
    qs('#stat-pinned').textContent = pinned.length;
    qs('#side-board-count').textContent = pinned.length;
  }

  /* ---------------- Recents (dashboard-specific, own key) ---------------- */
  var RECENTS_MAX = 10;
  function loadRecents() { try { return JSON.parse(localStorage.getItem('rawx_recents') || '[]'); } catch (e) { return []; } }
  function saveRecents(list) { try { localStorage.setItem('rawx_recents', JSON.stringify(list)); } catch (e) {} }
  function pushRecent(item) {
    var list = loadRecents().filter(function (r) { return r.id !== item.id; });
    list.unshift({ id: item.id, title: item.title, src: item.src });
    saveRecents(list.slice(0, RECENTS_MAX));
    renderRecents();
  }
  function renderRecents() {
    var list = loadRecents();
    var wrap = qs('#side-recents'); var strip = qs('#side-recents-strip');
    wrap.hidden = list.length === 0;
    strip.innerHTML = '';
    list.forEach(function (r) {
      var t = el('div', 'side-recent-thumb', '<img src="' + r.src + '" alt="' + escapeHtml(r.title) + '" loading="lazy">');
      t.title = r.title;
      t.addEventListener('click', function () {
        var idx = Feed.rendered.findIndex(function (it) { return it.id === r.id; });
        if (idx !== -1) openLightbox(idx);
        else showToast('THAT ONE HAS SCROLLED OUT OF THE CURRENT FEED');
      });
      strip.appendChild(t);
    });
  }

  /* ================================================================
     FEED ENGINE
  ================================================================ */
  var Feed = {
    // per-filter-key state, so switching sections and back doesn't lose progress
    states: {},          // key ('' = all, or catId) -> { pool, cursor, masterItems, lap, exhausted }
    activeKey: '',
    rendered: [],         // flat list of items currently in the DOM, in order (for lightbox nav)
    searchTerm: ''
  };

  function stateFor(key) {
    if (!Feed.states[key]) Feed.states[key] = { pool: [], roundRobin: 0, masterItems: [], lap: 1, exhausted: false, loading: false };
    return Feed.states[key];
  }

  // Builds the interleaved fetch pool for a given filter: every tag folder
  // (or flat category acting as its own tag) belonging to the relevant
  // categories, ordered round-robin across categories so the feed reads
  // as "mixed" rather than one category dumping all its content first.
  function buildPool(filterCatId) {
    var cats = filterCatId ? Drive.categories.filter(function (c) { return c.id === filterCatId; }) : Drive.categories;
    var groups = cats.map(function (cat) {
      var tags = Drive.tags[cat.id] || [];
      if (!tags.length) return [{ tagId: cat.id, catName: cat.name, tagName: null }];
      return tags.map(function (t) { return { tagId: t.id, catName: cat.name, tagName: t.name }; });
    });
    var maxLen = Math.max.apply(null, groups.map(function (g) { return g.length; }).concat([0]));
    var order = [];
    for (var i = 0; i < maxLen; i++) groups.forEach(function (g) { if (g[i]) order.push(g[i]); });
    return order;
  }

  function currentState() { return stateFor(Feed.activeKey); }

  // Pulls one fresh page from the next few not-yet-exhausted tags in the
  // pool, appends any new items to this filter's master list, and renders
  // them. If every tag in the pool is already fully paginated, instead
  // re-appends the master list (a full lap) with a loop divider — this is
  // the only place "infinite" scroll actually recirculates instead of
  // fetching more.
  function loadNextBatch() {
    var state = currentState();
    if (state.loading) return;
    if (!state.pool.length) return;

    var anyPending = state.pool.some(function (p) { return !(Drive.filePages[p.tagId] && Drive.filePages[p.tagId].done); });

    if (!anyPending) {
      // Every tag folder in this section has been fully paginated at least
      // once — recirculate what we've got rather than stalling the feed.
      if (!state.masterItems.length) return; // truly empty section, nothing to loop
      state.lap += 1;
      renderLoopDivider(state.lap);
      renderItems(state.masterItems.filter(matchesSearch), true);
      updateStats();
      return;
    }

    state.loading = true;
    var picked = [];
    var i = 0;
    while (picked.length < TAGS_PER_BATCH && i < state.pool.length) {
      var p = state.pool[(state.roundRobin + i) % state.pool.length];
      var cache = Drive.filePages[p.tagId];
      if (!cache || !cache.done) picked.push(p);
      i++;
    }
    state.roundRobin = (state.roundRobin + picked.length) % Math.max(state.pool.length, 1);

    Promise.all(picked.map(function (p) { return fetchNextPage(p.tagId).catch(function () { return { freshItems: [] }; }); }))
      .then(function (results) {
        var fresh = [];
        results.forEach(function (r) { fresh = fresh.concat(r.freshItems || []); });
        state.masterItems = state.masterItems.concat(fresh);
        state.loading = false;
        renderItems(fresh.filter(matchesSearch), false);
        updateStats();
        if (!fresh.length) loadNextBatch(); // this pass hit only already-done tags; try again immediately
      }).catch(function () { state.loading = false; });
  }

  function matchesSearch(item) {
    if (!Feed.searchTerm) return true;
    var hay = (item.title + ' ' + (item.catName || '') + ' ' + (item.tagName || '')).toLowerCase();
    return hay.indexOf(Feed.searchTerm) !== -1;
  }

  /* ---------------- Rendering ---------------- */
  function renderLoopDivider(lap) {
    var feed = qs('#dash-feed');
    feed.appendChild(el('div', 'loop-divider', 'LOOP ' + lap));
  }

  function renderItems(items, isRecirculated) {
    if (!items.length) return;
    var feed = qs('#dash-feed');
    var frag = document.createDocumentFragment();
    items.forEach(function (item) {
      Feed.rendered.push(item);
      frag.appendChild(buildCard(item, Feed.rendered.length - 1));
    });
    feed.appendChild(frag);
    qs('#feed-empty').hidden = true;
    setupObservers();
    trimOldCards();
  }

  function buildCard(item, renderedIndex) {
    var card = el('div', 'asset-card');
    var kindLabel = item.tagName || item.catName || '';
    if (item.isVideo) {
      card.innerHTML = '<video src="' + item.streamSrc + '" data-fallback-src="' + item.fallbackSrc + '" poster="' + item.poster + '" muted loop playsinline preload="none" data-autoplay="1" data-base-src="' + item.streamSrc + '"></video>' +
        '<div class="asset-card-label"><span>' + escapeHtml(item.title) + '</span><span class="asset-card-kind">' + escapeHtml(kindLabel) + '</span></div>' +
        '<button class="asset-card-pin' + (isPinned(item) ? ' pinned' : '') + '" title="Pin">' + (isPinned(item) ? '\u2713' : '+') + '</button>';
      var v = qs('video', card);
      bindVideoFallback(v);
      card.addEventListener('mouseenter', function () { v.play().catch(function () {}); });
      card.addEventListener('mouseleave', function () { v.pause(); });
      card.addEventListener('mousemove', function (e) {
        if (!v.duration) return;
        var rect = card.getBoundingClientRect();
        var pct = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
        v.currentTime = pct * v.duration;
      });
      var touching = false;
      card.addEventListener('touchstart', function () { touching = true; v.play().catch(function () {}); }, { passive: true });
      card.addEventListener('touchmove', function (e) {
        if (!touching || !v.duration) return;
        var t = e.touches[0]; var rect = card.getBoundingClientRect();
        var pct = Math.min(Math.max((t.clientX - rect.left) / rect.width, 0), 1);
        v.currentTime = pct * v.duration;
      }, { passive: true });
      card.addEventListener('touchend', function () { touching = false; v.pause(); });
    } else {
      card.innerHTML = '<img src="' + item.src + '" alt="' + escapeHtml(item.title) + '" loading="lazy">' +
        '<div class="asset-card-label"><span>' + escapeHtml(item.title) + '</span><span class="asset-card-kind">' + escapeHtml(kindLabel) + '</span></div>' +
        '<button class="asset-card-pin' + (isPinned(item) ? ' pinned' : '') + '" title="Pin">' + (isPinned(item) ? '\u2713' : '+') + '</button>';
    }
    if (!matchesSearch(item)) card.classList.add('feed-hidden');
    qs('.asset-card-pin', card).addEventListener('click', function (e) {
      e.stopPropagation(); togglePin(item);
      this.classList.toggle('pinned'); this.textContent = isPinned(item) ? '\u2713' : '+';
    });
    card.addEventListener('click', function () { pushRecent(item); openLightbox(renderedIndex); });
    return card;
  }

  // Memory guard: past MAX_RENDERED_CARDS total DOM cards, drop the oldest
  // ones (they're the furthest above the viewport since we only append)
  // and nudge scroll position to compensate so nothing visibly jumps.
  function trimOldCards() {
    var feed = qs('#dash-feed');
    var nodes = qsa('.asset-card, .loop-divider', feed);
    if (nodes.length <= MAX_RENDERED_CARDS) return;
    var toRemove = nodes.length - MAX_RENDERED_CARDS;
    var removedHeight = 0;
    for (var i = 0; i < toRemove; i++) { removedHeight += nodes[i].offsetHeight; nodes[i].remove(); }
    if (removedHeight) window.scrollBy(0, -removedHeight);
    // Feed.rendered stays append-only on purpose — it backs lightbox
    // prev/next by index, which only ever moves forward from a click.
  }

  var autoplayObserver = null, memoryGuardObserver = null, revealObserver = null;
  function setupObservers() {
    if (typeof IntersectionObserver === 'undefined') { qsa('.asset-card').forEach(function (c) { c.classList.add('card-in-view'); }); return; }

    if (!autoplayObserver) {
      autoplayObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) e.target.play().catch(function () {}); else e.target.pause(); });
      }, { rootMargin: '150px 0px', threshold: 0.15 });
    }
    qsa('video[data-autoplay="1"]:not([data-observed])').forEach(function (v) {
      v.dataset.observed = '1'; autoplayObserver.observe(v);
    });

    if (!memoryGuardObserver) {
      memoryGuardObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var v = entry.target;
          if (entry.isIntersecting) {
            if (v.dataset.unloaded) { v.src = v.getAttribute('data-base-src'); v.load(); delete v.dataset.unloaded; }
          } else if (!v.dataset.unloaded) {
            v.pause(); v.removeAttribute('src'); v.load(); v.dataset.unloaded = '1';
          }
        });
      }, { rootMargin: '1200px 0px', threshold: 0 });
    }
    qsa('video[data-base-src]:not([data-guarded])').forEach(function (v) { v.dataset.guarded = '1'; memoryGuardObserver.observe(v); });

    if (!revealObserver) {
      revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { if (entry.isIntersecting) { entry.target.classList.add('card-in-view'); revealObserver.unobserve(entry.target); } });
      }, { rootMargin: '80px 0px', threshold: 0.05 });
    }
    qsa('.asset-card:not(.card-in-view)').forEach(function (c) { revealObserver.observe(c); });
  }

  function updateStats() {
    qs('#stat-loaded').textContent = currentState().masterItems.length;
    qs('#stat-lap').textContent = currentState().lap;
  }

  function applySearch() {
    qsa('.asset-card', qs('#dash-feed')).forEach(function (card, i) {
      var item = Feed.rendered[i];
      if (!item) return;
      card.classList.toggle('feed-hidden', !matchesSearch(item));
    });
    var anyVisible = Feed.rendered.some(matchesSearch);
    qs('#feed-empty').hidden = anyVisible || Feed.rendered.length === 0;
  }

  /* ---------------- Section switching (sidebar) ---------------- */
  function switchSection(catId, label) {
    Feed.activeKey = catId || '';
    var state = currentState();
    if (!state.pool.length) state.pool = buildPool(catId || null);

    qs('#dash-feed').innerHTML = '';
    Feed.rendered = [];
    qs('#topbar-crumb').textContent = catId ? label.toUpperCase() + ' — ON LOOP' : 'EVERYTHING — INTERLEAVED, ON LOOP';

    qsa('.side-link').forEach(function (l) { l.classList.toggle('active', l.dataset.cat === (catId || '')); });

    if (state.masterItems.length) {
      renderItems(state.masterItems.filter(matchesSearch), false);
      updateStats();
    } else {
      loadNextBatch();
    }
    if (window.innerWidth <= 900) qs('#sidebar').classList.remove('open');
  }

  /* ================================================================
     LIGHTBOX
  ================================================================ */
  var lbIndex = -1;
  function openLightbox(index) {
    lbIndex = index;
    renderLightbox();
    document.getElementById('lightbox').classList.add('open');
  }
  function closeLightbox() {
    document.getElementById('lightbox').classList.remove('open');
    var v = document.getElementById('lb-video');
    if (v) v.pause();
  }
  function renderLightbox() {
    var item = Feed.rendered[lbIndex];
    if (!item) return;
    var stage = document.getElementById('lb-media');
    if (item.isVideo) {
      stage.innerHTML = '<video id="lb-video" src="' + item.streamSrc + '" data-fallback-src="' + item.fallbackSrc + '" poster="' + item.poster + '" controls autoplay loop muted playsinline></video>';
      bindVideoFallback(document.getElementById('lb-video'));
    } else {
      stage.innerHTML = '<img src="' + item.src + '" alt="' + escapeHtml(item.title) + '">';
    }
    document.getElementById('lb-title').textContent = item.title.toUpperCase();
    document.getElementById('lb-character').textContent = item.title;
    document.getElementById('lb-pillar').textContent = (item.catName || '') + (item.tagName ? ' / ' + item.tagName : '');
    document.getElementById('lb-set-count').textContent = (lbIndex + 1) + ' / ' + Feed.rendered.length;
    var pinBtn = document.getElementById('lb-pin-btn');
    pinBtn.classList.toggle('pinned', isPinned(item));
    pinBtn.textContent = isPinned(item) ? '\u2713 PINNED' : 'PIN';
  }
  function lbNav(dir) {
    if (!Feed.rendered.length) return;
    lbIndex = (lbIndex + dir + Feed.rendered.length) % Feed.rendered.length;
    renderLightbox();
  }

  /* ================================================================
     BOARD / B2B TERMINAL
  ================================================================ */
  function renderBoard() {
    var thumbs = document.getElementById('board-thumbs');
    var emptyEl = document.getElementById('modal-body-empty');
    thumbs.innerHTML = '';
    emptyEl.hidden = pinned.length > 0;
    pinned.forEach(function (p) {
      var thumb = el('div', 'board-thumb', '<img src="' + p.src + '" alt="' + escapeHtml(p.title) + '"><button title="Remove">\u2715</button>');
      qs('button', thumb).addEventListener('click', function () { togglePin(p); renderBoard(); });
      thumbs.appendChild(thumb);
    });
  }
  function openBoard() { renderBoard(); document.getElementById('board-modal-overlay').classList.add('open'); }
  function closeBoard() { document.getElementById('board-modal-overlay').classList.remove('open'); }

  /* ================================================================
     BOOT
  ================================================================ */
  function initTheme() {
    var theme = loadPref('rawx_theme', 'brutalist-red');
    document.documentElement.setAttribute('data-theme', theme);
    var sel = qs('#theme-select'); sel.value = theme;
    sel.addEventListener('change', function (e) {
      savePref('rawx_theme', e.target.value);
      document.documentElement.setAttribute('data-theme', e.target.value);
    });
  }

  function initSidebarLinks() {
    var wrap = qs('#side-cat-links');
    Drive.categories.forEach(function (cat, i) {
      var a = el('a', 'side-link', '<span class="side-link-idx">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="side-link-name">' + escapeHtml(cat.title) + '</span>' +
        '<span class="side-link-sub">' + (Drive.tags[cat.id] ? Drive.tags[cat.id].length : 0) + ' sections</span>');
      a.href = '#'; a.dataset.cat = cat.id;
      a.addEventListener('click', function (e) { e.preventDefault(); switchSection(cat.id, cat.title); });
      wrap.appendChild(a);
    });
    qs('#side-link-all').addEventListener('click', function (e) { e.preventDefault(); switchSection('', ''); });
  }

  function boot() {
    initTheme();
    renderRecents();
    renderPinStats();

    setBootStatus('READING CATEGORY FOLDERS…');
    getCategories().then(function (cats) {
      if (!cats.length) { setBootStatus('NO CATEGORY FOLDERS FOUND — CHECK driveRootFolderId'); return; }
      setBootStatus('READING SECTIONS…');
      return Promise.all(cats.map(function (c) { return getTags(c.id); })).then(function () {
        initSidebarLinks();
        switchSection('', '');
        document.getElementById('status-text').textContent = 'LIVE';
        document.getElementById('boot').classList.add('hidden');
      });
    }).catch(function (err) {
      setBootStatus('COULD NOT REACH GOOGLE DRIVE — CHECK API KEY / SHARING');
      console.error(err);
    });

    // Infinite scroll trigger
    var sentinelObs = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) loadNextBatch();
    }, { rootMargin: '600px 0px' });
    sentinelObs.observe(document.getElementById('feed-sentinel'));

    // Search
    var searchDebounce;
    qs('#side-search-input').addEventListener('input', function (e) {
      clearTimeout(searchDebounce);
      var val = e.target.value;
      searchDebounce = setTimeout(function () { Feed.searchTerm = val.trim().toLowerCase(); applySearch(); }, 150);
    });

    // Mobile sidebar toggle
    qs('#topbar-menu-btn').addEventListener('click', function () { qs('#sidebar').classList.toggle('open'); });

    // Cross-panel navigation dropdown
    qs('#panels-nav-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      this.classList.toggle('open');
      qs('#panels-menu').classList.toggle('open');
    });
    document.addEventListener('click', function () {
      qs('#panels-nav-btn').classList.remove('open');
      qs('#panels-menu').classList.remove('open');
    });

    // Lightbox controls
    qs('#lb-close').addEventListener('click', closeLightbox);
    qs('#lb-prev').addEventListener('click', function () { lbNav(-1); });
    qs('#lb-next').addEventListener('click', function () { lbNav(1); });
    qs('#lb-dock-prev').addEventListener('click', function () { lbNav(-1); });
    qs('#lb-dock-next').addEventListener('click', function () { lbNav(1); });
    qs('#lb-pin-btn').addEventListener('click', function () { togglePin(Feed.rendered[lbIndex]); renderLightbox(); });
    qs('#lightbox').addEventListener('click', function (e) { if (e.target.id === 'lightbox') closeLightbox(); });
    document.addEventListener('keydown', function (e) {
      if (!qs('#lightbox').classList.contains('open')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight' || e.key === 'n') lbNav(1);
      if (e.key === 'ArrowLeft' || e.key === 'p') lbNav(-1);
    });

    // Board / inquiry
    qs('#side-board-btn').addEventListener('click', openBoard);
    qs('#board-modal-close').addEventListener('click', closeBoard);
    qs('#board-modal-overlay').addEventListener('click', function (e) { if (e.target.id === 'board-modal-overlay') closeBoard(); });
    qs('#inquiry-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var company = qs('#inq-company').value, email = qs('#inq-email').value, notes = qs('#inq-notes').value;
      var refList = pinned.map(function (p) { return p.title + ' (' + (p.cat || '') + (p.tag ? '/' + p.tag : '') + ')'; }).join(', ') || 'None pinned';
      var subject = encodeURIComponent('B2B Inquiry \u2014 ' + company);
      var body = encodeURIComponent('Company: ' + company + '\nEmail: ' + email + '\nNotes: ' + notes + '\nReferenced assets: ' + refList);
      window.location.href = 'mailto:hello@handfilm.com?subject=' + subject + '&body=' + body;
      showToast('INQUIRY DRAFTED \u2014 CHECK YOUR MAIL CLIENT');
      closeBoard(); e.target.reset();
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
