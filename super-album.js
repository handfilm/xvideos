/* ============================================================
   RAWX SUPER ALBUM — CORE CONTROLLER & MOTION ENGINE
   Source of album: All videos rooted from index.html Google Drive
   (Root: 1zno_n1n23dbIb4HE8giapSAqGS9WZd33) + Cloudflare R2 Stream CDN.
   Features:
     - 100% active motion across all views (Cinema, Mega Wall, Multi-Cam, Lookbooks)
     - Dynamic Drive folder & tag tree crawler
     - Editorial massive typographic stems & live timecode
     - Continuous looping video wall with IntersectionObserver performance
     - 4-way synchronized multi-camera split comparison
     - 432Hz ambient drone synth & live audio-visualizer
     - Responsive keyboard, touch, and instant seek navigation
============================================================ */

(function () {
  'use strict';

  /* ---------------- Drive & R2 Root Configuration (Matching index.html) ---------------- */
  var CONFIG = {
    driveRootFolderId: '1zno_n1n23dbIb4HE8giapSAqGS9WZd33',
    driveApiKey: 'AIzaSyCqU3qT5SaRYTZev6ZfChJvApRDGDzv88Y',
    pageSize: 100,
    r2Enabled: true,
    r2BaseUrl: 'https://xvideos.handsandhead.com'
  };

  var FOLDER_MIME = 'application/vnd.google-apps.folder';
  var DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

  // Curated fallback seed clips in case network/offline
  var SEED_CATALOG = [
    {
      id: 'rx-sig-01',
      title: 'AURA 360° HYPER-FLOW',
      category: 'SIGNATURE ACTIVE',
      motion: '360° ORBITAL TENSION',
      fabric: 'ULTRA-COMPRESSION MATTE',
      aspect: '9:16 VERTICAL CINEMA',
      tagline: 'SEAMLESS FABRIC DRAPE RESPONDING TO KINETIC ROTATION IN 60FPS.',
      src: 'https://xvideos.handsandhead.com/signature_01.mp4',
      fallbackSrc: 'https://pub-2b362095f9c4456ea74aa4c57cb8c512.r2.dev/signature_01.mp4',
      poster: 'https://pub-2b362095f9c4456ea74aa4c57cb8c512.r2.dev/posters/sig1.jpg'
    },
    {
      id: 'rx-sig-02',
      title: 'SHADOW SILHOUETTE CADENCE',
      category: 'HIGH-TENSION ACTIVE',
      motion: 'LATERAL AXIS ARTICULATION',
      fabric: 'DOUBLE-KNIT HYDRO-FIBER',
      aspect: '9:16 VERTICAL CINEMA',
      tagline: 'PRECISE VOLUMETRIC LIGHTING HIGHLIGHTING MUSCULOSKELETAL POSTURE.',
      src: 'https://xvideos.handsandhead.com/signature_02.mp4',
      fallbackSrc: 'https://pub-2b362095f9c4456ea74aa4c57cb8c512.r2.dev/signature_02.mp4',
      poster: 'https://pub-2b362095f9c4456ea74aa4c57cb8c512.r2.dev/posters/sig2.jpg'
    },
    {
      id: 'rx-lin-01',
      title: 'OBSIDIAN LACE KINETICS',
      category: 'COUTURE LINGERIE',
      motion: 'MICRO-VIBRATION DYNAMICS',
      fabric: 'SHEER GEOMETRIC TULLE',
      aspect: '9:16 VERTICAL CINEMA',
      tagline: 'INTRICATE STRUCTURAL RIBBING WITH DELICATE LIGHT SCATTERING.',
      src: 'https://xvideos.handsandhead.com/lingerie_01.mp4',
      fallbackSrc: 'https://pub-2b362095f9c4456ea74aa4c57cb8c512.r2.dev/lingerie_01.mp4',
      poster: 'https://pub-2b362095f9c4456ea74aa4c57cb8c512.r2.dev/posters/lin1.jpg'
    },
    {
      id: 'rx-lin-02',
      title: 'SCULPTURAL VELVET CADENCE',
      category: 'MINIMAL ARCHIVE',
      motion: 'CONTRA-POSTURE ELEVATION',
      fabric: 'HIGH-GLOSS STRETCH SILK',
      aspect: '9:16 VERTICAL CINEMA',
      tagline: 'MONOCHROMATIC ANATOMICAL MOTION STUDY WITH CONTROLLED SPECULARITY.',
      src: 'https://xvideos.handsandhead.com/lingerie_02.mp4',
      fallbackSrc: 'https://pub-2b362095f9c4456ea74aa4c57cb8c512.r2.dev/lingerie_02.mp4',
      poster: 'https://pub-2b362095f9c4456ea74aa4c57cb8c512.r2.dev/posters/lin2.jpg'
    },
    {
      id: 'rx-act-01',
      title: 'CYCLIC VELOCITY STRIDE',
      category: 'SPORTSWEAR PRO',
      motion: 'RAPID PENDULUM SWING',
      fabric: 'VENTILATED HONEYCOMB MESH',
      aspect: '9:16 VERTICAL CINEMA',
      tagline: 'HIGH-IMPACT SEAMLESS MOVEMENT WITH DYNAMIC ANISOTROPIC SHEEN.',
      src: 'https://xvideos.handsandhead.com/active_01.mp4',
      fallbackSrc: 'https://pub-2b362095f9c4456ea74aa4c57cb8c512.r2.dev/active_01.mp4',
      poster: 'https://pub-2b362095f9c4456ea74aa4c57cb8c512.r2.dev/posters/act1.jpg'
    },
    {
      id: 'rx-act-02',
      title: 'ISOMETRIC TENSION MATRIX',
      category: 'AEROBIC KINETICS',
      motion: 'STATIONARY TENSION HOLD',
      fabric: 'RECYCLED POLYAMIDE ELASTANE',
      aspect: '9:16 VERTICAL CINEMA',
      tagline: 'CALCULATED FIBER STRESS ANALYSIS ACROSS CRITICAL ANATOMICAL SEAMS.',
      src: 'https://xvideos.handsandhead.com/active_02.mp4',
      fallbackSrc: 'https://pub-2b362095f9c4456ea74aa4c57cb8c512.r2.dev/active_02.mp4',
      poster: 'https://pub-2b362095f9c4456ea74aa4c57cb8c512.r2.dev/posters/act2.jpg'
    }
  ];

  /* ---------------- State Object ---------------- */
  var State = {
    catalog: SEED_CATALOG.slice(),
    categories: [],
    tagsMap: {},
    currentIndex: 0,
    isPlaying: true,
    slideIntervalMs: 6500,
    slideTimer: null,
    progressTimer: null,
    progressStart: 0,
    mode: 'cinema',
    textLayoverVisible: true,
    soundActive: false,
    audioCtx: null,
    droneNode: null,
    wallDensity: 4,
    searchFilter: '',
    catFilter: '',
    sortFilter: 'curated',
    isLoadingDrive: false,
    loadedVideoCount: 0
  };

  /* ---------------- Helper Utilities ---------------- */
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function titleFromName(name) {
    return name.replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function showToast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ---------------- Intelligent Editorial Motion Descriptors ---------------- */
  var MOTION_TYPES = [
    '360° ORBITAL TENSION',
    'KINETIC STRIDE CADENCE',
    'MICRO-VIBRATION ARTICULATION',
    'LATERAL POSTURE ELEVATION',
    'VOLUMETRIC AXIS ROTATION',
    'HIGH-VELOCITY ROTATION',
    'ISOMETRIC EQUILIBRIUM',
    'DYNAMIC ANATOMICAL FLEXION'
  ];

  var FABRIC_PROFILES = [
    'ULTRA-COMPRESSION MATTE',
    'DOUBLE-KNIT HYDRO-FIBER',
    'SHEER GEOMETRIC TULLE',
    'HIGH-GLOSS STRETCH SILK',
    'VENTILATED HONEYCOMB MESH',
    'RECYCLED POLYAMIDE ELASTANE',
    'MICRO-TEXTURED CREPE RIB',
    'ANISOTROPIC REFLECTIVE WEAVE'
  ];

  var TAGLINES = [
    'SEAMLESS FABRIC DRAPE RESPONDING TO ANATOMICAL KINETIC ROTATION IN 60FPS.',
    'PRECISE VOLUMETRIC LIGHTING HIGHLIGHTING MUSCULOSKELETAL TENSION AND DRAPE.',
    'INTRICATE STRUCTURAL RIBBING WITH DELICATE LIGHT SCATTERING AND ELASTIC RECOVERY.',
    'MONOCHROMATIC MOTION STUDY WITH CONTROLLED SPECULARITY AND HIGH RESOLUTION CLARITY.',
    'HIGH-IMPACT SEAMLESS MOVEMENT ENGINEERED FOR CONTINUOUS ROTATIONAL CINEMA.',
    'CALCULATED FIBER STRESS ANALYSIS ACROSS CRITICAL SEAMS UNDER CONTINUOUS MOTION.'
  ];

  function getDynamicMotionSpec(title, idx) {
    var m = MOTION_TYPES[Math.abs((title.length + idx) % MOTION_TYPES.length)];
    var f = FABRIC_PROFILES[Math.abs((title.length * 3 + idx) % FABRIC_PROFILES.length)];
    var t = TAGLINES[Math.abs((title.length * 7 + idx) % TAGLINES.length)];
    return { motion: m, fabric: f, tagline: t };
  }

  /* ---------------- Google Drive & R2 Root Crawler ---------------- */
  function driveList(parentId, foldersOnly, pageToken) {
    var mimeClause = foldersOnly
      ? " and mimeType='" + FOLDER_MIME + "'"
      : " and mimeType!='" + FOLDER_MIME + "'";
    var q = encodeURIComponent("'" + parentId + "' in parents and trashed=false" + mimeClause);
    var fields = foldersOnly
      ? 'nextPageToken,files(id,name)'
      : 'nextPageToken,files(id,name,mimeType,thumbnailLink)';
    var url = DRIVE_FILES_URL + '?q=' + q +
      '&key=' + CONFIG.driveApiKey +
      '&fields=' + encodeURIComponent(fields) +
      '&pageSize=' + (foldersOnly ? 1000 : CONFIG.pageSize) +
      '&orderBy=name' +
      (pageToken ? '&pageToken=' + pageToken : '');
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('Drive API status ' + r.status);
      return r.json();
    });
  }

  function buildR2StreamSrc(file, categoryName, tagName) {
    if (!CONFIG.r2Enabled || !CONFIG.r2BaseUrl || !categoryName) return null;
    var base = CONFIG.r2BaseUrl.replace(/\/+$/, '');
    var parts = [encodeURIComponent(categoryName)];
    if (tagName) parts.push(encodeURIComponent(tagName));
    parts.push(encodeURIComponent(file.name));
    return base + '/' + parts.join('/');
  }

  function bindVideoFallback(video) {
    if (!video) return;
    video.addEventListener('error', function () {
      var fallback = video.getAttribute('data-fallback-src');
      if (fallback && !video.dataset.fallbackTried && video.src !== fallback) {
        video.dataset.fallbackTried = '1';
        video.src = fallback;
        video.load();
        video.play().catch(function () {});
      }
    });
  }

  // Deep Scan Root Folder: Category Folders -> Tag Folders -> Video Files
  function scanAllRootVideos() {
    State.isLoadingDrive = true;
    showToast('DISCOVERING DRIVE ROOT MOTION ASSETS…');

    driveList(CONFIG.driveRootFolderId, true)
      .then(function (catData) {
        var categories = catData.files || [];
        State.categories = categories.map(function (c) {
          return { id: c.id, name: c.name, title: titleFromName(c.name) };
        });
        updateCategorySelect();

        var catPromises = categories.map(function (cat) {
          // Check Tag subfolders in Category
          return driveList(cat.id, true).then(function (tagData) {
            var tags = tagData.files || [];
            if (tags.length > 0) {
              var tagPromises = tags.map(function (tag) {
                return driveList(tag.id, false).then(function (fileData) {
                  processDriveFiles(fileData.files || [], cat.name, tag.name);
                }).catch(function () {});
              });
              return Promise.all(tagPromises);
            } else {
              // Flat category - files directly inside category folder
              return driveList(cat.id, false).then(function (fileData) {
                processDriveFiles(fileData.files || [], cat.name, null);
              }).catch(function () {});
            }
          }).catch(function () {});
        });

        return Promise.all(catPromises);
      })
      .then(function () {
        State.isLoadingDrive = false;
        showToast('LOADED ' + State.catalog.length + ' ACTIVE MOTION ASSETS FROM ROOT');
        updateFilmstripCount();
        if (State.mode === 'wall') renderMegaWall();
        if (State.mode === 'curated') renderLookbooks();
      })
      .catch(function (err) {
        console.warn('Drive crawl notice:', err);
        State.isLoadingDrive = false;
      });
  }

  function processDriveFiles(files, categoryName, tagName) {
    if (!files || files.length === 0) return;
    var added = 0;

    files.forEach(function (file) {
      var isVideo = (file.mimeType && file.mimeType.indexOf('video/') === 0) ||
                    /\.(mp4|webm|mov|m4v)$/i.test(file.name);
      if (!isVideo) return;

      var r2Url = buildR2StreamSrc(file, categoryName, tagName);
      var driveStreamUrl = DRIVE_FILES_URL + '/' + file.id + '?alt=media&key=' + CONFIG.driveApiKey;
      var streamSrc = r2Url || driveStreamUrl;

      // Avoid duplicates
      if (State.catalog.some(function (c) { return c.id === file.id || c.src === streamSrc; })) {
        return;
      }

      var title = titleFromName(file.name);
      var specs = getDynamicMotionSpec(title, State.catalog.length);
      var poster = file.thumbnailLink
        ? file.thumbnailLink.replace(/=s\d+$/, '=s1200')
        : 'https://drive.google.com/thumbnail?id=' + file.id + '&sz=w1200';

      State.catalog.push({
        id: file.id,
        title: title,
        category: (categoryName || 'RAWX ACTIVE').toUpperCase(),
        tag: tagName ? tagName.toUpperCase() : null,
        motion: specs.motion,
        fabric: specs.fabric,
        aspect: '9:16 VERTICAL CINEMA',
        tagline: specs.tagline,
        src: streamSrc,
        fallbackSrc: driveStreamUrl,
        poster: poster
      });
      added++;
    });

    if (added > 0) {
      renderFilmstrip();
      updateFilmstripCount();
      if (State.mode === 'wall') renderMegaWall();
      if (State.mode === 'curated') renderLookbooks();
    }
  }

  function updateCategorySelect() {
    var sel = document.getElementById('wall-cat-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">ALL COLLECTIONS (' + State.catalog.length + ')</option>';
    var catSet = {};
    State.catalog.forEach(function (item) {
      if (item.category) catSet[item.category] = (catSet[item.category] || 0) + 1;
    });
    Object.keys(catSet).forEach(function (cat) {
      var opt = el('option', '', cat + ' (' + catSet[cat] + ')');
      opt.value = cat;
      sel.appendChild(opt);
    });
  }

  function updateFilmstripCount() {
    var count = document.getElementById('filmstrip-count');
    if (count) count.textContent = State.catalog.length;
    var totalSlides = document.getElementById('layover-total-slides');
    if (totalSlides) totalSlides.textContent = (State.catalog.length < 10 ? '0' : '') + State.catalog.length;
  }

  /* ---------------- Pinned Storage Integration ---------------- */
  function enrichFromPinnedStorage() {
    try {
      var pinned = JSON.parse(localStorage.getItem('rawx_pinned') || '[]');
      if (pinned && pinned.length > 0) {
        pinned.forEach(function (p) {
          if (!State.catalog.some(function (c) { return c.src === p.src || c.id === p.id; })) {
            State.catalog.unshift({
              id: p.id || ('rx-' + Math.random().toString(36).substr(2, 6)),
              title: p.title || 'PINNED ACTIVE MOTION',
              category: 'PINNED CURATION',
              motion: 'ORBITAL TENSION DYNAMICS',
              fabric: 'CUSTOM ANATOMICAL SPEC',
              aspect: '9:16 VERTICAL CINEMA',
              tagline: 'SELECTION PINNED FROM ACTIVE WORKSTATION SESSION IN FULL ROTATION.',
              src: p.src,
              fallbackSrc: p.src,
              poster: p.src
            });
          }
        });
      }
    } catch (e) {}
  }

  /* ================================================================
     VIEW 1: CINEMA SLIDESHOW & MASSIVE EDITORIAL LAYOVERS
  ================================================================ */
  function renderCinemaSlide(index) {
    var layersWrap = document.getElementById('cinema-stage-layers');
    if (!layersWrap || State.catalog.length === 0) return;

    var item = State.catalog[index];
    if (!item) return;

    var existingActive = qs('.cinema-slide-layer.active', layersWrap);
    if (existingActive) {
      existingActive.classList.remove('active');
      existingActive.classList.add('leaving');
      setTimeout(function () {
        if (existingActive && existingActive.parentNode) {
          existingActive.parentNode.removeChild(existingActive);
        }
      }, 1000);
    }

    var newLayer = el('div', 'cinema-slide-layer');
    var video = el('video');
    video.src = item.src;
    video.setAttribute('data-fallback-src', item.fallbackSrc || item.src);
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');

    bindVideoFallback(video);

    video.addEventListener('error', function () {
      if (item.poster) {
        newLayer.innerHTML = '<img src="' + item.poster + '" alt="' + escapeHtml(item.title) + '">';
      }
    });

    newLayer.appendChild(video);
    layersWrap.appendChild(newLayer);

    requestAnimationFrame(function () {
      newLayer.classList.add('active');
      video.play().catch(function () {});
    });

    updateTextLayover(item, index);
    updateFilmstripActive(index);
    resetSlideProgress();
  }

  function updateTextLayover(item, index) {
    var elCat = document.getElementById('layover-cat');
    var elTitle = document.getElementById('layover-title');
    var elTagline = document.getElementById('layover-tagline');
    var elSpecId = document.getElementById('spec-id');
    var elSpecMotion = document.getElementById('spec-motion');
    var elSpecFabric = document.getElementById('spec-fabric');
    var elSpecAspect = document.getElementById('spec-aspect');
    var elCurrSlide = document.getElementById('layover-curr-slide');
    var elTotalSlides = document.getElementById('layover-total-slides');
    var elTimecode = document.getElementById('layover-timecode');

    if (elCat) elCat.textContent = (item.category || 'RAWX ARCHIVE').toUpperCase();
    if (elTitle) elTitle.textContent = (item.title || 'UNNAMED MOTION').toUpperCase();
    if (elTagline) elTagline.textContent = item.tagline || 'SEAMLESS ARTICULATION ACROSS MULTIPLE VOLUMETRIC LIGHTING ENGINES.';
    if (elSpecId) elSpecId.textContent = (item.id || 'RAWX-REF').toUpperCase();
    if (elSpecMotion) elSpecMotion.textContent = (item.motion || 'ORBITAL KINETIC').toUpperCase();
    if (elSpecFabric) elSpecFabric.textContent = (item.fabric || 'HIGH-TENSION ELASTIC').toUpperCase();
    if (elSpecAspect) elSpecAspect.textContent = (item.aspect || '9:16 4K STREAM').toUpperCase();

    if (elCurrSlide) elCurrSlide.textContent = (index + 1 < 10 ? '0' : '') + (index + 1);
    if (elTotalSlides) elTotalSlides.textContent = (State.catalog.length < 10 ? '0' : '') + State.catalog.length;

    if (elTimecode) {
      var s = Math.floor(Date.now() / 1000) % 60;
      var f = Math.floor((Date.now() % 1000) / 16);
      elTimecode.textContent = 'REC 00:0' + ((index % 9) + 1) + ':' + (s < 10 ? '0' : '') + s + ':' + (f < 10 ? '0' : '') + f + ' // 60FPS 4K';
    }
  }

  function resetSlideProgress() {
    clearInterval(State.progressTimer);
    var fill = document.getElementById('layover-progress-fill');
    if (!fill) return;

    if (!State.isPlaying) {
      fill.style.width = '0%';
      return;
    }

    State.progressStart = Date.now();
    State.progressTimer = setInterval(function () {
      var elapsed = Date.now() - State.progressStart;
      var pct = Math.min(100, (elapsed / State.slideIntervalMs) * 100);
      fill.style.width = pct + '%';
    }, 50);
  }

  function nextSlide() {
    if (State.catalog.length === 0) return;
    State.currentIndex = (State.currentIndex + 1) % State.catalog.length;
    renderCinemaSlide(State.currentIndex);
  }

  function prevSlide() {
    if (State.catalog.length === 0) return;
    State.currentIndex = (State.currentIndex - 1 + State.catalog.length) % State.catalog.length;
    renderCinemaSlide(State.currentIndex);
  }

  function toggleSlideshow(forceState) {
    if (forceState !== undefined) State.isPlaying = forceState;
    else State.isPlaying = !State.isPlaying;

    clearInterval(State.slideTimer);
    var btn = document.getElementById('btn-slideshow-toggle');
    var pauseBtn = document.getElementById('btn-pause-slide');
    var icon = document.getElementById('slideshow-icon');
    var text = document.getElementById('slideshow-text');

    if (State.isPlaying) {
      State.slideTimer = setInterval(nextSlide, State.slideIntervalMs);
      if (btn) btn.classList.add('active');
      if (icon) icon.textContent = '❚❚';
      if (text) text.textContent = 'AUTO ' + (State.slideIntervalMs / 1000) + 's';
      if (pauseBtn) pauseBtn.textContent = 'PAUSE';
      resetSlideProgress();
      showToast('SLIDESHOW: IN CONTINUOUS MOTION');
    } else {
      clearInterval(State.progressTimer);
      if (btn) btn.classList.remove('active');
      if (icon) icon.textContent = '▶';
      if (text) text.textContent = 'PAUSED';
      if (pauseBtn) pauseBtn.textContent = 'PLAY';
      var fill = document.getElementById('layover-progress-fill');
      if (fill) fill.style.width = '0%';
      showToast('SLIDESHOW: PAUSED');
    }
  }

  /* ---------------- Filmstrip Drawer ---------------- */
  function renderFilmstrip() {
    var track = document.getElementById('filmstrip-track');
    if (!track) return;
    track.innerHTML = '';

    State.catalog.forEach(function (item, i) {
      var thumb = el('div', 'filmstrip-thumb' + (i === State.currentIndex ? ' active' : ''));
      thumb.innerHTML =
        '<img src="' + (item.poster || item.src) + '" alt="' + escapeHtml(item.title) + '">' +
        '<span class="filmstrip-idx">' + (i + 1) + '</span>';
      thumb.addEventListener('click', function () {
        State.currentIndex = i;
        renderCinemaSlide(i);
        if (State.isPlaying) {
          clearInterval(State.slideTimer);
          State.slideTimer = setInterval(nextSlide, State.slideIntervalMs);
        }
      });
      track.appendChild(thumb);
    });
  }

  function updateFilmstripActive(index) {
    qsa('.filmstrip-thumb').forEach(function (t, i) {
      t.classList.toggle('active', i === index);
      if (i === index) {
        t.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    });
  }

  /* ================================================================
     VIEW 2: 3D MEGA WALL (Continuous Active Motion Grid)
  ================================================================ */
  var wallObserver = null;

  function renderMegaWall() {
    var grid = document.getElementById('wall-grid');
    if (!grid) return;
    grid.innerHTML = '';

    var filtered = State.catalog.filter(function (item) {
      if (State.catFilter && item.category !== State.catFilter) return false;
      if (State.searchFilter) {
        var q = State.searchFilter.toLowerCase();
        return item.title.toLowerCase().indexOf(q) !== -1 ||
               (item.fabric && item.fabric.toLowerCase().indexOf(q) !== -1) ||
               (item.motion && item.motion.toLowerCase().indexOf(q) !== -1);
      }
      return true;
    });

    if (State.sortFilter === 'latest') {
      filtered = filtered.slice().reverse();
    } else if (State.sortFilter === 'shuffle') {
      filtered = filtered.slice().sort(function () { return 0.5 - Math.random(); });
    }

    if (filtered.length === 0) {
      grid.innerHTML = '<div class="wall-empty-notice" style="grid-column: 1/-1; padding: 40px; text-align: center; color: #777; font-family: monospace;">NO MOTION ASSETS FOUND MATCHING CURRENT FILTER.</div>';
      return;
    }

    // Lazy play observer to keep CPU/GPU lightweight while preserving full motion
    if ('IntersectionObserver' in window) {
      if (wallObserver) wallObserver.disconnect();
      wallObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var vid = qs('video', entry.target);
          if (!vid) return;
          if (entry.isIntersecting) {
            vid.play().catch(function () {});
          } else {
            vid.pause();
          }
        });
      }, { threshold: 0.15 });
    }

    filtered.forEach(function (item, i) {
      var card = el('div', 'wall-card');
      card.innerHTML =
        '<video src="' + item.src + '" data-fallback-src="' + (item.fallbackSrc || item.src) + '" muted loop playsinline autoplay preload="auto"></video>' +
        '<div class="wall-card-overlay">' +
          '<span class="wall-card-badge">' + escapeHtml(item.category || 'RAWX') + '</span>' +
          '<div class="wall-card-info">' +
            '<h4>' + escapeHtml(item.title) + '</h4>' +
            '<p>' + escapeHtml(item.motion) + ' • ' + escapeHtml(item.fabric) + '</p>' +
          '</div>' +
        '</div>';

      var vid = qs('video', card);
      bindVideoFallback(vid);

      if (wallObserver) wallObserver.observe(card);

      card.addEventListener('click', function () {
        var masterIdx = State.catalog.indexOf(item);
        if (masterIdx !== -1) State.currentIndex = masterIdx;
        setViewMode('cinema');
        renderCinemaSlide(State.currentIndex);
      });

      grid.appendChild(card);
    });
  }

  /* ================================================================
     VIEW 3: MULTI-CAM 4-WAY SYNCHRONIZED SPLIT DECK
  ================================================================ */
  function initSplitQuad() {
    var slots = [0, 1, 2, 3];
    slots.forEach(function (slotIdx) {
      var cell = document.getElementById('quad-' + (slotIdx + 1));
      if (!cell) return;
      var wrap = qs('.quad-video-wrap', cell);
      var item = State.catalog[slotIdx % State.catalog.length];
      if (wrap && item) {
        wrap.innerHTML = '<video src="' + item.src + '" data-fallback-src="' + (item.fallbackSrc || item.src) + '" autoplay loop muted playsinline></video>';
        var v = qs('video', wrap);
        bindVideoFallback(v);
      }
    });
  }

  function syncSplitVideos() {
    var vids = qsa('.split-quad-cell video');
    vids.forEach(function (v) {
      v.currentTime = 0;
      v.play().catch(function () {});
    });
    showToast('SYNCHRONIZED ALL 4 CAMERAS IN MOTION');
  }

  /* ================================================================
     VIEW 4: CURATED LOOKBOOK REELS (Continuous Reel Motion)
  ================================================================ */
  function renderLookbooks() {
    var container = document.getElementById('lookbook-collections');
    if (!container) return;
    container.innerHTML = '';

    var categories = {};
    State.catalog.forEach(function (item) {
      var cat = item.category || 'GENERAL MOTION';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(item);
    });

    Object.keys(categories).forEach(function (catName) {
      var items = categories[catName];
      var block = el('div', 'lookbook-collection-card');
      block.innerHTML =
        '<div class="collection-header">' +
          '<div><h3>' + escapeHtml(catName.toUpperCase()) + '</h3><span>' + items.length + ' SEQUENCES IN ACTIVE MOTION</span></div>' +
          '<button class="album-action-btn play-cat-btn" data-cat="' + escapeHtml(catName) + '">▶ PLAY COLLECTION IN CINEMA</button>' +
        '</div>' +
        '<div class="collection-reel-track"></div>';

      var track = qs('.collection-reel-track', block);
      items.forEach(function (it) {
        var reelItem = el('div', 'collection-reel-item');
        reelItem.innerHTML = '<video src="' + it.src + '" data-fallback-src="' + (it.fallbackSrc || it.src) + '" muted loop playsinline autoplay></video>';
        var v = qs('video', reelItem);
        bindVideoFallback(v);

        reelItem.addEventListener('click', function () {
          var idx = State.catalog.indexOf(it);
          if (idx !== -1) State.currentIndex = idx;
          setViewMode('cinema');
          renderCinemaSlide(State.currentIndex);
        });
        track.appendChild(reelItem);
      });

      qs('.play-cat-btn', block).addEventListener('click', function () {
        var first = items[0];
        var idx = State.catalog.indexOf(first);
        if (idx !== -1) State.currentIndex = idx;
        setViewMode('cinema');
        renderCinemaSlide(State.currentIndex);
        toggleSlideshow(true);
      });

      container.appendChild(block);
    });
  }

  /* ================================================================
     VIEW SWITCHING
  ================================================================ */
  function setViewMode(modeName) {
    State.mode = modeName;
    qsa('.album-mode-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === modeName);
    });
    qsa('.album-view').forEach(function (view) {
      view.classList.toggle('active', view.id === 'view-' + modeName);
    });

    if (modeName === 'wall') renderMegaWall();
    else if (modeName === 'split') initSplitQuad();
    else if (modeName === 'curated') renderLookbooks();
    else if (modeName === 'cinema') {
      renderCinemaSlide(State.currentIndex);
    }

    showToast('VIEW MODE: ' + modeName.toUpperCase());
  }

  /* ================================================================
     AMBIENT SYNTHESIZER & AUDIO-VISUALIZER (432Hz Dronescape)
  ================================================================ */
  function toggleAudioSynth() {
    if (!State.audioCtx) {
      try {
        var AudioContext = window.AudioContext || window.webkitAudioContext;
        State.audioCtx = new AudioContext();
        var osc1 = State.audioCtx.createOscillator();
        var osc2 = State.audioCtx.createOscillator();
        var gain = State.audioCtx.createGain();
        var filter = State.audioCtx.createBiquadFilter();

        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(54, State.audioCtx.currentTime); // 54Hz harmonic sub
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(108, State.audioCtx.currentTime); // 108Hz harmonic octave

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(380, State.audioCtx.currentTime);

        gain.gain.setValueAtTime(0.08, State.audioCtx.currentTime);

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(gain);
        gain.connect(State.audioCtx.destination);

        osc1.start();
        osc2.start();
        State.droneNode = { osc1: osc1, osc2: osc2, gain: gain, filter: filter };
      } catch (e) {
        showToast('WEB AUDIO NOT SUPPORTED IN BROWSER');
        return;
      }
    }

    State.soundActive = !State.soundActive;
    var btn = document.getElementById('btn-sound-toggle');
    var viz = document.getElementById('album-visualizer-bar');

    if (State.soundActive) {
      if (State.audioCtx.state === 'suspended') State.audioCtx.resume();
      if (btn) btn.classList.add('active');
      if (viz) viz.classList.add('active');
      showToast('432HZ HARMONIC DRONE: ACTIVE');
    } else {
      if (State.audioCtx) State.audioCtx.suspend();
      if (btn) btn.classList.remove('active');
      if (viz) viz.classList.remove('active');
      showToast('AMBIENT SOUND: MUTED');
    }
  }

  /* ================================================================
     EVENT BINDINGS & CONTROLS
  ================================================================ */
  function initEvents() {
    enrichFromPinnedStorage();

    // Mode Buttons
    qsa('.album-mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setViewMode(btn.dataset.mode);
      });
    });

    // Slideshow toggle
    var slideToggle = document.getElementById('btn-slideshow-toggle');
    if (slideToggle) slideToggle.addEventListener('click', function () { toggleSlideshow(); });

    var pauseBtn = document.getElementById('btn-pause-slide');
    if (pauseBtn) pauseBtn.addEventListener('click', function () { toggleSlideshow(); });

    var prevBtn = document.getElementById('btn-prev-slide');
    if (prevBtn) prevBtn.addEventListener('click', function () { prevSlide(); });

    var nextBtn = document.getElementById('btn-next-slide');
    if (nextBtn) nextBtn.addEventListener('click', function () { nextSlide(); });

    // Text Layover toggle
    var textToggle = document.getElementById('btn-text-toggle');
    var layover = document.getElementById('cinema-layover');
    if (textToggle && layover) {
      textToggle.addEventListener('click', function () {
        State.textLayoverVisible = !State.textLayoverVisible;
        layover.classList.toggle('hidden-layover', !State.textLayoverVisible);
        textToggle.innerHTML = '<span class="action-icon">☷</span> LAYOVER <b class="' + (State.textLayoverVisible ? 'indicator-on' : '') + '">' + (State.textLayoverVisible ? 'ON' : 'OFF') + '</b>';
        showToast('EDITORIAL TEXT LAYOVER: ' + (State.textLayoverVisible ? 'VISIBLE' : 'HIDDEN'));
      });
    }

    // Sound toggle
    var soundToggle = document.getElementById('btn-sound-toggle');
    if (soundToggle) soundToggle.addEventListener('click', toggleAudioSynth);

    // Fullscreen toggle
    var fsBtn = document.getElementById('btn-fullscreen');
    if (fsBtn) {
      fsBtn.addEventListener('click', function () {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(function () {});
          fsBtn.classList.add('active');
        } else {
          document.exitFullscreen().catch(function () {});
          fsBtn.classList.remove('active');
        }
      });
    }

    // Filmstrip drawer minimize/maximize
    var stripBtn = document.getElementById('filmstrip-toggle-btn');
    var stripDrawer = document.getElementById('cinema-filmstrip-drawer');
    if (stripBtn && stripDrawer) {
      stripBtn.addEventListener('click', function () {
        var isMin = stripDrawer.classList.toggle('minimized');
        stripBtn.textContent = isMin ? 'SHOW REEL ▴' : 'HIDE REEL ▾';
      });
    }

    // Split quad sync & cycle
    var splitSync = document.getElementById('btn-split-sync');
    if (splitSync) splitSync.addEventListener('click', syncSplitVideos);

    var splitCycle = document.getElementById('btn-split-cycle');
    if (splitCycle) {
      splitCycle.addEventListener('click', function () {
        State.catalog.reverse();
        initSplitQuad();
        showToast('CYCLED 4-WAY CAMERA PRESETS');
      });
    }

    // Wall density buttons
    qsa('.wall-dense-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        qsa('.wall-dense-btn').forEach(function (btn) { btn.classList.remove('active'); });
        b.classList.add('active');
        var cols = b.dataset.cols;
        var grid = document.getElementById('wall-grid');
        if (grid) grid.className = 'wall-grid cols-' + cols;
      });
    });

    // Wall filters & search
    var searchInput = document.getElementById('wall-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function (e) {
        State.searchFilter = e.target.value.trim();
        renderMegaWall();
      });
    }

    var catSelect = document.getElementById('wall-cat-select');
    if (catSelect) {
      catSelect.addEventListener('change', function (e) {
        State.catFilter = e.target.value;
        renderMegaWall();
      });
    }

    var sortSelect = document.getElementById('wall-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', function (e) {
        State.sortFilter = e.target.value;
        renderMegaWall();
      });
    }

    // Panels dropdown menu
    var panelsBtn = document.getElementById('panels-nav-btn');
    var panelsMenu = document.getElementById('panels-menu');
    if (panelsBtn && panelsMenu) {
      panelsBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        panelsMenu.classList.toggle('open');
      });
      document.addEventListener('click', function () {
        panelsMenu.classList.remove('open');
      });
    }

    // Theme selector
    var themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
      themeSelect.addEventListener('change', function (e) {
        document.documentElement.setAttribute('data-theme', e.target.value);
        showToast('THEME: ' + e.target.value.toUpperCase());
      });
    }

    // Keyboard Shortcuts
    document.addEventListener('keydown', function (e) {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggleSlideshow();
      } else if (e.code === 'ArrowRight') {
        nextSlide();
      } else if (e.code === 'ArrowLeft') {
        prevSlide();
      } else if (e.key === 't' || e.key === 'T') {
        if (textToggle) textToggle.click();
      } else if (e.key === 'f' || e.key === 'F') {
        if (fsBtn) fsBtn.click();
      } else if (e.key === 's' || e.key === 'S') {
        toggleAudioSynth();
      } else if (e.key === 'm' || e.key === 'M') {
        var modes = ['cinema', 'wall', 'split', 'curated'];
        var nextMode = modes[(modes.indexOf(State.mode) + 1) % modes.length];
        setViewMode(nextMode);
      }
    });

    // Touch Swipe Navigation for Cinema Slide
    var touchStartX = 0;
    var cinemaStage = document.getElementById('cinema-stage');
    if (cinemaStage) {
      cinemaStage.addEventListener('touchstart', function (e) {
        touchStartX = e.touches[0].clientX;
      }, { passive: true });

      cinemaStage.addEventListener('touchend', function (e) {
        var deltaX = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(deltaX) > 60) {
          if (deltaX < 0) nextSlide();
          else prevSlide();
        }
      }, { passive: true });
    }

    // Render Initial State
    renderCinemaSlide(0);
    renderFilmstrip();
    State.slideTimer = setInterval(nextSlide, State.slideIntervalMs);

    // Launch background Drive root scan to load all videos
    scanAllRootVideos();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEvents);
  } else {
    initEvents();
  }

})();
