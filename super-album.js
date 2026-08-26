/* ============================================================
   RAWX SUPER ALBUM — PROFESSIONAL BROADCAST VIDEO ENGINE
   Source: Google Drive (Root: 1zno_n1n23dbIb4HE8giapSAqGS9WZd33)
   + Cloudflare R2 Stream CDN (https://xvideos.handsandhead.com).
   Features:
     - Multi-tier fast stream fallback (R2 CDN -> Drive API -> R2 dev -> Poster)
     - Zero-delay background video preloader
     - Precise timeline scrubber with buffer bars and hover timecodes
     - Frame stepping (60 FPS precision), speed switcher, loop/slideshow modes
     - Telemetry & Stream Diagnostics HUD (Codec, resolution, buffer health)
     - Interactive hover scrub on mega wall cards
     - 4-way multi-camera synchronized playback
     - 432Hz ambient drone synthesizer & audio-visualizer
     - Picture-in-Picture and Contain/Cover aspect ratio controls
============================================================ */

(function () {
  'use strict';

  /* ---------------- Drive & R2 Root Configuration ---------------- */
  var CONFIG = {
    driveRootFolderId: '1zno_n1n23dbIb4HE8giapSAqGS9WZd33',
    driveApiKey: 'AIzaSyCqU3qT5SaRYTZev6ZfChJvApRDGDzv88Y',
    pageSize: 100,
    r2Enabled: true,
    r2BaseUrl: 'https://xvideos.handsandhead.com',
    fps: 60
  };

  var FOLDER_MIME = 'application/vnd.google-apps.folder';
  var DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

  // Seed clips
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
    currentIndex: 0,
    activeVideoEl: null,
    isPlaying: true,
    playbackMode: 'slideshow', // 'slideshow' (auto-advance), 'loop' (single clip loop), 'once' (play once)
    slideIntervalMs: 6500,
    slideTimer: null,
    progressTimer: null,
    progressStart: 0,
    playbackRate: 1.0,
    fitMode: 'cover', // 'cover' or 'contain'
    isMuted: true,
    volume: 0,
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
    hudOpen: false,
    preloadedVideos: {}
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
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00.00';
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    var ms = Math.floor((seconds % 1) * 100);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + '.' + (ms < 10 ? '0' : '') + ms;
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

  /* ---------------- Multi-Tier Video Stream Preloader & Fallback ---------------- */
  function bindVideoFallback(video, item) {
    if (!video) return;

    video.addEventListener('error', function () {
      if (video.dataset.fallbackTier === '3') return;
      var currentTier = parseInt(video.dataset.fallbackTier || '0', 10);

      if (currentTier === 0 && item && item.fallbackSrc && video.src !== item.fallbackSrc) {
        video.dataset.fallbackTier = '1';
        video.src = item.fallbackSrc;
        video.load();
        video.play().catch(function () {});
      } else if (currentTier <= 1 && item && item.id) {
        video.dataset.fallbackTier = '2';
        var driveProxy = DRIVE_FILES_URL + '/' + item.id + '?alt=media&key=' + CONFIG.driveApiKey;
        video.src = driveProxy;
        video.load();
        video.play().catch(function () {});
      } else {
        video.dataset.fallbackTier = '3';
        console.warn('Video stream fallback exhausted:', video.src);
      }
    });
  }

  function preloadAsset(item) {
    if (!item || !item.src || State.preloadedVideos[item.src]) return;
    var v = document.createElement('video');
    v.src = item.src;
    v.preload = 'auto';
    v.muted = true;
    v.playsInline = true;
    State.preloadedVideos[item.src] = v;
  }

  function preloadNextUpcoming() {
    var len = State.catalog.length;
    if (len === 0) return;
    var next1 = State.catalog[(State.currentIndex + 1) % len];
    var next2 = State.catalog[(State.currentIndex + 2) % len];
    preloadAsset(next1);
    preloadAsset(next2);
  }

  /* ---------------- Drive & R2 Root Crawler ---------------- */
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
        showToast('LOADED ' + State.catalog.length + ' ACTIVE MOTION ASSETS');
        updateFilmstripCount();
        if (State.mode === 'wall') renderMegaWall();
        if (State.mode === 'curated') renderLookbooks();
        preloadNextUpcoming();
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
     VIEW 1: PRO CINEMA STUDIO PLAYER & TIMELINE SCRUBBER
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
      }, 700);
    }

    var newLayer = el('div', 'cinema-slide-layer fit-' + State.fitMode);

    // 1. Instant Poster Stage
    var posterSrc = item.poster || (item.fallbackSrc ? item.fallbackSrc : item.src);
    var posterImg = el('img', 'cinema-slide-poster');
    posterImg.src = posterSrc;
    posterImg.alt = item.title;
    newLayer.appendChild(posterImg);

    // 2. High-performance Video stream
    var video = el('video');
    video.src = item.src;
    video.setAttribute('data-fallback-src', item.fallbackSrc || item.src);
    video.autoplay = true;
    video.loop = (State.playbackMode === 'loop');
    video.muted = State.isMuted;
    video.volume = State.volume;
    video.playbackRate = State.playbackRate;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');

    bindVideoFallback(video, item);

    // Attach to State
    State.activeVideoEl = video;

    // Timeline sync & Buffer monitoring
    video.addEventListener('timeupdate', function () {
      updateStudioTimeline(video);
    });

    video.addEventListener('progress', function () {
      updateBufferBar(video);
    });

    video.addEventListener('loadedmetadata', function () {
      var durEl = document.getElementById('studio-time-dur');
      if (durEl) durEl.textContent = formatTime(video.duration);
      updateTelemetryHUD(item, video);
    });

    video.addEventListener('ended', function () {
      if (State.playbackMode === 'slideshow') {
        nextSlide();
      } else if (State.playbackMode === 'once') {
        togglePlayState(false);
      }
    });

    video.addEventListener('canplay', function () {
      newLayer.classList.add('video-ready');
      if (State.isPlaying) {
        video.play().catch(function () {});
      }
      updateBufferBar(video);
    });

    video.addEventListener('playing', function () {
      newLayer.classList.add('video-ready');
      updatePlayButtonUI(true);
    });

    video.addEventListener('pause', function () {
      updatePlayButtonUI(false);
    });

    newLayer.appendChild(video);
    layersWrap.appendChild(newLayer);

    requestAnimationFrame(function () {
      newLayer.classList.add('active');
      if (State.isPlaying) {
        video.play().catch(function () {});
      }
    });

    updateTextLayover(item, index);
    updateFilmstripActive(index);
    updateTelemetryHUD(item, video);
    resetSlideProgress();
    preloadNextUpcoming();
  }

  function updateStudioTimeline(video) {
    if (!video) return;
    var cur = video.currentTime || 0;
    var dur = video.duration || 1;
    var pct = Math.min(100, Math.max(0, (cur / dur) * 100));

    var playedBar = document.getElementById('studio-played-bar');
    var handle = document.getElementById('studio-scrubber-handle');
    var curEl = document.getElementById('studio-time-cur');
    var frameBadge = document.getElementById('studio-frame-badge');

    if (playedBar) playedBar.style.width = pct + '%';
    if (handle) handle.style.left = pct + '%';
    if (curEl) curEl.textContent = formatTime(cur);

    if (frameBadge) {
      var currentFrame = Math.floor(cur * CONFIG.fps);
      frameBadge.textContent = 'F: ' + (currentFrame < 100 ? (currentFrame < 10 ? '00' : '0') : '') + currentFrame;
    }
  }

  function updateBufferBar(video) {
    if (!video || !video.buffered || video.buffered.length === 0) return;
    var bufBar = document.getElementById('studio-buffer-bar');
    if (!bufBar) return;
    try {
      var end = video.buffered.end(video.buffered.length - 1);
      var dur = video.duration || 1;
      var pct = Math.min(100, (end / dur) * 100);
      bufBar.style.width = pct + '%';
      var hudBuf = document.getElementById('hud-buffer');
      if (hudBuf) hudBuf.textContent = 'Buffered ' + Math.round(pct) + '% (' + end.toFixed(1) + 's / ' + dur.toFixed(1) + 's)';
    } catch (e) {}
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

    if (!State.isPlaying || State.playbackMode !== 'slideshow') {
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

  function updatePlayButtonUI(isPlaying) {
    var proPlayBtn = document.getElementById('studio-play-btn');
    var topToggleBtn = document.getElementById('btn-slideshow-toggle');
    var topIcon = document.getElementById('slideshow-icon');
    var topText = document.getElementById('slideshow-text');

    if (proPlayBtn) proPlayBtn.textContent = isPlaying ? '❚❚' : '▶';
    if (topToggleBtn) topToggleBtn.classList.toggle('active', isPlaying);
    if (topIcon) topIcon.textContent = isPlaying ? '❚❚' : '▶';
    if (topText) topText.textContent = isPlaying ? 'AUTO ' + (State.slideIntervalMs / 1000) + 's' : 'PAUSED';
  }

  function togglePlayState(forceState) {
    if (forceState !== undefined) State.isPlaying = forceState;
    else State.isPlaying = !State.isPlaying;

    clearInterval(State.slideTimer);

    if (State.isPlaying) {
      if (State.activeVideoEl) State.activeVideoEl.play().catch(function () {});
      if (State.playbackMode === 'slideshow') {
        State.slideTimer = setInterval(nextSlide, State.slideIntervalMs);
      }
      resetSlideProgress();
      updatePlayButtonUI(true);
      showToast('PLAYBACK: IN MOTION');
    } else {
      if (State.activeVideoEl) State.activeVideoEl.pause();
      clearInterval(State.progressTimer);
      var fill = document.getElementById('layover-progress-fill');
      if (fill) fill.style.width = '0%';
      updatePlayButtonUI(false);
      showToast('PLAYBACK: PAUSED');
    }
  }

  function nextSlide() {
    if (State.catalog.length === 0) return;
    State.currentIndex = (State.currentIndex + 1) % State.catalog.length;
    renderCinemaSlide(State.currentIndex);
    if (State.isPlaying && State.playbackMode === 'slideshow') {
      clearInterval(State.slideTimer);
      State.slideTimer = setInterval(nextSlide, State.slideIntervalMs);
    }
  }

  function prevSlide() {
    if (State.catalog.length === 0) return;
    State.currentIndex = (State.currentIndex - 1 + State.catalog.length) % State.catalog.length;
    renderCinemaSlide(State.currentIndex);
    if (State.isPlaying && State.playbackMode === 'slideshow') {
      clearInterval(State.slideTimer);
      State.slideTimer = setInterval(nextSlide, State.slideIntervalMs);
    }
  }

  function stepFrame(frames) {
    if (!State.activeVideoEl) return;
    State.activeVideoEl.pause();
    togglePlayState(false);
    var dur = State.activeVideoEl.duration;
    if (!isFinite(dur) || isNaN(dur) || dur <= 0) return;
    var frameDuration = 1 / CONFIG.fps;
    var cur = isFinite(State.activeVideoEl.currentTime) ? State.activeVideoEl.currentTime : 0;
    var target = Math.max(0, Math.min(dur, cur + (frames * frameDuration)));
    if (isFinite(target)) {
      State.activeVideoEl.currentTime = target;
      updateStudioTimeline(State.activeVideoEl);
      showToast((frames > 0 ? '+1' : '-1') + ' FRAME STEP (' + target.toFixed(3) + 's)');
    }
  }

  function seekDelta(seconds) {
    if (!State.activeVideoEl) return;
    var dur = State.activeVideoEl.duration;
    if (!isFinite(dur) || isNaN(dur) || dur <= 0) return;
    var cur = isFinite(State.activeVideoEl.currentTime) ? State.activeVideoEl.currentTime : 0;
    var target = Math.max(0, Math.min(dur, cur + seconds));
    if (isFinite(target)) {
      State.activeVideoEl.currentTime = target;
      updateStudioTimeline(State.activeVideoEl);
      showToast((seconds > 0 ? '+' : '') + seconds + 's SEEK');
    }
  }

  function setPlaybackRate(rate) {
    State.playbackRate = parseFloat(rate);
    if (State.activeVideoEl) State.activeVideoEl.playbackRate = State.playbackRate;
    var sel = document.getElementById('studio-speed-select');
    if (sel) sel.value = String(rate);
    var fpsHud = document.getElementById('hud-fps');
    if (fpsHud) fpsHud.textContent = rate + '× @ ' + Math.round(CONFIG.fps * State.playbackRate) + ' FPS';
    showToast('PLAYBACK SPEED: ' + rate + '×');
  }

  function cyclePlaybackMode() {
    var modes = ['slideshow', 'loop', 'once'];
    var idx = modes.indexOf(State.playbackMode);
    State.playbackMode = modes[(idx + 1) % modes.length];

    var btn = document.getElementById('studio-loop-mode-btn');
    var icon = document.getElementById('studio-loop-icon');
    var label = document.getElementById('studio-loop-label');

    if (State.playbackMode === 'slideshow') {
      if (icon) icon.textContent = '↻';
      if (label) label.textContent = 'AUTO 6s';
      if (btn) btn.classList.add('active');
      if (State.activeVideoEl) State.activeVideoEl.loop = false;
      if (State.isPlaying) {
        clearInterval(State.slideTimer);
        State.slideTimer = setInterval(nextSlide, State.slideIntervalMs);
        resetSlideProgress();
      }
      showToast('MODE: AUTO-ADVANCE SLIDESHOW');
    } else if (State.playbackMode === 'loop') {
      if (icon) icon.textContent = '⟳';
      if (label) label.textContent = 'LOOP CLIP';
      if (btn) btn.classList.add('active');
      if (State.activeVideoEl) State.activeVideoEl.loop = true;
      clearInterval(State.slideTimer);
      clearInterval(State.progressTimer);
      var fill = document.getElementById('layover-progress-fill');
      if (fill) fill.style.width = '0%';
      showToast('MODE: SINGLE CLIP INFINITE LOOP');
    } else {
      if (icon) icon.textContent = '➔';
      if (label) label.textContent = 'PLAY ONCE';
      if (btn) btn.classList.remove('active');
      if (State.activeVideoEl) State.activeVideoEl.loop = false;
      clearInterval(State.slideTimer);
      clearInterval(State.progressTimer);
      var fill = document.getElementById('layover-progress-fill');
      if (fill) fill.style.width = '0%';
      showToast('MODE: PLAY ONCE & HOLD');
    }
  }

  function toggleFitMode() {
    State.fitMode = State.fitMode === 'cover' ? 'contain' : 'cover';
    qsa('.cinema-slide-layer').forEach(function (layer) {
      layer.className = 'cinema-slide-layer fit-' + State.fitMode + (layer.classList.contains('active') ? ' active' : '') + (layer.classList.contains('video-ready') ? ' video-ready' : '');
    });
    var fitBtn = document.getElementById('studio-fit-btn');
    if (fitBtn) fitBtn.textContent = State.fitMode === 'cover' ? '⛶ COVER' : '⊡ FIT';
    showToast('VIEWPORT SCALING: ' + State.fitMode.toUpperCase());
  }

  function toggleMute() {
    State.isMuted = !State.isMuted;
    if (State.activeVideoEl) State.activeVideoEl.muted = State.isMuted;
    var muteBtn = document.getElementById('studio-mute-btn');
    var volSlider = document.getElementById('studio-vol-slider');

    if (State.isMuted) {
      if (muteBtn) muteBtn.textContent = '🔇';
      if (volSlider) volSlider.value = 0;
      showToast('AUDIO MUTED');
    } else {
      State.volume = State.volume || 0.7;
      if (State.activeVideoEl) State.activeVideoEl.volume = State.volume;
      if (muteBtn) muteBtn.textContent = '🔊';
      if (volSlider) volSlider.value = State.volume;
      showToast('AUDIO UNMUTED (' + Math.round(State.volume * 100) + '%)');
    }
  }

  function updateTelemetryHUD(item, video) {
    var hudSrc = document.getElementById('hud-source');
    var hudUrl = document.getElementById('hud-url');
    var hudRes = document.getElementById('hud-res');
    var hudBuf = document.getElementById('hud-buffer');
    var hudFps = document.getElementById('hud-fps');

    if (hudSrc) hudSrc.textContent = (item && item.src && item.src.indexOf('googleapis.com') !== -1) ? 'Google Drive Proxy Stream' : 'Cloudflare R2 High-Speed CDN';
    if (hudUrl) hudUrl.textContent = item ? item.src : '--';
    if (hudRes && video) {
      var w = video.videoWidth || 1080;
      var h = video.videoHeight || 1920;
      hudRes.textContent = w + ' × ' + h + ' (' + (w < h ? '9:16 Vertical' : '16:9 Cinema') + ')';
    }
    if (hudBuf) hudBuf.textContent = 'Active (ReadyState ' + (video ? video.readyState : 4) + '/4)';
    if (hudFps) hudFps.textContent = State.playbackRate + '× @ ' + Math.round(CONFIG.fps * State.playbackRate) + ' FPS Direct Stream';
  }

  /* ---------------- Interactive Timeline Drag & Hover ---------------- */
  function initScrubberEvents() {
    var wrap = document.getElementById('studio-scrubber-wrap');
    var track = document.getElementById('studio-scrubber-track');
    var hoverTime = document.getElementById('studio-hover-time');
    if (!wrap || !track) return;

    var isDragging = false;

    function getPctFromEvent(e) {
      var rect = track.getBoundingClientRect();
      var clientX = e.touches ? e.touches[0].clientX : e.clientX;
      var pos = clientX - rect.left;
      return Math.max(0, Math.min(1, pos / rect.width));
    }

    function applySeek(pct) {
      if (!State.activeVideoEl) return;
      var dur = State.activeVideoEl.duration;
      if (!isFinite(dur) || isNaN(dur) || dur <= 0) return;
      var target = Math.max(0, Math.min(dur, pct * dur));
      if (isFinite(target)) {
        State.activeVideoEl.currentTime = target;
        updateStudioTimeline(State.activeVideoEl);
      }
    }

    wrap.addEventListener('mousedown', function (e) {
      isDragging = true;
      wrap.classList.add('scrubbing');
      var pct = getPctFromEvent(e);
      applySeek(pct);
    });

    wrap.addEventListener('mousemove', function (e) {
      var pct = getPctFromEvent(e);
      if (isDragging) {
        applySeek(pct);
      }
      if (hoverTime && State.activeVideoEl && State.activeVideoEl.duration) {
        var hoverSec = pct * State.activeVideoEl.duration;
        hoverTime.textContent = formatTime(hoverSec);
        hoverTime.style.left = (pct * 100) + '%';
      }
    });

    document.addEventListener('mouseup', function () {
      if (isDragging) {
        isDragging = false;
        wrap.classList.remove('scrubbing');
      }
    });

    // Touch support for timeline
    wrap.addEventListener('touchstart', function (e) {
      isDragging = true;
      wrap.classList.add('scrubbing');
      applySeek(getPctFromEvent(e));
    }, { passive: true });

    wrap.addEventListener('touchmove', function (e) {
      if (isDragging) applySeek(getPctFromEvent(e));
    }, { passive: true });

    wrap.addEventListener('touchend', function () {
      isDragging = false;
      wrap.classList.remove('scrubbing');
    });
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
        if (State.isPlaying && State.playbackMode === 'slideshow') {
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
     VIEW 2: 3D MEGA WALL (Fast Hover Scrubbing + Smooth Streams)
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

    if ('IntersectionObserver' in window) {
      if (wallObserver) wallObserver.disconnect();
      wallObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var card = entry.target;
          var vid = qs('video', card);
          if (entry.isIntersecting) {
            if (vid) {
              if (!vid.src && vid.dataset.src) {
                vid.src = vid.dataset.src;
                vid.load();
              }
              vid.play().then(function () {
                card.classList.add('playing');
              }).catch(function () {});
            }
          } else {
            if (vid) {
              vid.pause();
              card.classList.remove('playing');
            }
          }
        });
      }, { rootMargin: '140px 0px', threshold: 0.1 });
    }

    filtered.forEach(function (item, i) {
      var card = el('div', 'wall-card');
      var posterUrl = item.poster || (item.fallbackSrc ? item.fallbackSrc : item.src);
      card.innerHTML =
        '<div class="wall-card-scrub-bar"></div>' +
        '<video src="' + item.src + '" data-fallback-src="' + (item.fallbackSrc || item.src) + '" muted loop playsinline autoplay preload="auto"></video>' +
        '<div class="wall-card-overlay">' +
          '<span class="wall-card-badge">' + escapeHtml(item.category || 'RAWX') + '</span>' +
          '<div class="wall-card-info">' +
            '<h4>' + escapeHtml(item.title) + '</h4>' +
            '<p>' + escapeHtml(item.motion) + ' • ' + escapeHtml(item.fabric) + '</p>' +
          '</div>' +
        '</div>';

      var pImg = el('img', 'wall-card-poster');
      pImg.src = posterUrl;
      pImg.alt = item.title;
      pImg.loading = 'lazy';
      card.insertBefore(pImg, card.firstChild);

      var vid = qs('video', card);
      vid.dataset.src = item.src;
      vid.preload = i < 8 ? 'auto' : 'none';

      vid.addEventListener('playing', function () { card.classList.add('playing'); });
      vid.addEventListener('canplay', function () { card.classList.add('playing'); });
      bindVideoFallback(vid, item);

      // Fast Mouse Hover Scrubbing on card
      var scrubBar = qs('.wall-card-scrub-bar', card);
      card.addEventListener('mousemove', function (e) {
        if (!vid) return;
        var dur = vid.duration;
        if (!isFinite(dur) || isNaN(dur) || dur <= 0) return;
        var r = card.getBoundingClientRect();
        if (r.width <= 0) return;
        var pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        var target = pct * dur;
        if (isFinite(target)) {
          vid.currentTime = target;
        }
        if (scrubBar) scrubBar.style.width = (pct * 100) + '%';
      });

      card.addEventListener('mouseleave', function () {
        if (scrubBar) scrubBar.style.width = '0%';
      });

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
        bindVideoFallback(v, item);
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
     VIEW 4: CURATED LOOKBOOK REELS
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
        bindVideoFallback(v, it);

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
        togglePlayState(true);
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
    else if (modeName === 'cinema') renderCinemaSlide(State.currentIndex);

    showToast('VIEW MODE: ' + modeName.toUpperCase());
  }

  /* ================================================================
     AMBIENT SYNTHESIZER (432Hz Harmonic Dronescape)
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
        osc1.frequency.setValueAtTime(54, State.audioCtx.currentTime);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(108, State.audioCtx.currentTime);

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
     EVENT BINDINGS & CONTROLS DECK
  ================================================================ */
  function initEvents() {
    enrichFromPinnedStorage();

    // Mode Buttons
    qsa('.album-mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setViewMode(btn.dataset.mode);
      });
    });

    // Pro Studio Deck Controls
    var proPlay = document.getElementById('studio-play-btn');
    if (proPlay) proPlay.addEventListener('click', function () { togglePlayState(); });

    var topSlideToggle = document.getElementById('btn-slideshow-toggle');
    if (topSlideToggle) topSlideToggle.addEventListener('click', function () { togglePlayState(); });

    var prevBtn = document.getElementById('studio-prev-btn');
    if (prevBtn) prevBtn.addEventListener('click', prevSlide);

    var nextBtn = document.getElementById('studio-next-btn');
    if (nextBtn) nextBtn.addEventListener('click', nextSlide);

    var stepBackBtn = document.getElementById('studio-step-back-btn');
    if (stepBackBtn) stepBackBtn.addEventListener('click', function () { stepFrame(-1); });

    var stepFwdBtn = document.getElementById('studio-step-fwd-btn');
    if (stepFwdBtn) stepFwdBtn.addEventListener('click', function () { stepFrame(1); });

    var loopModeBtn = document.getElementById('studio-loop-mode-btn');
    if (loopModeBtn) loopModeBtn.addEventListener('click', cyclePlaybackMode);

    var speedSelect = document.getElementById('studio-speed-select');
    if (speedSelect) {
      speedSelect.addEventListener('change', function (e) {
        setPlaybackRate(e.target.value);
      });
    }

    var fitBtn = document.getElementById('studio-fit-btn');
    if (fitBtn) fitBtn.addEventListener('click', toggleFitMode);

    var muteBtn = document.getElementById('studio-mute-btn');
    if (muteBtn) muteBtn.addEventListener('click', toggleMute);

    var volSlider = document.getElementById('studio-vol-slider');
    if (volSlider) {
      volSlider.addEventListener('input', function (e) {
        State.volume = parseFloat(e.target.value);
        if (State.volume > 0) State.isMuted = false;
        else State.isMuted = true;
        if (State.activeVideoEl) {
          State.activeVideoEl.volume = State.volume;
          State.activeVideoEl.muted = State.isMuted;
        }
        if (muteBtn) muteBtn.textContent = State.isMuted ? '🔇' : '🔊';
      });
    }

    var pipBtn = document.getElementById('studio-pip-btn');
    if (pipBtn) {
      pipBtn.addEventListener('click', function () {
        if (!State.activeVideoEl) return;
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(function () {});
        } else if (State.activeVideoEl.requestPictureInPicture) {
          State.activeVideoEl.requestPictureInPicture().catch(function () {});
        }
      });
    }

    // Telemetry HUD Toggle
    var statsBtn = document.getElementById('studio-stats-btn');
    var hud = document.getElementById('studio-stats-hud');
    var hudClose = document.getElementById('hud-close-btn');

    if (statsBtn && hud) {
      statsBtn.addEventListener('click', function () {
        State.hudOpen = !State.hudOpen;
        hud.classList.toggle('open', State.hudOpen);
        statsBtn.classList.toggle('active', State.hudOpen);
        if (State.hudOpen && State.activeVideoEl) {
          updateTelemetryHUD(State.catalog[State.currentIndex], State.activeVideoEl);
        }
      });
    }

    if (hudClose && hud) {
      hudClose.addEventListener('click', function () {
        State.hudOpen = false;
        hud.classList.remove('open');
        if (statsBtn) statsBtn.classList.remove('active');
      });
    }

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

    // Sound synth toggle
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
    var panelsBtn = document.getElementById('album-panels-nav-btn') || document.getElementById('panels-nav-btn');
    var panelsMenu = document.getElementById('album-panels-menu') || document.getElementById('panels-menu');
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
    qsa('.theme-select').forEach(function (sel) {
      sel.addEventListener('change', function (e) {
        document.documentElement.setAttribute('data-theme', e.target.value);
        qsa('.theme-select').forEach(function (otherSel) {
          if (otherSel !== sel) otherSel.value = e.target.value;
        });
        showToast('THEME: ' + e.target.value.toUpperCase());
      });
    });

    // Keyboard Shortcuts (Studio Broadcast Standard)
    document.addEventListener('keydown', function (e) {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      var lb = document.getElementById('lightbox');
      if (lb && lb.classList.contains('open')) return;
      var albumEl = document.getElementById('album-section') || document.getElementById('album-main');
      if (albumEl) {
        var rect = albumEl.getBoundingClientRect();
        // Only active if album view is in viewport
        if (rect.bottom < 100 || rect.top > window.innerHeight - 100) return;
      }

      if (e.code === 'Space' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        togglePlayState();
      } else if (e.key === 'j' || e.key === 'J') {
        seekDelta(-5);
      } else if (e.key === 'l' || e.key === 'L') {
        seekDelta(5);
      } else if (e.key === ',' || e.key === '<') {
        stepFrame(-1);
      } else if (e.key === '.' || e.key === '>') {
        stepFrame(1);
      } else if (e.code === 'ArrowRight') {
        if (e.shiftKey) seekDelta(10);
        else nextSlide();
      } else if (e.code === 'ArrowLeft') {
        if (e.shiftKey) seekDelta(-10);
        else prevSlide();
      } else if (e.key === 'm' || e.key === 'M') {
        toggleMute();
      } else if (e.key === 'c' || e.key === 'C') {
        toggleFitMode();
      } else if (e.key === 't' || e.key === 'T') {
        if (textToggle) textToggle.click();
      } else if (e.key === 'f' || e.key === 'F') {
        if (fsBtn) fsBtn.click();
      } else if (e.key === 'p' || e.key === 'P') {
        if (pipBtn) pipBtn.click();
      } else if (e.key === 's' || e.key === 'S') {
        toggleAudioSynth();
      } else if (e.key === 'h' || e.key === 'H') {
        if (statsBtn) statsBtn.click();
      } else if (e.key >= '1' && e.key <= '4') {
        var modes = ['cinema', 'wall', 'split', 'curated'];
        setViewMode(modes[parseInt(e.key, 10) - 1]);
      }
    });

    // Touch Swipe Navigation for Cinema Stage
    var touchStartX = 0;
    var cinemaStage = document.getElementById('cinema-stage');
    if (cinemaStage) {
      cinemaStage.addEventListener('touchstart', function (e) {
        touchStartX = e.touches[0].clientX;
      }, { passive: true });

      cinemaStage.addEventListener('touchend', function (e) {
        var deltaX = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(deltaX) > 70) {
          if (deltaX < 0) nextSlide();
          else prevSlide();
        }
      }, { passive: true });
    }

    // Initialize Interactive Timeline
    initScrubberEvents();

    // Render Initial State
    renderCinemaSlide(0);
    renderFilmstrip();
    State.slideTimer = setInterval(nextSlide, State.slideIntervalMs);

    // Launch background Drive root scan to discover full catalog
    scanAllRootVideos();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initEvents);
  } else {
    initEvents();
  }

})();
