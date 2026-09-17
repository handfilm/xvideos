/* ============================================================
   RAWX MOTION LAB — DESKTOP ENGINE
   Drive structure expected:
     ROOT FOLDER
       └─ Category folder      (becomes a top tab, e.g. "Signature")
            └─ Tag folder      (becomes a tag chip, e.g. "Back Studies")
                 └─ image/video files

   Everything is fetched lazily: categories at boot, tags when a
   category is opened, files (paginated) when a tag is opened.
   Nothing is ever fetched recursively up front — this is built to
   survive very large libraries (tens of thousands of files).
============================================================ */
(function () {
  'use strict';

  /* ---------------- Config ---------------- */
  // Point this at the ROOT folder that CONTAINS your category folders
  // (not a folder of files directly). Share it "Anyone with the link".
  var CONFIG = {
    driveRootFolderId: '1zno_n1n23dbIb4HE8giapSAqGS9WZd33',
    driveApiKey: 'AIzaSyCqU3qT5SaRYTZev6ZfChJvApRDGDzv88Y',
    pageSize: 60,

    // ---- Advanced Edge Streaming ----
    r2Enabled: false,
    r2BaseUrl: '',
    r2FallbackToDrive: true
  };

  // ---- Multi-resolution stream variants ----
  // If your R2/Drive files are exported in multiple resolutions with a
  // suffix before the extension (e.g. clip.mp4, clip_1080p.mp4,
  // clip_720p.mp4), list the suffixes here. 'auto' never rewrites the
  // filename (uses whatever the base file is). Missing variants simply
  // 404 and the player falls back silently via bindVideoFallback.
  var RESOLUTIONS = {
    auto: { label: 'AUTO', suffix: '' },
    '4k': { label: '4K', suffix: '_4k' },
    '1080p': { label: '1080P', suffix: '_1080p' },
    '720p': { label: '720P', suffix: '_720p' }
  };

  var FOLDER_MIME = 'application/vnd.google-apps.folder';
  var DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

  /* ---------------- Small utils ---------------- */
  function titleFromName(name) {
    return name.replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function uid() { return 'w' + (++uid.n); }
  uid.n = 0;
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function formatDuration(sec) {
    sec = Math.round(sec);
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function formatTimecode(sec) {
    if (!isFinite(sec) || isNaN(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    var ms = Math.floor((sec % 1) * 100);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + '.' + (ms < 10 ? '0' : '') + ms;
  }
  function setBootStatus(text) {
    var e = document.getElementById('boot-status');
    if (e) e.textContent = text;
  }
  function showToast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  window.showToast = showToast;

  /* ================================================================
     SUPER-APP STATE — resolution, theme, spotlight, sync, presentation, mute.
     Kept in one place so every subsystem below can read/write it.
  ================================================================ */
  var Super = {
    resolution: loadPref('rawx_resolution', 'auto'),
    theme: loadPref('rawx_theme', 'brutalist-red'),
    spotlight: false,
    presentation: false,
    isMuted: loadPref('rawx_global_mute', 'true') === 'true',
    snapEnabled: loadPref('rawx_snap_enabled', 'true') === 'true',
    streamFocus: loadPref('rawx_stream_focus', 'true') === 'true',
    scrollAutoplay: loadPref('rawx_scroll_autoplay', 'false') === 'true'
  };
  // Every video currently in the DOM across windows, grids, lightbox, compare window
  // and the PiP widget — queried live (never cached) so it's always correct.
  function allLiveVideos() { return qsa('.win-grid video, #lb-video, .compare-video, #pip-video, .desktop-hero-grid video, #desktop video, .win video'); }
  function loadPref(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }
  function savePref(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }

  /* ================================================================
     ADVANCED MASTER PLAYBACK CONTROLLER (1-STREAM HARDWARE FOCUS)
     - Exclusive Single-Video Playback: Halts all other videos across
       open desktop windows, hero background, and lightbox on click/action.
       Dedicating 100% of decoder pipelines and GPU memory bandwidth to
       1 active stream guarantees 60fps instant response, zero stutter,
       and fast buffering.
     - Intelligent Autoplay on Scroll: While scrolling, auto-plays only
       the video closest to the vertical center of the window view,
       keeping all off-center streams paused.
     - Master HUD: Cyberpunk floating deck with live EQ visualizer,
       scrubber with buffered progress, instant speed chips, frame stepping,
       PiP, and Theater modes.
  ================================================================ */
  var PlaybackMaster = {
    activeVideo: null,
    activeMeta: null,
    manualLock: false,
    lockedVideo: null,
    currentSpeed: 1,
    hudEl: null,
    isSeeking: false,

    init: function () {
      this.currentSpeed = loadSpeedPref();
      this.hudEl = document.getElementById('master-playback-hud');
      this.bindHUD();
      this.bindGlobalEvents();
      this.updateTogglesUI();
    },

    updateTogglesUI: function () {
      qsa('.stream-focus-btn').forEach(function (btn) {
        btn.classList.toggle('active', Super.streamFocus);
        btn.innerHTML = Super.streamFocus ? '⚡ 1-STREAM: ON' : '⚡ 1-STREAM: OFF';
      });
      qsa('.scroll-autoplay-btn').forEach(function (btn) {
        btn.classList.toggle('active', Super.scrollAutoplay);
        btn.innerHTML = Super.scrollAutoplay ? '⟳ AUTOPLAY: ON' : '⟳ AUTOPLAY: OFF';
      });
    },

    toggleStreamFocus: function () {
      Super.streamFocus = !Super.streamFocus;
      savePref('rawx_stream_focus', Super.streamFocus ? 'true' : 'false');
      this.updateTogglesUI();
      if (Super.streamFocus && this.activeVideo && !this.activeVideo.paused) {
        this.pauseAllExcept(this.activeVideo);
      }
      showToast(Super.streamFocus ? '1-STREAM FOCUS: ACTIVE (MAX SPEED // ALL OTHER STREAMS HALTED)' : '1-STREAM FOCUS: OFF (MULTI-STREAM PERMITTED)');
    },

    toggleScrollAutoplay: function () {
      Super.scrollAutoplay = !Super.scrollAutoplay;
      savePref('rawx_scroll_autoplay', Super.scrollAutoplay ? 'true' : 'false');
      this.updateTogglesUI();
      showToast(Super.scrollAutoplay ? 'AUTOPLAY ON SCROLL: ENABLED' : 'AUTOPLAY: OFF (HOVER PREVIEW / CLICK ONLY)');
    },

    pauseAllExcept: function (targetVideo) {
      var all = allLiveVideos();
      for (var i = 0; i < all.length; i++) {
        var v = all[i];
        if (v !== targetVideo) {
          if (!v.paused) v.pause();
          delete v.dataset.userPlaying;
        }
      }
      qsa('.win-grid .asset-card.card-now-playing, .win-grid .asset-card.card-user-playing').forEach(function (card) {
        var cv = qs('video', card);
        if (cv !== targetVideo) {
          card.classList.remove('card-now-playing');
          card.classList.remove('card-user-playing');
          var pillText = qs('.play-pill-text', card);
          if (pillText) pillText.textContent = 'PLAY';
          var pillIcon = qs('.play-pill-icon', card);
          if (pillIcon) pillIcon.textContent = '▶';
        }
      });
      var stageVideos = qsa('.cinema-stage video');
      stageVideos.forEach(function (sv) {
        if (sv !== targetVideo && !sv.paused) {
          sv.pause();
          delete sv.dataset.userPlaying;
        }
      });
    },

    playExclusive: function (video, meta, isUserAction) {
      if (!video) return;
      var self = this;

      this.pauseAllExcept(video);

      if (isUserAction) {
        this.manualLock = true;
        this.lockedVideo = video;
        video.dataset.userPlaying = '1';
      }

      this.activeVideo = video;
      this.activeMeta = meta || this.activeMeta || {};

      video.playbackRate = this.currentSpeed;
      video.muted = Super.isMuted;
      video.preload = 'auto';

      var p = video.play();
      if (p && p.catch) p.catch(function () {});

      if (meta && meta.card) {
        meta.card.classList.add('card-now-playing');
        meta.card.classList.add('card-user-playing');
        var pillText = qs('.play-pill-text', meta.card);
        if (pillText) pillText.textContent = 'PAUSE';
        var pillIcon = qs('.play-pill-icon', meta.card);
        if (pillIcon) pillIcon.textContent = '❚❚';
        var bz = qs('.yt-bezel-pop', meta.card);
        if (bz) {
          var icon = qs('.yt-bezel-icon', bz) || bz;
          icon.textContent = '▶';
          bz.classList.remove('animate');
          void bz.offsetWidth;
          bz.classList.add('animate');
        }
      }

      this.syncHUD();
      this.showHUD();
    },

    pauseExclusive: function (video) {
      var v = video || this.activeVideo;
      if (v) {
        v.pause();
        delete v.dataset.userPlaying;
      }
      if (this.activeMeta && this.activeMeta.card) {
        this.activeMeta.card.classList.remove('card-now-playing');
        this.activeMeta.card.classList.remove('card-user-playing');
        var pillText = qs('.play-pill-text', this.activeMeta.card);
        if (pillText) pillText.textContent = 'PLAY';
        var pillIcon = qs('.play-pill-icon', this.activeMeta.card);
        if (pillIcon) pillIcon.textContent = '▶';
        var bz = qs('.yt-bezel-pop', this.activeMeta.card);
        if (bz) {
          var icon = qs('.yt-bezel-icon', bz) || bz;
          icon.textContent = '❚❚';
          bz.classList.remove('animate');
          void bz.offsetWidth;
          bz.classList.add('animate');
        }
      }
      this.syncHUD();
    },

    toggleExclusive: function (video, meta) {
      if (!video) return;
      if (video.paused || video.dataset.userPlaying !== '1') {
        this.playExclusive(video, meta, true);
      } else {
        this.pauseExclusive(video);
      }
    },

    setSpeed: function (speed) {
      this.currentSpeed = parseFloat(speed) || 1;
      saveSpeedPref(this.currentSpeed);
      if (this.activeVideo) {
        this.activeVideo.playbackRate = this.currentSpeed;
      }
      var self = this;
      qsa('.mph-speed-chip').forEach(function (chip) {
        chip.classList.toggle('active', parseFloat(chip.dataset.speed) === self.currentSpeed);
      });
      if (this.activeMeta && this.activeMeta.card) {
        var chip = qs('.asset-card-speed-chip', this.activeMeta.card);
        if (chip) chip.textContent = this.currentSpeed + '×';
      }
      showToast('PLAYBACK SPEED: ' + this.currentSpeed + '×');
    },

    stepSeconds: function (delta) {
      if (!this.activeVideo || !isFinite(this.activeVideo.duration)) return;
      var t = Math.min(Math.max(this.activeVideo.currentTime + delta, 0), this.activeVideo.duration);
      this.activeVideo.currentTime = t;
      this.updateHUDProgress();
    },

    stepFrame: function (dir) {
      if (!this.activeVideo || !isFinite(this.activeVideo.duration)) return;
      var t = Math.min(Math.max(this.activeVideo.currentTime + (dir * (1 / 60)), 0), this.activeVideo.duration);
      this.activeVideo.currentTime = t;
      this.updateHUDProgress();
    },

    showHUD: function () {
      if (!this.hudEl) return;
      this.hudEl.style.display = 'flex';
      this.hudEl.style.transform = 'translateY(0)';
      this.hudEl.style.opacity = '1';
    },

    hideHUD: function () {
      if (!this.hudEl) return;
      this.hudEl.style.transform = 'translateY(100%)';
      this.hudEl.style.opacity = '0';
      var self = this;
      setTimeout(function () {
        if (self.hudEl && self.hudEl.style.opacity === '0') {
          self.hudEl.style.display = 'none';
        }
      }, 250);
    },

    syncHUD: function () {
      if (!this.hudEl || !this.activeVideo) return;
      var v = this.activeVideo;
      var meta = this.activeMeta || {};

      var posterEl = document.getElementById('mph-poster');
      if (posterEl && meta.poster) posterEl.src = meta.poster;

      var titleEl = document.getElementById('mph-title');
      if (titleEl) titleEl.textContent = (meta.title || 'CLIP').toUpperCase();

      var catEl = document.getElementById('mph-cat');
      if (catEl) catEl.textContent = meta.cat || meta.pillar || 'MOTION LAB';

      var playBtn = document.getElementById('mph-play-btn');
      if (playBtn) {
        if (v.paused) {
          playBtn.textContent = '▶ PLAY';
          playBtn.style.background = 'transparent';
          playBtn.style.color = '#fff';
        } else {
          playBtn.textContent = '❚❚ PAUSE';
          playBtn.style.background = 'var(--red)';
          playBtn.style.color = '#000';
        }
      }

      var eqEl = document.getElementById('mph-eq');
      if (eqEl) {
        eqEl.style.opacity = v.paused ? '0.3' : '1';
      }

      var self = this;
      qsa('.mph-speed-chip').forEach(function (chip) {
        chip.classList.toggle('active', parseFloat(chip.dataset.speed) === self.currentSpeed);
      });

      this.updateHUDProgress();
    },

    updateHUDProgress: function () {
      if (!this.activeVideo) return;
      var v = this.activeVideo;
      var curEl = document.getElementById('mph-time-cur');
      var durEl = document.getElementById('mph-time-dur');
      var frameEl = document.getElementById('mph-frame');
      var playedBar = document.getElementById('mph-played-bar');
      var thumb = document.getElementById('mph-scrubber-thumb');
      var bufferBar = document.getElementById('mph-buffer-bar');
      var bufBadge = document.getElementById('mph-buf-badge');

      if (curEl && isFinite(v.currentTime)) curEl.textContent = formatDuration(v.currentTime);
      if (durEl && isFinite(v.duration)) durEl.textContent = formatDuration(v.duration);
      if (frameEl && isFinite(v.currentTime)) {
        var frame = Math.floor(v.currentTime * 60);
        frameEl.textContent = 'F: ' + String(frame).padStart(3, '0');
      }

      if (isFinite(v.duration) && v.duration > 0) {
        var pct = (v.currentTime / v.duration) * 100;
        if (playedBar && !this.isSeeking) playedBar.style.width = pct + '%';
        if (thumb && !this.isSeeking) thumb.style.left = pct + '%';

        if (bufferBar && v.buffered && v.buffered.length > 0) {
          var bufPct = 0;
          for (var i = v.buffered.length - 1; i >= 0; i--) {
            if (v.buffered.start(i) <= v.currentTime && v.currentTime <= v.buffered.end(i)) {
              bufPct = (v.buffered.end(i) / v.duration) * 100;
              break;
            }
          }
          if (!bufPct && v.buffered.length > 0) {
            bufPct = (v.buffered.end(v.buffered.length - 1) / v.duration) * 100;
          }
          bufPct = Math.min(Math.round(bufPct), 100);
          bufferBar.style.width = bufPct + '%';
          if (bufBadge) {
            bufBadge.textContent = 'BUF: ' + bufPct + '%';
            if (bufPct >= 80) bufBadge.classList.add('good');
            else bufBadge.classList.remove('good');
          }
        } else if (bufBadge) {
          bufBadge.textContent = 'BUF: --';
          bufBadge.classList.remove('good');
        }
      }
    },

    bindHUD: function () {
      var self = this;
      var playBtn = document.getElementById('mph-play-btn');
      if (playBtn) {
        playBtn.addEventListener('click', function () {
          if (self.activeVideo) {
            self.toggleExclusive(self.activeVideo, self.activeMeta);
          }
        });
      }

      var stepBack = document.getElementById('mph-step-back');
      if (stepBack) {
        stepBack.addEventListener('click', function () { self.stepSeconds(-1); });
      }

      var stepFwd = document.getElementById('mph-step-fwd');
      if (stepFwd) {
        stepFwd.addEventListener('click', function () { self.stepSeconds(1); });
      }

      qsa('.mph-speed-chip').forEach(function (btn) {
        btn.addEventListener('click', function () {
          self.setSpeed(btn.dataset.speed);
        });
      });

      var volBtn = document.getElementById('mph-vol-btn');
      if (volBtn) {
        volBtn.addEventListener('click', function () {
          toggleGlobalMute();
          volBtn.textContent = Super.isMuted ? '🔇' : '🔊';
        });
      }

      var pipBtn = document.getElementById('mph-pip-btn');
      if (pipBtn) {
        pipBtn.addEventListener('click', function () {
          if (self.activeVideo) {
            openPiP(self.activeVideo);
          }
        });
      }

      var expBtn = document.getElementById('mph-expand-btn');
      if (expBtn) {
        expBtn.addEventListener('click', function () {
          if (self.activeMeta && self.activeMeta.w && self.activeMeta.id) {
            openLightbox(self.activeMeta.w, self.activeMeta.id);
          }
        });
      }

      var closeBtn = document.getElementById('mph-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', function () {
          self.hideHUD();
        });
      }

      var scrubberWrap = document.getElementById('mph-scrubber-wrap');
      var scrubberTrack = document.getElementById('mph-scrubber-track');
      var scrubberHover = document.getElementById('mph-scrubber-hover');

      if (scrubberWrap && scrubberTrack) {
        function seekFromEvent(e) {
          if (!self.activeVideo || !isFinite(self.activeVideo.duration)) return;
          var rect = scrubberTrack.getBoundingClientRect();
          var x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
          var pct = x / rect.width;
          self.activeVideo.currentTime = pct * self.activeVideo.duration;
          var playedBar = document.getElementById('mph-played-bar');
          var thumb = document.getElementById('mph-scrubber-thumb');
          if (playedBar) playedBar.style.width = (pct * 100) + '%';
          if (thumb) thumb.style.left = (pct * 100) + '%';
          self.updateHUDProgress();
        }

        scrubberWrap.addEventListener('mousedown', function (e) {
          self.isSeeking = true;
          seekFromEvent(e);
          function onMove(me) { seekFromEvent(me); }
          function onUp() {
            self.isSeeking = false;
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          }
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });

        scrubberWrap.addEventListener('mousemove', function (e) {
          if (!self.activeVideo || !isFinite(self.activeVideo.duration) || !scrubberHover) return;
          var rect = scrubberTrack.getBoundingClientRect();
          var x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
          var pct = rect.width > 0 ? x / rect.width : 0;
          var hoverBar = document.getElementById('mph-hover-bar');
          if (hoverBar) hoverBar.style.width = (pct * 100) + '%';
          scrubberHover.style.display = 'block';
          scrubberHover.style.left = (pct * 100) + '%';
          scrubberHover.textContent = formatDuration(pct * self.activeVideo.duration);
        });

        scrubberWrap.addEventListener('mouseleave', function () {
          var hoverBar = document.getElementById('mph-hover-bar');
          if (hoverBar) hoverBar.style.width = '0%';
          if (scrubberHover) scrubberHover.style.display = 'none';
        });
      }
    },

    bindGlobalEvents: function () {
      var self = this;
      function loop() {
        if (self.activeVideo && !self.activeVideo.paused && !self.isSeeking) {
          self.updateHUDProgress();
        }
        requestAnimationFrame(loop);
      }
      requestAnimationFrame(loop);

      qsa('.stream-focus-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          self.toggleStreamFocus();
        });
      });

      qsa('.scroll-autoplay-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          self.toggleScrollAutoplay();
        });
      });
    },

    onWindowScroll: function (w) {
      if (!Super.scrollAutoplay) return;
      var body = qs('.win-body', w.dom);
      if (!body) return;

      if (this.manualLock && this.lockedVideo && !this.lockedVideo.paused) {
        var lockRect = this.lockedVideo.getBoundingClientRect();
        var bodyRect = body.getBoundingClientRect();
        if (lockRect.bottom > bodyRect.top - 40 && lockRect.top < bodyRect.bottom + 40) {
          return;
        }
        this.manualLock = false;
        this.lockedVideo = null;
      }

      var focal = this.findFocalVideoInWindow(w);
      if (!focal || !focal.video) return;

      if (focal.video !== this.activeVideo || (this.activeVideo && this.activeVideo.paused)) {
        this.playExclusive(focal.video, focal.meta, false);
      }
    },

    findFocalVideoInWindow: function (w) {
      var body = qs('.win-body', w.dom);
      if (!body) return null;
      var cards = qsa('.win-grid .asset-card', body);
      if (!cards.length) return null;

      var bodyRect = body.getBoundingClientRect();
      var targetCenterY = bodyRect.top + (bodyRect.height / 2);

      var minDiff = Infinity;
      var bestCard = null;
      var bestVid = null;
      var bestMeta = null;

      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var vid = qs('video', card);
        if (!vid) continue;
        var r = card.getBoundingClientRect();
        if (r.bottom < bodyRect.top || r.top > bodyRect.bottom) continue;

        var cardCenterY = r.top + (r.height / 2);
        var diff = Math.abs(cardCenterY - targetCenterY);
        if (diff < minDiff) {
          minDiff = diff;
          bestCard = card;
          bestVid = vid;
          var pid = card.dataset.id;
          var item = (w.filtered || []).find(function (x) { return x.id === pid; });
          bestMeta = {
            id: pid,
            title: item ? item.title : 'CLIP',
            cat: w.catName,
            poster: item ? item.poster : '',
            card: card,
            w: w
          };
        }
      }

      if (bestVid && bestCard) {
        return { video: bestVid, card: bestCard, meta: bestMeta };
      }
      return null;
    }
  };
  window.PlaybackMaster = PlaybackMaster;

  function updateGlobalMuteUI() {
    qsa('.global-mute-btn').forEach(function (btn) {
      if (Super.isMuted) {
        btn.classList.remove('is-unmuted');
        btn.classList.add('is-muted');
        btn.innerHTML = '&#128263; UNMUTE ALL';
        btn.title = 'Unmute all open desktop video windows (M)';
        btn.setAttribute('aria-label', 'Unmute all open desktop videos');
      } else {
        btn.classList.add('is-unmuted');
        btn.classList.remove('is-muted');
        btn.innerHTML = '&#128266; MUTE ALL';
        btn.title = 'Mute all open desktop video windows (M)';
        btn.setAttribute('aria-label', 'Mute all open desktop videos');
      }
    });
  }

  function setGlobalMute(mute, silent) {
    Super.isMuted = !!mute;
    savePref('rawx_global_mute', Super.isMuted ? 'true' : 'false');
    updateGlobalMuteUI();
    var vids = allLiveVideos();
    vids.forEach(function (v) {
      v.muted = Super.isMuted;
      if (!Super.isMuted && !v.paused) {
        v.play().catch(function () {});
      }
    });
    if (!silent) {
      showToast(Super.isMuted ? 'ALL DESKTOP VIDEOS MUTED (SILENT)' : 'ALL DESKTOP VIDEOS UNMUTED (AUDIO ACTIVE)');
    }
  }

  function toggleGlobalMute() {
    setGlobalMute(!Super.isMuted);
  }

  // Rewrites a stream URL to request a specific resolution variant by
  // inserting the suffix immediately before the file extension. Leaves
  // non-video / auto untouched.
  function applyResolution(url, resKey) {
    if (!url) return url;
    var variant = RESOLUTIONS[resKey] || RESOLUTIONS.auto;
    if (!variant.suffix) return url;
    var m = url.match(/^(.*)(\.[a-z0-9]+)(\?.*)?$/i);
    if (!m) return url;
    return m[1] + variant.suffix + m[2] + (m[3] || '');
  }

  /* ---------------- Drive fetch layer (lazy + cached) ---------------- */
  var Drive = {
    categories: null,          // [{id,name}] | null (not fetched yet)
    categoriesPromise: null,
    tags: {},                  // catId -> [{id,name}] | undefined
    tagsPromise: {},           // catId -> Promise
    filePages: {}              // tagId -> { items: [], nextPageToken, done, loading, error }
  };

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
      (foldersOnly ? '&orderBy=name' : '&orderBy=name') +
      (pageToken ? '&pageToken=' + pageToken : '');
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('Drive API error ' + r.status);
      return r.json();
    });
  }

  function getCategories() {
    if (Drive.categories) return Promise.resolve(Drive.categories);
    if (Drive.categoriesPromise) return Drive.categoriesPromise;
    Drive.categoriesPromise = driveList(CONFIG.driveRootFolderId, true).then(function (data) {
      Drive.categories = (data.files || []).map(function (f) { return { id: f.id, name: f.name, title: titleFromName(f.name) }; });
      return Drive.categories;
    }).catch(function (err) {
      Drive.categories = [];
      throw err;
    });
    return Drive.categoriesPromise;
  }

  function getTags(catId) {
    if (Drive.tags[catId]) return Promise.resolve(Drive.tags[catId]);
    if (Drive.tagsPromise[catId]) return Drive.tagsPromise[catId];
    Drive.tagsPromise[catId] = driveList(catId, true).then(function (data) {
      var tags = (data.files || []).map(function (f) { return { id: f.id, name: f.name, title: titleFromName(f.name) }; });
      Drive.tags[catId] = tags;
      return tags;
    });
    return Drive.tagsPromise[catId];
  }

  // Given a tag folder's Drive id, finds the human-readable category+tag
  // names from the already-cached lists (no extra API call). Returns
  // null if it can't be resolved yet — callers should treat that as
  // "can't build an R2 path, use Drive".
  //
  // Handles both structures:
  //   category/tag/file.mp4        -> { category, tag }
  //   category/file.mp4  (flat)    -> { category, tag: null }
  // "Flat" categories are the ones with no Tag subfolders at all, where
  // renderTagPicker() sets w.tagId = w.catId (see that function for why).
  function findFolderNames(tagId) {
    if (!Drive.categories) return null;
    for (var c = 0; c < Drive.categories.length; c++) {
      var cat = Drive.categories[c];
      if (cat.id === tagId) return { category: cat.name, tag: null }; // flat category case
      var tags = Drive.tags[cat.id];
      if (!tags) continue;
      for (var t = 0; t < tags.length; t++) {
        if (tags[t].id === tagId) {
          return { category: cat.name, tag: tags[t].name };
        }
      }
    }
    return null;
  }

  // Mirrors the folder layout rclone preserved during migration:
  // {r2BaseUrl}/{category}/{tag}/{filename}, or {r2BaseUrl}/{category}/{filename}
  // for flat categories. Each segment URL-encoded on its own so slashes
  // inside names don't get misread as path breaks.
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
    var highSpeedStreamSrc = isVideo ? '/api/stream/' + file.id : null;
    var driveStreamSrc = isVideo ? DRIVE_FILES_URL + '/' + file.id + '?alt=media&key=' + CONFIG.driveApiKey : null;
    return {
      id: file.id,
      title: titleFromName(file.name),
      isVideo: isVideo,
      src: '/api/poster/' + file.id,
      poster: '/api/poster/' + file.id,
      full: '/api/poster/' + file.id,
      streamSrc: highSpeedStreamSrc || driveStreamSrc,
      fallbackSrc: driveStreamSrc
    };
  }

  // Fetches the NEXT page for a tag folder, appends to cache, returns the page items.
  function fetchNextPage(tagId) {
    var cache = Drive.filePages[tagId];
    if (!cache) cache = Drive.filePages[tagId] = { items: [], nextPageToken: undefined, done: false, loading: false };
    if (cache.loading || cache.done) return Promise.resolve(cache);
    cache.loading = true;
    var folderNames = findFolderNames(tagId); // cached lookup, no extra API call
    return driveList(tagId, false, cache.nextPageToken).then(function (data) {
      var items = (data.files || []).map(function (f) { return parseDriveFile(f, folderNames); });
      cache.items = cache.items.concat(items);
      cache.nextPageToken = data.nextPageToken || null;
      cache.done = !cache.nextPageToken;
      cache.loading = false;
      return cache;
    }).catch(function (err) {
      cache.loading = false;
      cache.error = err;
      throw err;
    });
  }

  /* ---------------- Pin persistence (global, shared across windows) ---------------- */
  var pinned = loadPinned();
  function loadPinned() {
    try { return JSON.parse(localStorage.getItem('rawx_pinned') || '[]'); } catch (e) { return []; }
  }
  function savePinned() {
    try { localStorage.setItem('rawx_pinned', JSON.stringify(pinned)); } catch (e) {}
  }
  function isPinned(item) { return pinned.some(function (p) { return p.id === item.id; }); }
  function togglePin(item, ctx) {
    var idx = pinned.findIndex(function (p) { return p.id === item.id; });
    if (idx === -1) pinned.push({ id: item.id, title: item.title, src: item.src, streamSrc: item.streamSrc, isVideo: item.isVideo, cat: ctx && ctx.catName, tag: ctx && ctx.tagName });
    else pinned.splice(idx, 1);
    savePinned();
    renderPinCounts();
  }
  function renderPinCounts() {
    var a = document.getElementById('stat-pinned'); if (a) a.textContent = pinned.length;
    var b = document.getElementById('taskbar-board-count'); if (b) b.textContent = pinned.length;
  }

  /* ================================================================
     WINDOW MANAGER
     Each window is a floating, draggable, resizable panel that shows
     either a tag-picker (category level) or an asset gallery (tag
     level). Multiple windows / multiple categories can be open at once.
  ================================================================ */
  var WM = {
    windows: {},      // id -> window state object
    zTop: 10,
    desktop: null
  };

  function spawnWindow(cat) {
    // Reuse an existing window for this category if one's already open.
    var existing = Object.keys(WM.windows).map(function (k) { return WM.windows[k]; })
      .find(function (w) { return w.catId === cat.id; });
    if (existing) { focusWindow(existing.id); restoreWindow(existing.id); return existing; }

    var id = uid();
    var count = Object.keys(WM.windows).length;
    var w = {
      id: id,
      catId: cat.id,
      catName: cat.title,
      tagId: null,
      tagName: null,
      x: 60 + (count % 6) * 34,
      y: 50 + (count % 6) * 28,
      width: 860,
      height: 560,
      minimized: false,
      maximized: false,
      search: '',
      sort: 'default',
      gridSize: loadGridSizePref(),
      showLabels: loadLabelsPref(),
      speed: loadSpeedPref(),
      visibleCount: 30,
      shuffleSeed: {}
    };
    WM.windows[id] = w;
    buildWindowDOM(w);
    focusWindow(id);
    renderWindowBody(w);
    renderTaskbar();
    updateHeroDim();
    return w;
  }

  function closeWindow(id) {
    var w = WM.windows[id];
    if (!w) return;
    if (PlaybackMaster.activeMeta && PlaybackMaster.activeMeta.w && PlaybackMaster.activeMeta.w.id === id) {
      PlaybackMaster.pauseExclusive();
      PlaybackMaster.hideHUD();
    }
    if (w.dom) {
      var body = qs('.win-body', w.dom);
      if (body && w._scrollHandler) body.removeEventListener('scroll', w._scrollHandler);
      w.dom.remove();
    }
    if (w.observer) w.observer.disconnect();
    if (w.scrollObserver) w.scrollObserver.disconnect();
    if (w.revealObserver) w.revealObserver.disconnect();
    if (w.memoryGuard) w.memoryGuard.disconnect();
    delete WM.windows[id];
    renderTaskbar();
    updateHeroDim();
  }

  function focusWindow(id) {
    var w = WM.windows[id];
    if (!w) return;
    WM.zTop += 1;
    w.dom.style.zIndex = WM.zTop;
    qsa('.win').forEach(function (d) { d.classList.remove('win-focused'); });
    w.dom.classList.add('win-focused');
    WM.activeId = id;
    renderTaskbar();
    updateHeroDim();
  }

  function minimizeWindow(id) {
    var w = WM.windows[id];
    if (!w) return;
    w.minimized = true;
    w.dom.classList.add('win-minimized');
    renderTaskbar();
  }
  function restoreWindow(id) {
    var w = WM.windows[id];
    if (!w) return;
    w.minimized = false;
    w.dom.classList.remove('win-minimized');
    focusWindow(id);
  }
  function toggleMaximize(id) {
    var w = WM.windows[id];
    if (!w) return;
    w.maximized = !w.maximized;
    w.dom.classList.toggle('win-maximized', w.maximized);
    focusWindow(id);
  }

  /* ---------------- Tidy Windows (Grid Layout Alignment) ---------------- */
  function tidyWindows() {
    var winList = Object.keys(WM.windows).map(function (k) { return WM.windows[k]; });
    if (!winList.length) {
      showToast('NO OPEN WINDOWS TO TIDY');
      return;
    }

    // Restore any minimized / maximized windows so they cleanly participate in the grid
    winList.forEach(function (w) {
      if (w.minimized) {
        w.minimized = false;
        w.dom.classList.remove('win-minimized');
      }
      if (w.maximized) {
        w.maximized = false;
        w.dom.classList.remove('win-maximized');
      }
    });

    var count = winList.length;
    var dWidth = (WM.desktop && WM.desktop.clientWidth) ? WM.desktop.clientWidth : window.innerWidth;
    var dHeight = (WM.desktop && WM.desktop.clientHeight) ? WM.desktop.clientHeight : (window.innerHeight - 100);

    var padX = 24;
    var padY = 24;
    var gap = 16;

    var cols, rows;
    if (count === 1) {
      cols = 1; rows = 1;
    } else if (count === 2) {
      if (dWidth >= 900) { cols = 2; rows = 1; }
      else { cols = 1; rows = 2; }
    } else if (count === 3) {
      if (dWidth >= 1400) { cols = 3; rows = 1; }
      else { cols = 2; rows = 2; }
    } else if (count === 4) {
      cols = 2; rows = 2;
    } else if (count <= 6) {
      if (dWidth >= 1200) { cols = 3; rows = 2; }
      else { cols = 2; rows = Math.ceil(count / 2); }
    } else if (count <= 9) {
      cols = 3; rows = 3;
    } else {
      cols = Math.ceil(Math.sqrt(count));
      rows = Math.ceil(count / cols);
    }

    var availW = dWidth - (padX * 2) - ((cols - 1) * gap);
    var availH = dHeight - (padY * 2) - ((rows - 1) * gap);

    var cellW = Math.floor(availW / cols);
    var cellH = Math.floor(availH / rows);

    // Maintain comfortable minimum usability dimensions
    cellW = Math.max(360, cellW);
    cellH = Math.max(280, cellH);

    winList.forEach(function (w, idx) {
      var c = idx % cols;
      var r = Math.floor(idx / cols);

      var x = padX + c * (cellW + gap);
      var y = padY + r * (cellH + gap);
      var width = cellW;
      var height = cellH;

      if (count === 1) {
        width = Math.min(Math.max(860, Math.floor(dWidth * 0.75)), dWidth - padX * 2);
        height = Math.min(Math.max(560, Math.floor(dHeight * 0.82)), dHeight - padY * 2);
        x = Math.max(padX, Math.floor((dWidth - width) / 2));
        y = Math.max(padY, Math.floor((dHeight - height) / 2));
      } else if (count === 3 && cols === 2 && idx === 2) {
        // Center the 3rd window across both columns
        x = padX + Math.floor((dWidth - padX * 2 - cellW) / 2);
      }

      w.x = x;
      w.y = y;
      w.width = width;
      w.height = height;

      w.dom.classList.add('win-tidying');
      w.dom.style.left = w.x + 'px';
      w.dom.style.top = w.y + 'px';
      w.dom.style.width = w.width + 'px';
      w.dom.style.height = w.height + 'px';
    });

    setTimeout(function () {
      winList.forEach(function (w) {
        w.dom.classList.remove('win-tidying');
      });
    }, 400);

    renderTaskbar();
    updateHeroDim();
    showToast('TIDIED ' + count + ' WINDOW' + (count === 1 ? '' : 'S') + ' IN GRID');
  }
  window.tidyWindows = tidyWindows;

  /* ================================================================
     MAGNETIC SNAPPING ENGINE
     Aligns dragged & resized desktop windows to each other (edges & gaps)
     and to the desktop 40px grid and boundaries in the LAB section.
  ================================================================ */
  var SnapEngine = {
    threshold: 20,       // Distance in pixels to trigger magnetic snap
    gap: 16,             // Standard inter-window gutter (matches tidyWindows)
    gridSize: 40,        // Desktop background grid pitch (matches desktop.css)
    pad: 24,             // Desktop boundary padding
    activeSnapX: null,
    activeSnapY: null,
    audioCtx: null,

    playSnapTick: function () {
      try {
        if (!SnapEngine.audioCtx) {
          var AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (AudioCtx) SnapEngine.audioCtx = new AudioCtx();
        }
        if (SnapEngine.audioCtx && SnapEngine.audioCtx.state === 'suspended') {
          SnapEngine.audioCtx.resume();
        }
        if (SnapEngine.audioCtx) {
          var now = SnapEngine.audioCtx.currentTime;
          var osc = SnapEngine.audioCtx.createOscillator();
          var gain = SnapEngine.audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(620, now);
          osc.frequency.exponentialRampToValueAtTime(320, now + 0.025);
          gain.gain.setValueAtTime(0.025, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
          osc.connect(gain);
          gain.connect(SnapEngine.audioCtx.destination);
          osc.start(now);
          osc.stop(now + 0.028);
        }
      } catch (e) {}
    },

    computeDragSnap: function (w, candX, candY, bypassSnap) {
      if (!Super.snapEnabled || bypassSnap) {
        SnapEngine.hideGuides(w);
        return { x: candX, y: candY, snappedX: false, snappedY: false };
      }

      var threshold = SnapEngine.threshold;
      var gap = SnapEngine.gap;
      var pad = SnapEngine.pad;
      var gridSize = SnapEngine.gridSize;

      var dWidth = (WM.desktop && WM.desktop.clientWidth) ? WM.desktop.clientWidth : window.innerWidth;
      var dHeight = (WM.desktop && WM.desktop.clientHeight) ? WM.desktop.clientHeight : (window.innerHeight - 100);

      var bestX = { diff: threshold + 1, pos: candX, guide: candX, label: '', isWindow: false };
      var bestY = { diff: threshold + 1, pos: candY, guide: candY, label: '', isWindow: false };

      var winW = w.width;
      var winH = w.height;

      // 1. Sibling windows snapping (highest priority)
      var siblings = Object.keys(WM.windows).map(function (k) { return WM.windows[k]; })
        .filter(function (s) { return s.id !== w.id && !s.minimized && !s.maximized && s.dom && s.dom.parentNode; });

      function checkCandidateX(targetPos, guidePos, label) {
        var diff = Math.abs(candX - targetPos);
        if (diff <= threshold && diff < bestX.diff) {
          bestX = { diff: diff, pos: targetPos, guide: guidePos, label: label, isWindow: true };
        }
      }

      function checkCandidateY(targetPos, guidePos, label) {
        var diff = Math.abs(candY - targetPos);
        if (diff <= threshold && diff < bestY.diff) {
          bestY = { diff: diff, pos: targetPos, guide: guidePos, label: label, isWindow: true };
        }
      }

      siblings.forEach(function (sib) {
        var sL = sib.x;
        var sR = sib.x + sib.width;
        var sT = sib.y;
        var sB = sib.y + sib.height;
        var sCenterX = sib.x + sib.width / 2;
        var sCenterY = sib.y + sib.height / 2;

        // Check vertical proximity for horizontal snaps
        var vDist = Math.max(0, sT - (candY + winH), candY - sB);
        if (vDist <= 320) {
          // Dock right of sibling with 16px gap
          checkCandidateX(sR + gap, sR + gap, 'SNAP ⊞ 16px GAP');
          // Dock right of sibling flush
          checkCandidateX(sR, sR, 'SNAP ⊞ FLUSH');
          // Dock left of sibling with 16px gap
          checkCandidateX(sL - winW - gap, sL - gap, 'SNAP ⊞ 16px GAP');
          // Dock left of sibling flush
          checkCandidateX(sL - winW, sL, 'SNAP ⊞ FLUSH');
          // Align left edges
          checkCandidateX(sL, sL, 'ALIGN ⊞ LEFT');
          // Align right edges
          checkCandidateX(sR - winW, sR, 'ALIGN ⊞ RIGHT');
          // Align centers
          checkCandidateX(sCenterX - winW / 2, sCenterX, 'ALIGN ⊞ CENTER');
        }

        // Check horizontal proximity for vertical snaps
        var hDist = Math.max(0, sL - (candX + winW), candX - sR);
        if (hDist <= 320) {
          // Dock below sibling with 16px gap
          checkCandidateY(sB + gap, sB + gap, 'SNAP ⊞ 16px GAP');
          // Dock below sibling flush
          checkCandidateY(sB, sB, 'SNAP ⊞ FLUSH');
          // Dock above sibling with 16px gap
          checkCandidateY(sT - winH - gap, sT - gap, 'SNAP ⊞ 16px GAP');
          // Dock above sibling flush
          checkCandidateY(sT - winH, sT, 'SNAP ⊞ FLUSH');
          // Align top edges
          checkCandidateY(sT, sT, 'ALIGN ⊞ TOP');
          // Align bottom edges
          checkCandidateY(sB - winH, sB, 'ALIGN ⊞ BOTTOM');
          // Align centers
          checkCandidateY(sCenterY - winH / 2, sCenterY, 'ALIGN ⊞ CENTER');
        }
      });

      // 2. Desktop Boundary snapping
      if (!bestX.isWindow) {
        var diffPadL = Math.abs(candX - pad);
        if (diffPadL <= threshold && diffPadL < bestX.diff) {
          bestX = { diff: diffPadL, pos: pad, guide: pad, label: 'BOUND ⊞ LEFT', isWindow: false };
        }
        var rightBoundPos = dWidth - pad - winW;
        var diffPadR = Math.abs(candX - rightBoundPos);
        if (diffPadR <= threshold && diffPadR < bestX.diff) {
          bestX = { diff: diffPadR, pos: rightBoundPos, guide: dWidth - pad, label: 'BOUND ⊞ RIGHT', isWindow: false };
        }
      }

      if (!bestY.isWindow) {
        var diffPadT = Math.abs(candY - pad);
        if (diffPadT <= threshold && diffPadT < bestY.diff) {
          bestY = { diff: diffPadT, pos: pad, guide: pad, label: 'BOUND ⊞ TOP', isWindow: false };
        }
        var bottomBoundPos = dHeight - pad - winH;
        var diffPadB = Math.abs(candY - bottomBoundPos);
        if (diffPadB <= threshold && diffPadB < bestY.diff) {
          bestY = { diff: diffPadB, pos: bottomBoundPos, guide: dHeight - pad, label: 'BOUND ⊞ BOTTOM', isWindow: false };
        }
      }

      // 3. Desktop 40px Grid Snapping
      if (!bestX.isWindow && bestX.diff > threshold) {
        var nearestGridX = Math.round(candX / gridSize) * gridSize;
        var diffGridX = Math.abs(candX - nearestGridX);
        if (diffGridX <= threshold * 0.75) {
          bestX = { diff: diffGridX, pos: nearestGridX, guide: nearestGridX, label: 'GRID ⊞ ' + nearestGridX + 'px', isWindow: false };
        }
      }

      if (!bestY.isWindow && bestY.diff > threshold) {
        var nearestGridY = Math.round(candY / gridSize) * gridSize;
        var diffGridY = Math.abs(candY - nearestGridY);
        if (diffGridY <= threshold * 0.75) {
          bestY = { diff: diffGridY, pos: nearestGridY, guide: nearestGridY, label: 'GRID ⊞ ' + nearestGridY + 'px', isWindow: false };
        }
      }

      var snappedX = bestX.diff <= threshold;
      var snappedY = bestY.diff <= threshold;
      var finalX = snappedX ? Math.max(0, bestX.pos) : candX;
      var finalY = snappedY ? Math.max(0, bestY.pos) : candY;

      SnapEngine.updateGuides(snappedX ? bestX : null, snappedY ? bestY : null, w, finalX, finalY);

      if ((snappedX && SnapEngine.activeSnapX !== bestX.pos) ||
          (snappedY && SnapEngine.activeSnapY !== bestY.pos)) {
        SnapEngine.playSnapTick();
      }
      SnapEngine.activeSnapX = snappedX ? bestX.pos : null;
      SnapEngine.activeSnapY = snappedY ? bestY.pos : null;

      return { x: finalX, y: finalY, snappedX: snappedX, snappedY: snappedY };
    },

    computeResizeSnap: function (w, candW, candH, bypassSnap) {
      if (!Super.snapEnabled || bypassSnap) {
        SnapEngine.hideGuides(w);
        return { width: candW, height: candH, snappedW: false, snappedH: false };
      }

      var threshold = SnapEngine.threshold;
      var gap = SnapEngine.gap;
      var pad = SnapEngine.pad;
      var gridSize = SnapEngine.gridSize;

      var dWidth = (WM.desktop && WM.desktop.clientWidth) ? WM.desktop.clientWidth : window.innerWidth;
      var dHeight = (WM.desktop && WM.desktop.clientHeight) ? WM.desktop.clientHeight : (window.innerHeight - 100);

      var bestW = { diff: threshold + 1, size: candW, guide: w.x + candW, label: '', isWindow: false };
      var bestH = { diff: threshold + 1, size: candH, guide: w.y + candH, label: '', isWindow: false };

      var siblings = Object.keys(WM.windows).map(function (k) { return WM.windows[k]; })
        .filter(function (s) { return s.id !== w.id && !s.minimized && !s.maximized && s.dom && s.dom.parentNode; });

      siblings.forEach(function (sib) {
        var sL = sib.x;
        var sR = sib.x + sib.width;
        var sT = sib.y;
        var sB = sib.y + sib.height;

        // Match sibling right edge
        var targetW1 = sR - w.x;
        if (targetW1 >= 360) {
          var diff1 = Math.abs(candW - targetW1);
          if (diff1 <= threshold && diff1 < bestW.diff) {
            bestW = { diff: diff1, size: targetW1, guide: sR, label: 'MATCH ⊞ RIGHT EDGE', isWindow: true };
          }
        }
        // Match sibling left edge - gap
        var targetW2 = (sL - gap) - w.x;
        if (targetW2 >= 360) {
          var diff2 = Math.abs(candW - targetW2);
          if (diff2 <= threshold && diff2 < bestW.diff) {
            bestW = { diff: diff2, size: targetW2, guide: sL - gap, label: 'DOCK ⊞ 16px GAP', isWindow: true };
          }
        }
        // Match sibling width exactly
        var diffW = Math.abs(candW - sib.width);
        if (diffW <= threshold && diffW < bestW.diff && sib.width >= 360) {
          bestW = { diff: diffW, size: sib.width, guide: w.x + sib.width, label: 'MATCH ⊞ WIDTH', isWindow: true };
        }

        // Match sibling bottom edge
        var targetH1 = sB - w.y;
        if (targetH1 >= 280) {
          var diffH1 = Math.abs(candH - targetH1);
          if (diffH1 <= threshold && diffH1 < bestH.diff) {
            bestH = { diff: diffH1, size: targetH1, guide: sB, label: 'MATCH ⊞ BOTTOM EDGE', isWindow: true };
          }
        }
        // Match sibling top edge - gap
        var targetH2 = (sT - gap) - w.y;
        if (targetH2 >= 280) {
          var diffH2 = Math.abs(candH - targetH2);
          if (diffH2 <= threshold && diffH2 < bestH.diff) {
            bestH = { diff: diffH2, size: targetH2, guide: sT - gap, label: 'DOCK ⊞ 16px GAP', isWindow: true };
          }
        }
        // Match sibling height exactly
        var diffH = Math.abs(candH - sib.height);
        if (diffH <= threshold && diffH < bestH.diff && sib.height >= 280) {
          bestH = { diff: diffH, size: sib.height, guide: w.y + sib.height, label: 'MATCH ⊞ HEIGHT', isWindow: true };
        }
      });

      // Desktop bounds
      if (!bestW.isWindow) {
        var boundW = dWidth - pad - w.x;
        var diffBoundW = Math.abs(candW - boundW);
        if (diffBoundW <= threshold && diffBoundW < bestW.diff && boundW >= 360) {
          bestW = { diff: diffBoundW, size: boundW, guide: dWidth - pad, label: 'BOUND ⊞ RIGHT', isWindow: false };
        }
      }
      if (!bestH.isWindow) {
        var boundH = dHeight - pad - w.y;
        var diffBoundH = Math.abs(candH - boundH);
        if (diffBoundH <= threshold && diffBoundH < bestH.diff && boundH >= 280) {
          bestH = { diff: diffBoundH, size: boundH, guide: dHeight - pad, label: 'BOUND ⊞ BOTTOM', isWindow: false };
        }
      }

      // 40px Grid snapping
      if (!bestW.isWindow && bestW.diff > threshold) {
        var gridW = Math.round(candW / gridSize) * gridSize;
        var diffGridW = Math.abs(candW - gridW);
        if (diffGridW <= threshold * 0.75 && gridW >= 360) {
          bestW = { diff: diffGridW, size: gridW, guide: w.x + gridW, label: 'GRID ⊞ ' + gridW + 'px', isWindow: false };
        }
      }
      if (!bestH.isWindow && bestH.diff > threshold) {
        var gridH = Math.round(candH / gridSize) * gridSize;
        var diffGridH = Math.abs(candH - gridH);
        if (diffGridH <= threshold * 0.75 && gridH >= 280) {
          bestH = { diff: diffGridH, size: gridH, guide: w.y + gridH, label: 'GRID ⊞ ' + gridH + 'px', isWindow: false };
        }
      }

      var snappedW = bestW.diff <= threshold;
      var snappedH = bestH.diff <= threshold;
      var finalW = snappedW ? Math.max(360, bestW.size) : candW;
      var finalH = snappedH ? Math.max(280, bestH.size) : candH;

      SnapEngine.updateGuides(snappedW ? bestW : null, snappedH ? bestH : null, w, w.x, w.y);

      if ((snappedW && SnapEngine.activeSnapX !== bestW.size) ||
          (snappedH && SnapEngine.activeSnapY !== bestH.size)) {
        SnapEngine.playSnapTick();
      }
      SnapEngine.activeSnapX = snappedW ? bestW.size : null;
      SnapEngine.activeSnapY = snappedH ? bestH.size : null;

      return { width: finalW, height: finalH, snappedW: snappedW, snappedH: snappedH };
    },

    updateGuides: function (guideX, guideY, winObj, curX, curY) {
      var gV = document.getElementById('snap-guide-v');
      var gH = document.getElementById('snap-guide-h');
      if (!gV || !gH) return;

      if (guideX) {
        gV.style.display = 'block';
        gV.style.left = guideX.guide + 'px';
        var badgeV = qs('.snap-guide-badge', gV);
        if (badgeV) {
          badgeV.textContent = guideX.label;
          badgeV.style.top = Math.max(10, Math.min(curY + 20, (WM.desktop ? WM.desktop.clientHeight - 40 : 500))) + 'px';
        }
      } else {
        gV.style.display = 'none';
      }

      if (guideY) {
        gH.style.display = 'block';
        gH.style.top = guideY.guide + 'px';
        var badgeH = qs('.snap-guide-badge', gH);
        if (badgeH) {
          badgeH.textContent = guideY.label;
          badgeH.style.left = Math.max(10, Math.min(curX + 20, (WM.desktop ? WM.desktop.clientWidth - 150 : 500))) + 'px';
        }
      } else {
        gH.style.display = 'none';
      }

      if (winObj && winObj.dom) {
        if (guideX || guideY) {
          winObj.dom.classList.add('win-snapped');
        } else {
          winObj.dom.classList.remove('win-snapped');
        }
      }
    },

    hideGuides: function (winObj) {
      var gV = document.getElementById('snap-guide-v');
      var gH = document.getElementById('snap-guide-h');
      if (gV) gV.style.display = 'none';
      if (gH) gH.style.display = 'none';
      SnapEngine.activeSnapX = null;
      SnapEngine.activeSnapY = null;
      if (winObj && winObj.dom) {
        winObj.dom.classList.remove('win-snapped');
      } else {
        qsa('.win-snapped').forEach(function (w) { w.classList.remove('win-snapped'); });
      }
    },

    toggleSnap: function () {
      Super.snapEnabled = !Super.snapEnabled;
      savePref('rawx_snap_enabled', Super.snapEnabled ? 'true' : 'false');
      SnapEngine.updateUI();
      showToast(Super.snapEnabled ? 'MAGNETIC SNAP: ON (GRID & SIBLINGS)' : 'MAGNETIC SNAP: OFF (FREEFORM)');
    },

    updateUI: function () {
      qsa('.snap-toggle-btn').forEach(function (btn) {
        btn.classList.toggle('active', !!Super.snapEnabled);
        btn.innerHTML = Super.snapEnabled ? '🧲 SNAP: ON' : '🧲 SNAP: OFF';
        btn.title = Super.snapEnabled
          ? 'Magnetic snapping active: windows align to grid & siblings (Alt+S)'
          : 'Magnetic snapping off: freeform movement (Alt+S)';
      });
    }
  };
  window.SnapEngine = SnapEngine;

  /* ---------------- Window DOM shell ---------------- */
  function buildWindowDOM(w) {
    var d = el('div', 'win');
    d.style.left = w.x + 'px';
    d.style.top = w.y + 'px';
    d.style.width = w.width + 'px';
    d.style.height = w.height + 'px';
    d.dataset.id = w.id;

    d.innerHTML =
      '<div class="win-titlebar">' +
        '<span class="win-crumb"></span>' +
        '<div class="win-controls">' +
          '<button class="win-btn win-min" title="Minimize">\u2013</button>' +
          '<button class="win-btn win-max" title="Maximize">\u25a1</button>' +
          '<button class="win-btn win-close" title="Close">\u2715</button>' +
        '</div>' +
      '</div>' +
      '<div class="win-body"></div>' +
      '<div class="win-resize"></div>';

    WM.desktop.appendChild(d);
    w.dom = d;

    d.addEventListener('mousedown', function () { focusWindow(w.id); });
    qs('.win-close', d).addEventListener('click', function (e) { e.stopPropagation(); closeWindow(w.id); });
    qs('.win-min', d).addEventListener('click', function (e) { e.stopPropagation(); minimizeWindow(w.id); });
    qs('.win-max', d).addEventListener('click', function (e) { e.stopPropagation(); toggleMaximize(w.id); });

    makeDraggable(d, qs('.win-titlebar', d), w);
    makeResizable(d, qs('.win-resize', d), w);
  }

  function makeDraggable(d, handle, w) {
    var dragging = false, sx, sy, ox, oy;
    handle.addEventListener('mousedown', function (e) {
      if (w.maximized || e.target.closest('.win-controls')) return;
      dragging = true; sx = e.clientX; sy = e.clientY; ox = w.x; oy = w.y;
      focusWindow(w.id);
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var rawX = Math.max(0, ox + (e.clientX - sx));
      var rawY = Math.max(0, oy + (e.clientY - sy));
      var bypassSnap = e.shiftKey; // Hold Shift for free micro-placement without snap
      var snapped = SnapEngine.computeDragSnap(w, rawX, rawY, bypassSnap);
      w.x = snapped.x;
      w.y = snapped.y;
      d.style.left = w.x + 'px';
      d.style.top = w.y + 'px';
    });
    window.addEventListener('mouseup', function () {
      if (dragging) {
        dragging = false;
        SnapEngine.hideGuides(w);
      }
    });
    // touch
    handle.addEventListener('touchstart', function (e) {
      if (w.maximized) return;
      var t = e.touches[0];
      dragging = true; sx = t.clientX; sy = t.clientY; ox = w.x; oy = w.y;
      focusWindow(w.id);
    }, { passive: true });
    window.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      var t = e.touches[0];
      var rawX = Math.max(0, ox + (t.clientX - sx));
      var rawY = Math.max(0, oy + (t.clientY - sy));
      var snapped = SnapEngine.computeDragSnap(w, rawX, rawY, false);
      w.x = snapped.x;
      w.y = snapped.y;
      d.style.left = w.x + 'px';
      d.style.top = w.y + 'px';
    }, { passive: true });
    window.addEventListener('touchend', function () {
      if (dragging) {
        dragging = false;
        SnapEngine.hideGuides(w);
      }
    });
  }

  function makeResizable(d, handle, w) {
    var resizing = false, sx, sy, ow, oh;
    handle.addEventListener('mousedown', function (e) {
      if (w.maximized) return;
      resizing = true; sx = e.clientX; sy = e.clientY; ow = w.width; oh = w.height;
      focusWindow(w.id);
      e.preventDefault(); e.stopPropagation();
    });
    window.addEventListener('mousemove', function (e) {
      if (!resizing) return;
      var rawW = Math.max(360, ow + (e.clientX - sx));
      var rawH = Math.max(280, oh + (e.clientY - sy));
      var bypassSnap = e.shiftKey;
      var snapped = SnapEngine.computeResizeSnap(w, rawW, rawH, bypassSnap);
      w.width = snapped.width;
      w.height = snapped.height;
      d.style.width = w.width + 'px';
      d.style.height = w.height + 'px';
    });
    window.addEventListener('mouseup', function () {
      if (resizing) {
        resizing = false;
        SnapEngine.hideGuides(w);
      }
    });
  }

  /* ---------------- Window content: crumb + body ---------------- */
  function updateCrumb(w) {
    var crumb = qs('.win-crumb', w.dom);
    var parts = ['<span class="crumb-cat">' + w.catName + '</span>'];
    if (w.tagName) parts.push('<span class="crumb-sep">/</span><span class="crumb-tag">' + w.tagName + '</span>');
    crumb.innerHTML = parts.join('');
  }

  function renderWindowBody(w) {
    updateCrumb(w);
    var body = qs('.win-body', w.dom);
    if (w.observer) { w.observer.disconnect(); w.observer = null; }
    if (w.scrollObserver) { w.scrollObserver.disconnect(); w.scrollObserver = null; }
    if (w.revealObserver) { w.revealObserver.disconnect(); w.revealObserver = null; }
    if (w.memoryGuard) { w.memoryGuard.disconnect(); w.memoryGuard = null; }

    if (!w.tagId) {
      renderTagPicker(w, body);
    } else {
      renderGallery(w, body);
    }
  }

  function renderTagPicker(w, body) {
    body.innerHTML = '<div class="tagpicker-loading">READING TAGS\u2026</div>';
    getTags(w.catId).then(function (tags) {
      if (!WM.windows[w.id]) return; // window closed meanwhile
      if (!tags.length) {
        // No Tag subfolders inside this Category — treat the Category itself
        // as a flat, single-tag gallery so "just dump files here" folders
        // (e.g. a raw video-export folder) work without extra nesting.
        w.tagId = w.catId;
        w.tagName = null;
        w.flatCategory = true;
        w.visibleCount = 30;
        renderWindowBody(w);
        return;
      }
      var wrap = el('div', 'tagpicker');
      wrap.innerHTML = '<div class="tagpicker-hint">SELECT A TAG TO OPEN ITS GALLERY</div>';
      var grid = el('div', 'tagpicker-grid');
      tags.forEach(function (t) {
        var card = el('div', 'tag-card', '<span class="tag-card-name">' + t.title + '</span><span class="tag-card-go">\u2192</span>');
        card.addEventListener('click', function () {
          w.tagId = t.id;
          w.tagName = t.title;
          w.visibleCount = 30;
          renderWindowBody(w);
        });
        grid.appendChild(card);
      });
      wrap.appendChild(grid);
      body.innerHTML = '';
      body.appendChild(wrap);
    }).catch(function () {
      body.innerHTML = '<div class="tagpicker-empty">FAILED TO READ TAGS \u2014 CHECK FOLDER SHARING / API KEY</div>';
    });
  }

  function renderGallery(w, body) {
    body.innerHTML =
      '<div class="win-toolbar">' +
        '<button class="win-back"' + (w.flatCategory ? ' hidden' : '') + ' title="Back to tags">\u2190 TAGS</button>' +
        '<input type="search" class="win-search" placeholder="SEARCH" autocomplete="off" value="' + escapeAttr(w.search) + '">' +
        '<select class="win-sort">' +
          '<option value="default">SORT: DEFAULT</option>' +
          '<option value="az">SORT: A\u2013Z</option>' +
          '<option value="za">SORT: Z\u2013A</option>' +
          '<option value="shuffle">SORT: SHUFFLE</option>' +
        '</select>' +
        '<div class="win-size-toggle">' +
          '<button data-size="s">S</button><button data-size="m">M</button><button data-size="l">L</button>' +
        '</div>' +
        '<button class="win-chip-btn win-labels-btn' + (w.showLabels ? ' active' : '') + '" title="Show names on thumbnails">ⓘ INFO</button>' +
        '<button class="win-chip-btn win-speed-btn" title="Cycle preview playback speed">\u26a1 ' + w.speed + '\u00d7</button>' +
      '</div>' +
      '<div class="win-tagchips"></div>' +
      '<div class="win-count">\u2014</div>' +
      '<div class="win-grid grid-size-' + w.gridSize + (w.showLabels ? ' labels-on' : '') + '"></div>' +
      '<div class="win-loadmore" hidden>LOAD MORE</div>' +
      '<div class="win-end" hidden>END OF GALLERY</div>';

    qs('.win-back', body).addEventListener('click', function () {
      w.tagId = null; w.tagName = null;
      renderWindowBody(w);
    });
    qs('.win-search', body).addEventListener('input', function (e) {
      w.search = e.target.value; w.visibleCount = 30; paintGrid(w);
    });
    qs('.win-sort', body).value = w.sort;
    qs('.win-sort', body).addEventListener('change', function (e) {
      w.sort = e.target.value;
      if (w.sort === 'shuffle') reshuffle(w);
      paintGrid(w);
    });
    qsa('.win-size-toggle button', body).forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.size === w.gridSize);
      btn.addEventListener('click', function () {
        w.gridSize = btn.dataset.size;
        saveGridSizePref(w.gridSize);
        qs('.win-grid', body).className = 'win-grid grid-size-' + w.gridSize;
        qsa('.win-size-toggle button', body).forEach(function (b) { b.classList.toggle('active', b === btn); });
      });
    });
    qs('.win-loadmore', body).addEventListener('click', function () {
      loadMoreForWindow(w);
    });

    qs('.win-labels-btn', body).addEventListener('click', function () {
      w.showLabels = !w.showLabels;
      saveLabelsPref(w.showLabels);
      this.classList.toggle('active', w.showLabels);
      qs('.win-grid', body).classList.toggle('labels-on', w.showLabels);
    });
    qs('.win-speed-btn', body).addEventListener('click', function () {
      w.speed = nextSpeed(w.speed);
      saveSpeedPref(w.speed);
      this.textContent = '\u26a1 ' + w.speed + '\u00d7';
      qsa('.win-grid video', body).forEach(function (v) { v.playbackRate = w.speed; });
    });

    ensurePageThenPaint(w);
  }

  function reshuffle(w) {
    var cache = Drive.filePages[w.tagId];
    if (!cache) return;
    w.shuffleSeed = {};
    cache.items.forEach(function (it) { w.shuffleSeed[it.id] = Math.random(); });
  }

  function ensurePageThenPaint(w) {
    var body = qs('.win-body', w.dom);
    var cache = Drive.filePages[w.tagId];
    if (!cache || (!cache.items.length && !cache.done)) {
      var countEl = qs('.win-count', body);
      if (countEl) countEl.textContent = 'READING FILES\u2026';
      fetchNextPage(w.tagId).then(function () { if (WM.windows[w.id]) paintGrid(w); })
        .catch(function () { if (countEl) countEl.textContent = 'FAILED TO LOAD FILES'; });
    } else {
      paintGrid(w);
    }
  }

  function computeFiltered(w) {
    var cache = Drive.filePages[w.tagId];
    var list = cache ? cache.items.slice() : [];
    var q = w.search.trim().toLowerCase();
    if (q) list = list.filter(function (p) { return p.title.toLowerCase().indexOf(q) !== -1; });
    if (w.sort === 'az') list.sort(function (a, b) { return a.title.localeCompare(b.title); });
    else if (w.sort === 'za') list.sort(function (a, b) { return b.title.localeCompare(a.title); });
    else if (w.sort === 'shuffle') list.sort(function (a, b) { return (w.shuffleSeed[a.id] || 0) - (w.shuffleSeed[b.id] || 0); });
    return list;
  }

  // Splits a filename on common delimiters (_, -, .) into normalized
  // lowercase tokens for 1-click filter chips. Drops pure numbers and
  // 1-character noise so chips stay meaningful.
  function parseFilenameTags(name) {
    return name.split(/[\s_\-.]+/).map(function (t) { return t.toLowerCase(); })
      .filter(function (t) { return t.length > 1 && !/^\d+$/.test(t); });
  }
  function renderTagChips(w, body, items) {
    var host = qs('.win-tagchips', body);
    if (!host) return;
    var counts = {};
    items.forEach(function (it) { parseFilenameTags(it.title).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 16);
    host.innerHTML = '';
    if (!top.length) return;
    top.forEach(function (tag) {
      var chip = el('button', 'tagchip' + (w.search.trim().toLowerCase() === tag ? ' active' : ''), escapeHtml(tag));
      chip.addEventListener('click', function () {
        var isActive = chip.classList.contains('active');
        w.search = isActive ? '' : tag;
        w.visibleCount = 30;
        qs('.win-search', body).value = w.search;
        paintGrid(w);
      });
      host.appendChild(chip);
    });
  }

  function paintGrid(w) {
    var body = qs('.win-body', w.dom);
    if (!body) return;
    var grid = qs('.win-grid', body);
    var countEl = qs('.win-count', body);
    var loadMoreBtn = qs('.win-loadmore', body);
    var endEl = qs('.win-end', body);
    var cache = Drive.filePages[w.tagId] || { items: [], done: false };

    renderTagChips(w, body, cache.items);
    w.filtered = computeFiltered(w);
    countEl.textContent = w.filtered.length + ' asset' + (w.filtered.length === 1 ? '' : 's') +
      (cache.done ? '' : ' (more loading as you scroll)');

    grid.innerHTML = '';
    if (!w.filtered.length) {
      grid.innerHTML = '<div class="win-empty">NO MATCHES' + (cache.done ? '' : ' YET \u2014 KEEP SCROLLING, MORE ARE LOADING') + '</div>';
      loadMoreBtn.hidden = true; endEl.hidden = true;
      return;
    }

    var visible = w.filtered.slice(0, w.visibleCount);
    var frag = document.createDocumentFragment();
    visible.forEach(function (p) { frag.appendChild(buildCard(p, w)); });
    grid.appendChild(frag);

    var canShowMoreLocally = w.visibleCount < w.filtered.length;
    var canFetchMoreRemote = !cache.done;
    loadMoreBtn.hidden = !(canShowMoreLocally || canFetchMoreRemote);
    endEl.hidden = !(cache.done && w.visibleCount >= w.filtered.length && w.filtered.length > 0);

    setupWindowScrollObservers(w);
  }

  function loadMoreForWindow(w) {
    var cache = Drive.filePages[w.tagId];
    if (w.visibleCount < w.filtered.length) {
      w.visibleCount += 30;
      paintGrid(w);
      return;
    }
    if (cache && !cache.done && !cache.loading) {
      fetchNextPage(w.tagId).then(function () {
        w.visibleCount += 30;
        if (WM.windows[w.id]) paintGrid(w);
      });
    }
  }

  function buildCard(p, w) {
    var card = el('div', 'asset-card');
    card.dataset.id = p.id;
    var media;
    if (p.isVideo) {
      media = '<video class="asset-card-video" src="' + applyResolution(p.streamSrc, Super.resolution) + '" data-base-src="' + escapeAttr(p.streamSrc || '') + '" data-fallback-src="' + escapeAttr(p.fallbackSrc || '') + '" poster="' + p.poster + '" muted loop playsinline preload="none"></video>' +
        '<div class="asset-card-top-badges">' +
          '<span class="asset-card-eq-badge" title="Now Playing ⚡">' +
            '<span class="mini-eq-bar"></span><span class="mini-eq-bar"></span><span class="mini-eq-bar"></span>' +
          '</span>' +
          '<button class="asset-card-speed-chip" title="Instant Playback Rate">1×</button>' +
        '</div>' +
        '<div class="asset-card-center-action">' +
          '<button class="asset-card-play-pill" title="Play Exclusively (halts all other streams for max speed)">' +
            '<span class="play-pill-icon">▶</span>' +
            '<span class="play-pill-text">PLAY</span>' +
          '</button>' +
        '</div>' +
        '<div class="yt-buffer-spinner" title="Buffering..."></div>' +
        '<div class="yt-bezel-pop"><span class="yt-bezel-icon">▶</span></div>' +
        '<div class="asset-card-hover-scrub-tooltip">0:00</div>' +
        '<div class="asset-card-bottom-bar">' +
          '<button class="asset-card-expand-btn" title="Open Full Theater Lightbox (Double-click or F)">⤢</button>' +
          '<span class="asset-card-duration" hidden>0:00</span>' +
        '</div>' +
        '<div class="asset-card-progress" title="Seek video timeline">' +
          '<div class="asset-card-progress-track">' +
            '<div class="asset-card-progress-buffer"></div>' +
            '<div class="asset-card-progress-hover"></div>' +
            '<div class="asset-card-progress-played"></div>' +
            '<div class="asset-card-progress-thumb"></div>' +
          '</div>' +
        '</div>';
    } else {
      media = '<img src="' + p.src + '" alt="' + escapeAttr(p.title) + '" loading="lazy">';
    }
    card.innerHTML = media +
      '<div class="asset-card-label"><span>' + escapeHtml(p.title) + '</span><span class="asset-card-kind">' + escapeHtml(w.tagName || w.catName || '') + '</span></div>' +
      '<button class="asset-card-pin' + (isPinned(p) ? ' pinned' : '') + '" title="Pin">' + (isPinned(p) ? '\u2713' : '+') + '</button>';

    if (p.isVideo) {
      var v = qs('video', card);
      var durEl = qs('.asset-card-duration', card);
      var progEl = qs('.asset-card-progress', card);
      var progBuffer = qs('.asset-card-progress-buffer', card);
      var progHover = qs('.asset-card-progress-hover', card);
      var progPlayed = qs('.asset-card-progress-played', card);
      var progThumb = qs('.asset-card-progress-thumb', card);
      var scrubTooltip = qs('.asset-card-hover-scrub-tooltip', card);
      var speedChip = qs('.asset-card-speed-chip', card);
      var expandBtn = qs('.asset-card-expand-btn', card);
      var playPill = qs('.asset-card-play-pill', card);

      v.muted = Super.isMuted;
      v.playbackRate = PlaybackMaster.currentSpeed || w.speed || 1;
      if (speedChip) speedChip.textContent = (PlaybackMaster.currentSpeed || 1) + '×';

      bindVideoFallback(v); // R2 miss -> retry once from Drive

      function updateTimeStatus() {
        if (!isFinite(v.duration) || v.duration <= 0) return;
        durEl.hidden = false;
        if (!v.paused || card.matches(':hover') || card.classList.contains('is-scrubbing')) {
          durEl.textContent = formatDuration(v.currentTime) + ' / ' + formatDuration(v.duration);
        } else {
          durEl.textContent = formatDuration(v.duration);
        }
      }

      function updateBufferProgress() {
        if (!v.duration || !v.buffered || v.buffered.length === 0 || !progBuffer) return;
        var bufPct = 0;
        for (var i = v.buffered.length - 1; i >= 0; i--) {
          if (v.buffered.start(i) <= v.currentTime && v.currentTime <= v.buffered.end(i)) {
            bufPct = (v.buffered.end(i) / v.duration) * 100;
            break;
          }
        }
        if (!bufPct && v.buffered.length > 0) {
          bufPct = (v.buffered.end(v.buffered.length - 1) / v.duration) * 100;
        }
        progBuffer.style.width = Math.min(Math.max(bufPct, 0), 100) + '%';
      }

      v.addEventListener('loadedmetadata', function () {
        if (isFinite(v.duration)) {
          durEl.hidden = false;
          updateTimeStatus();
          updateBufferProgress();
        }
      });

      v.addEventListener('progress', updateBufferProgress);

      v.addEventListener('timeupdate', function () {
        if (v.duration) {
          var pct = (v.currentTime / v.duration) * 100;
          if (progPlayed) progPlayed.style.width = pct + '%';
          if (progThumb) progThumb.style.left = pct + '%';
          updateTimeStatus();
          updateBufferProgress();
        }
        if (PlaybackMaster.activeVideo === v && !PlaybackMaster.isSeeking) {
          PlaybackMaster.updateHUDProgress();
        }
      });

      // YouTube Buffering Indicators
      v.addEventListener('waiting', function () {
        card.classList.add('is-buffering');
      });
      v.addEventListener('playing', function () {
        card.classList.remove('is-buffering');
        updateTimeStatus();
      });
      v.addEventListener('canplay', function () {
        card.classList.remove('is-buffering');
      });
      v.addEventListener('seeking', function () {
        card.classList.add('is-buffering');
      });
      v.addEventListener('seeked', function () {
        card.classList.remove('is-buffering');
        updateTimeStatus();
      });

      // YouTube Interactive Scrubber
      if (progEl) {
        function seekCardFromEvent(e) {
          if (!v.duration) return;
          var rect = progEl.getBoundingClientRect();
          var x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
          var pct = rect.width > 0 ? x / rect.width : 0;
          v.currentTime = pct * v.duration;
          if (progPlayed) progPlayed.style.width = (pct * 100) + '%';
          if (progThumb) progThumb.style.left = (pct * 100) + '%';
          updateTimeStatus();
        }

        progEl.addEventListener('mousedown', function (e) {
          e.stopPropagation();
          card.classList.add('is-scrubbing');
          seekCardFromEvent(e);

          function onMove(me) {
            seekCardFromEvent(me);
            if (v.duration && scrubTooltip) {
              var rect = progEl.getBoundingClientRect();
              var x = Math.min(Math.max(me.clientX - rect.left, 0), rect.width);
              var pct = rect.width > 0 ? x / rect.width : 0;
              scrubTooltip.style.opacity = '1';
              scrubTooltip.style.left = (pct * 100) + '%';
              scrubTooltip.textContent = formatDuration(pct * v.duration);
            }
          }
          function onUp() {
            card.classList.remove('is-scrubbing');
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          }
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });

        progEl.addEventListener('mousemove', function (e) {
          if (!v.duration || !scrubTooltip) return;
          var rect = progEl.getBoundingClientRect();
          var x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
          var pct = rect.width > 0 ? x / rect.width : 0;
          if (progHover) progHover.style.width = (pct * 100) + '%';
          scrubTooltip.style.opacity = '1';
          scrubTooltip.style.left = (pct * 100) + '%';
          scrubTooltip.textContent = formatDuration(pct * v.duration);
        });

        progEl.addEventListener('mouseleave', function () {
          if (progHover) progHover.style.width = '0%';
          if (scrubTooltip) scrubTooltip.style.opacity = '0';
        });

        progEl.addEventListener('click', function (e) {
          e.stopPropagation();
        });
      }

      // Fast Hover Preview: plays smooth and silent immediately on mouseenter
      card.addEventListener('mouseenter', function () {
        if (v.preload !== 'auto') v.preload = 'auto';
        updateTimeStatus();
        // If this video is already the active user-playing clip, keep normal playback
        if (PlaybackMaster.activeVideo === v && v.dataset.userPlaying === '1' && !v.paused) return;

        card.classList.add('card-hover-preview');
        v.muted = true; // Hover preview is always silent
        v.playbackRate = PlaybackMaster.currentSpeed || 1;
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
      });

      // Scrubbing preview timecode indicator on mouse hover across card
      card.addEventListener('mousemove', function (e) {
        if (!v.duration) return;
        if (e.target.closest('.asset-card-progress')) return; // handled by progEl
        var rect = card.getBoundingClientRect();
        var pct = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
        var hoverTime = pct * v.duration;
        // Scrub position only when dragging with primary mouse button held
        if (e.buttons === 1) {
          v.currentTime = hoverTime;
          updateTimeStatus();
        }
      });

      card.addEventListener('mouseleave', function () {
        if (scrubTooltip) scrubTooltip.style.opacity = '0';
        if (progHover) progHover.style.width = '0%';
        card.classList.remove('card-hover-preview');
        // If user explicitly clicked this video to play, keep playing!
        if (PlaybackMaster.activeVideo === v && v.dataset.userPlaying === '1') {
          updateTimeStatus();
          return;
        }
        // Stop hover preview immediately to release CPU/GPU decoders
        v.pause();
        updateTimeStatus();
      });

      // Quick on-card speed toggler
      if (speedChip) {
        speedChip.addEventListener('click', function (e) {
          e.stopPropagation();
          var speeds = [1, 1.25, 1.5, 2];
          var cur = parseFloat(speedChip.textContent) || 1;
          var next = speeds[(speeds.indexOf(cur) + 1) % speeds.length];
          PlaybackMaster.setSpeed(next);
        });
      }

      // Expand to Theater Lightbox button
      if (expandBtn) {
        expandBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openLightbox(w, p.id);
        });
      }

      // Single Click: Exclusive 1-Stream Play / Pause (Halts all others)
      var handlePlayClick = function (e) {
        e.stopPropagation();
        var meta = {
          id: p.id,
          title: p.title,
          cat: w.catName,
          poster: p.poster,
          card: card,
          w: w,
          streamSrc: p.streamSrc
        };
        PlaybackMaster.toggleExclusive(v, meta);
      };

      if (playPill) playPill.addEventListener('click', handlePlayClick);
      card.addEventListener('click', handlePlayClick);

      // Double-click opens Lightbox
      card.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        openLightbox(w, p.id);
      });
    } else {
      card.addEventListener('click', function () { openLightbox(w, p.id); });
    }

    // Touch: mouseenter/mousemove never fire on touch devices, replicate scrub
    var touchScrubbing = false;
    card.addEventListener('touchstart', function (e) {
      card.classList.add('card-active');
      touchScrubbing = true;
    }, { passive: true });
    card.addEventListener('touchmove', function (e) {
      if (!touchScrubbing || !p.isVideo) return;
      var vid = qs('video', card);
      if (!vid || !vid.duration) return;
      var t = e.touches[0];
      var rect = card.getBoundingClientRect();
      var pct = Math.min(Math.max((t.clientX - rect.left) / rect.width, 0), 1);
      vid.currentTime = pct * vid.duration;
    }, { passive: true });
    card.addEventListener('touchend', function () {
      touchScrubbing = false;
      setTimeout(function () { card.classList.remove('card-active'); }, 900);
    });

    qs('.asset-card-pin', card).addEventListener('click', function (e) {
      e.stopPropagation();
      togglePin(p, w);
      this.classList.toggle('pinned');
      this.textContent = isPinned(p) ? '\u2713' : '+';
    });

    return card;
  }

  function setupWindowScrollObservers(w) {
    var body = qs('.win-body', w.dom);
    if (w.scrollObserver) { w.scrollObserver.disconnect(); w.scrollObserver = null; }
    var sentinel = qs('.win-loadmore', body);
    if (sentinel && !sentinel.hidden && typeof IntersectionObserver !== 'undefined') {
      w.scrollObserver = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting) loadMoreForWindow(w);
      }, { root: body, rootMargin: '300px 0px' });
      w.scrollObserver.observe(sentinel);
    }

    // Intelligent Scroll Autoplay Engine
    // Replaces chaotic multi-video observer: plays ONLY focal video while scrolling
    if (w._scrollHandler) {
      body.removeEventListener('scroll', w._scrollHandler);
    }
    var scrollRaf = null;
    w._scrollHandler = function () {
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(function () {
        PlaybackMaster.onWindowScroll(w);
      });
    };
    body.addEventListener('scroll', w._scrollHandler, { passive: true });

    // Autoplay on initial paint disabled: videos start paused until hovered or clicked

    // ---- Memory guard: fully detach <video> streams once a card drifts
    // far off-screen (swap to poster-only), and only reattach the src
    // once it drifts back near the viewport. Keeps memory bounded across
    // windows with thousands of loops instead of every video tag holding
    // a live decoder. Wider margin than the autoplay observer above so
    // cards that are merely paused (not yet unloaded) get a buffer zone.
    if (w.memoryGuard) { w.memoryGuard.disconnect(); w.memoryGuard = null; }
    var guardVideos = qsa('.win-grid video[data-base-src]', body);
    if (guardVideos.length && typeof IntersectionObserver !== 'undefined') {
      w.memoryGuard = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var v = entry.target;
          if (entry.isIntersecting) {
            if (v.dataset.unloaded) {
              v.src = applyResolution(v.getAttribute('data-base-src'), Super.resolution);
              v.muted = Super.isMuted;
              v.load();
              delete v.dataset.unloaded;
            }
          } else if (!v.dataset.unloaded) {
            v.pause();
            v.removeAttribute('src');
            v.load();
            v.dataset.unloaded = '1';
          }
        });
      }, { root: body, rootMargin: '1200px 0px', threshold: 0 });
      guardVideos.forEach(function (v) { w.memoryGuard.observe(v); });
    }

    // Reveal-in animation for every card (image or video) as it scrolls
    // into view — the mobile substitute for a mouse-hover preview.
    if (w.revealObserver) { w.revealObserver.disconnect(); w.revealObserver = null; }
    var cards = qsa('.win-grid .asset-card', body);
    if (cards.length && typeof IntersectionObserver !== 'undefined') {
      w.revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) { entry.target.classList.add('card-in-view'); w.revealObserver.unobserve(entry.target); }
        });
      }, { root: body, rootMargin: '80px 0px', threshold: 0.05 });
      cards.forEach(function (c) { w.revealObserver.observe(c); });
    } else {
      cards.forEach(function (c) { c.classList.add('card-in-view'); });
    }
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function escapeAttr(s) { return escapeHtml(s); }

  // Multi-tier video stream fallback with automatic stall recovery:
  // Tier 1: Direct Google Drive usercontent CDN (confirm=t bypasses quota)
  // Tier 2: Direct Drive media API link or timestamped cache-buster
  function bindVideoFallback(video) {
    var errorCount = 0;
    var stallTimer = null;

    function triggerFallback() {
      if (errorCount >= 3) return;
      errorCount++;

      var baseSrc = video.getAttribute('data-base-src') || video.src || '';
      var fileIdMatch = baseSrc.match(/\/api\/stream\/([\w-]+)/);
      var fileId = fileIdMatch ? fileIdMatch[1] : null;

      if (errorCount === 1 && fileId) {
        // Tier 1: Timestamped retry to break stale socket
        video.src = '/api/stream/' + fileId + '?retry=1&t=' + Date.now();
      } else if (errorCount === 2) {
        var fallback = video.getAttribute('data-fallback-src');
        if (fallback && video.src !== fallback) {
          video.src = fallback;
        } else if (fileId) {
          video.src = 'https://drive.usercontent.google.com/download?id=' + fileId + '&export=download&confirm=t';
        }
      } else if (fileId) {
        video.src = 'https://drive.usercontent.google.com/download?id=' + fileId + '&export=download&confirm=t';
      }

      video.load();
      if (video.matches(':hover') || (PlaybackMaster.activeVideo === video && video.dataset.userPlaying === '1')) {
        video.play().catch(function () {});
      }
    }

    video.addEventListener('error', function () {
      triggerFallback();
    });

    // Auto-recover if video stalls for > 4.5 seconds during active play
    video.addEventListener('waiting', function () {
      clearTimeout(stallTimer);
      if (PlaybackMaster.activeVideo === video && !video.paused) {
        stallTimer = setTimeout(function () {
          if (video.readyState < 2 && !video.paused) {
            triggerFallback();
          }
        }, 4500);
      }
    });

    video.addEventListener('playing', function () {
      clearTimeout(stallTimer);
    });
  }

  /* ---------------- Grid size / labels / speed preferences ---------------- */
  function loadGridSizePref() { try { return localStorage.getItem('rawx_grid_size') || 'm'; } catch (e) { return 'm'; } }
  function saveGridSizePref(size) { try { localStorage.setItem('rawx_grid_size', size); } catch (e) {} }

  // Names are OFF by default everywhere — nobody asked to see them.
  function loadLabelsPref() { try { return localStorage.getItem('rawx_labels_on') === '1'; } catch (e) { return false; } }
  function saveLabelsPref(on) { try { localStorage.setItem('rawx_labels_on', on ? '1' : '0'); } catch (e) {} }

  // Fast speed view — cycles hover/autoplay preview playback rate.
  var SPEED_STEPS = [1, 1.5, 2, 3];
  function loadSpeedPref() {
    try { var v = parseFloat(localStorage.getItem('rawx_speed')); return SPEED_STEPS.indexOf(v) !== -1 ? v : 1; }
    catch (e) { return 1; }
  }
  function saveSpeedPref(v) { try { localStorage.setItem('rawx_speed', String(v)); } catch (e) {} }
  function nextSpeed(v) { var i = SPEED_STEPS.indexOf(v); return SPEED_STEPS[(i + 1) % SPEED_STEPS.length]; }

  /* ---------------- Taskbar ---------------- */
  function renderTaskbar() {
    var bar = document.getElementById('taskbar-windows');
    bar.innerHTML = '';
    Object.keys(WM.windows).forEach(function (id) {
      var w = WM.windows[id];
      var btn = el('button', 'taskbar-win-btn' + (WM.activeId === id && !w.minimized ? ' active' : ''));
      btn.textContent = w.catName + (w.tagName ? ' / ' + w.tagName : '');
      btn.addEventListener('click', function () {
        if (w.minimized) restoreWindow(id); else if (WM.activeId === id) minimizeWindow(id); else focusWindow(id);
      });
      bar.appendChild(btn);
    });
  }

  /* ---------------- Dynamic Canvas Hero Grid (homepage background) ----------------
     Turns the blank desktop surface into a live, clickable video grid built
     from the same lazy category/tag fetch the rest of the app uses. Hovering
     a tile highlights it; clicking spawns a window for its category. The
     whole grid darkens/blurs automatically whenever a floating window has
     focus, so it reads as ambient background rather than competing content. */
  function buildHeroGrid(categories) {
    var host = qs('#desktop .desktop-hero-grid');
    if (!host) {
      host = el('div', 'desktop-hero-grid');
      WM.desktop.insertBefore(host, WM.desktop.firstChild);
    }
    var sample = categories.slice(0, 6);
    sample.forEach(function (cat) {
      getTags(cat.id).then(function (tags) {
        var tagId = tags.length ? tags[0].id : cat.id;
        return fetchNextPage(tagId).then(function (cache) {
          cache.items.slice(0, 8).forEach(function (item) {
            var tile = el('div', 'hero-tile');
            tile.innerHTML = item.isVideo
              ? '<video src="' + applyResolution(item.streamSrc, Super.resolution) + '" data-base-src="' + escapeAttr(item.streamSrc || '') + '" poster="' + item.poster + '" ' + (Super.isMuted ? 'muted ' : '') + 'loop playsinline preload="none"></video>'
              : '<img src="' + item.src + '" alt="" loading="lazy">';
            if (item.isVideo) {
              var hv = qs('video', tile);
              if (hv) hv.muted = Super.isMuted;
            }
            tile.addEventListener('mouseenter', function () {
              tile.classList.add('hero-hover');
              var v = qs('video', tile); if (v) v.play().catch(function () {});
            });
            tile.addEventListener('mouseleave', function () {
              tile.classList.remove('hero-hover');
              var v = qs('video', tile); if (v) v.pause();
            });
            tile.addEventListener('click', function () { spawnWindow(cat); });
            host.appendChild(tile);
          });
        });
      }).catch(function () {});
    });
  }
  // Darkens/blurs the hero grid whenever any window is open/focused —
  // called from spawnWindow, focusWindow and closeWindow.
  function updateHeroDim() {
    var host = qs('#desktop .desktop-hero-grid');
    if (host) host.classList.toggle('hero-dimmed', Object.keys(WM.windows).length > 0);
  }

  function buildCategoryTabs(categories) {
    var wrap = document.getElementById('cat-tabs');
    wrap.innerHTML = '';
    categories.forEach(function (cat) {
      var btn = el('button', 'cat-tab', escapeHtml(cat.title));
      btn.addEventListener('click', function () { spawnWindow(cat); });
      wrap.appendChild(btn);
    });
  }

  function buildLauncherMenu(categories) {
    var menu = document.getElementById('launcher-menu');
    menu.innerHTML = '';
    categories.forEach(function (cat) {
      var item = el('button', 'launcher-item', escapeHtml(cat.title));
      item.addEventListener('click', function () {
        spawnWindow(cat);
        menu.classList.remove('open');
      });
      menu.appendChild(item);
    });
  }

  /* ---------------- Lightbox (global, shared) ---------------- */
  var ZOOM_MAX = 6, ZOOM_MIN = 1;
  var lb = { win: null, index: -1, zoom: 1, panX: 0, panY: 0, dragging: false, dragSX: 0, dragSY: 0, dragOX: 0, dragOY: 0, autoOn: false, autoTimer: null };

  function stopAuto() {
    lb.autoOn = false;
    if (lb.autoTimer) clearTimeout(lb.autoTimer);
    lb.autoTimer = null;
    var btn = document.getElementById('lb-auto-btn');
    if (btn) { btn.classList.remove('active'); btn.textContent = '\u25b6 AUTO'; }
  }
  function scheduleAuto() {
    if (!lb.autoOn) return;
    if (lb.autoTimer) clearTimeout(lb.autoTimer);
    lb.autoTimer = setTimeout(function () { lbStep(1); }, 4200);
  }
  function toggleAuto() {
    lb.autoOn = !lb.autoOn;
    var btn = document.getElementById('lb-auto-btn');
    if (btn) { btn.classList.toggle('active', lb.autoOn); btn.textContent = lb.autoOn ? '\u25a0 AUTO' : '\u25b6 AUTO'; }
    if (lb.autoOn) scheduleAuto(); else stopAuto();
  }

  function openLightbox(w, fileId) {
    lb.win = w;
    lb.index = w.filtered.findIndex(function (p) { return p.id === fileId; });
    if (lb.index === -1) return;
    renderLightbox();
    document.getElementById('lightbox').classList.add('open');
    document.getElementById('lightbox').setAttribute('aria-hidden', 'false');
  }

  function resetZoom() { lb.zoom = 1; lb.panX = 0; lb.panY = 0; applyZoomTransform(); }

  function applyZoomTransform() {
    var media = qs('#lb-media img, #lb-media video');
    if (!media) return;
    media.style.transform = 'translate(' + lb.panX + 'px,' + lb.panY + 'px) scale(' + lb.zoom + ')';
    media.classList.toggle('lb-zoomed', lb.zoom > 1);
    var hint = document.getElementById('lb-zoom-hint');
    if (hint) hint.textContent = lb.zoom > 1 ? Math.round(lb.zoom * 100) + '%' : '';
  }

  function setZoom(next) {
    next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
    if (next === 1) { resetZoom(); return; }
    lb.zoom = next;
    var maxPan = 400 * (lb.zoom - 1);
    lb.panX = Math.max(-maxPan, Math.min(maxPan, lb.panX));
    lb.panY = Math.max(-maxPan, Math.min(maxPan, lb.panY));
    applyZoomTransform();
  }

  // Z key cycles: fit -> 2x -> 4x -> fit
  function toggleZoomKey() {
    if (lb.zoom < 1.9) setZoom(2);
    else if (lb.zoom < 3.9) setZoom(4);
    else resetZoom();
  }

  /* ---------------- A/B loop range (lightbox) ---------------- */
  // Dual sliders (0-100 representing % of duration) constrain playback to
  // a custom in/out range — useful for picking a loop out of a long 4K clip.
  var loopRange = { a: 0, b: 100 };
  function bindLoopRange(video) {
    loopRange = { a: 0, b: 100 };
    var aInput = document.getElementById('lb-ab-a');
    var bInput = document.getElementById('lb-ab-b');
    aInput.value = 0; bInput.value = 100;
    function enforce() {
      if (!video.duration || !isFinite(video.duration) || isNaN(video.duration) || video.duration <= 0) return;
      var startT = (loopRange.a / 100) * video.duration;
      var endT = (loopRange.b / 100) * video.duration;
      if (isFinite(startT) && isFinite(endT)) {
        if (video.currentTime < startT) video.currentTime = startT;
        if (video.currentTime >= endT) video.currentTime = startT;
      }
    }
    video.addEventListener('timeupdate', enforce);
    aInput.oninput = function () {
      loopRange.a = Math.min(parseInt(aInput.value, 10), parseInt(bInput.value, 10) - 1);
      aInput.value = loopRange.a;
      if (video.duration && isFinite(video.duration) && !isNaN(video.duration) && video.duration > 0) {
        var targetA = (loopRange.a / 100) * video.duration;
        if (isFinite(targetA)) video.currentTime = targetA;
      }
    };
    bInput.oninput = function () {
      loopRange.b = Math.max(parseInt(bInput.value, 10), parseInt(aInput.value, 10) + 1);
      bInput.value = loopRange.b;
    };
  }

  /* ---------------- Picture-in-Picture floating mini-player ---------------- */
  // Grabs the lightbox video's current src + time and continues it in a
  // small floating widget so browsing can continue with the clip still
  // running. Independent of the native browser PiP API (works everywhere,
  // matches the brutalist chrome).
  var pip = { el: null };
  function openPiP(sourceVideo) {
    if (!sourceVideo) return;
    closePiP();
    var box = el('div', 'pip-widget');
    box.innerHTML =
      '<div class="pip-head"><span>MINI PLAYER</span><button class="pip-close" title="Close">\u2715</button></div>' +
      '<video id="pip-video" src="' + sourceVideo.currentSrc + '" ' + (Super.isMuted ? 'muted ' : '') + 'loop playsinline autoplay></video>';
    document.body.appendChild(box);
    var v = qs('video', box);
    v.muted = Super.isMuted;
    var cur = (sourceVideo && isFinite(sourceVideo.currentTime) && !isNaN(sourceVideo.currentTime)) ? sourceVideo.currentTime : 0;
    if (isFinite(cur)) v.currentTime = cur;
    v.play().catch(function () {});
    qs('.pip-close', box).addEventListener('click', closePiP);
    pip.el = box;
  }
  function closePiP() {
    if (pip.el) { pip.el.remove(); pip.el = null; }
  }

  function renderLightbox() {
    var w = lb.win;
    var p = w.filtered[lb.index];
    if (!p) return;
    var stage = document.getElementById('lb-media');

    if (p.isVideo) {
      stage.innerHTML = '<video id="lb-video" src="' + applyResolution(p.streamSrc, Super.resolution) + '" data-base-src="' + escapeAttr(p.streamSrc || '') + '" data-fallback-src="' + escapeAttr(p.fallbackSrc || '') + '" poster="' + p.poster + '" ' + (Super.isMuted ? 'muted ' : '') + 'controls autoplay loop playsinline></video>';
      var lbVideoEl = document.getElementById('lb-video');
      lbVideoEl.muted = Super.isMuted;
      bindVideoFallback(lbVideoEl);
      bindLoopRange(lbVideoEl);
      qs('#lb-ab-range').hidden = false;
      qs('#lb-pip-btn').hidden = false;
      PlaybackMaster.playExclusive(lbVideoEl, { id: p.id, title: p.title, cat: w.catName, poster: p.poster, w: w, streamSrc: p.streamSrc }, true);
    } else {
      stage.innerHTML = '<img src="' + p.full + '" alt="' + escapeAttr(p.title) + '">';
      qs('#lb-ab-range').hidden = true;
      qs('#lb-pip-btn').hidden = true;
    }
    resetZoom();

    document.getElementById('lb-title').textContent = p.title.toUpperCase() + ' \u2014 ' + (lb.index + 1) + ' / ' + w.filtered.length;
    document.getElementById('lb-character').textContent = p.title;
    document.getElementById('lb-pillar').textContent = w.catName + (w.tagName ? ' / ' + w.tagName : '');
    document.getElementById('lb-set-count').textContent = w.filtered.length + ' assets';
    var pinBtn = document.getElementById('lb-pin-btn');
    pinBtn.classList.toggle('pinned', isPinned(p));
    pinBtn.textContent = isPinned(p) ? 'PINNED' : 'PIN';
  }

  function closeLightbox() {
    stopAuto();
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    document.getElementById('lightbox').classList.remove('open');
    document.getElementById('lightbox').setAttribute('aria-hidden', 'true');
    var lbVideo = document.getElementById('lb-video');
    if (lbVideo) lbVideo.pause();
    document.getElementById('lb-media').innerHTML = '';
    lb.win = null; lb.index = -1;
    // Resume focal video in active window if scroll autoplay is enabled
    if (Super.scrollAutoplay && WM.activeId && WM.windows[WM.activeId]) {
      PlaybackMaster.onWindowScroll(WM.windows[WM.activeId]);
    }
  }

  function lbStep(dir) {
    if (!lb.win || !lb.win.filtered.length) return;
    lb.index = (lb.index + dir + lb.win.filtered.length) % lb.win.filtered.length;
    renderLightbox();
    scheduleAuto();
  }

  function lbTogglePlay() {
    var v = document.getElementById('lb-video');
    if (!v) return;
    PlaybackMaster.toggleExclusive(v, { title: 'LIGHTBOX' });
  }

  // F: force-fullscreen the whole lightbox frame (works for image or video
  // alike), and CSS strips chrome down to just media + prev/next while active.
  function toggleForceFullscreen() {
    var frame = document.getElementById('lb-frame');
    if (!document.fullscreenElement) {
      var req = frame.requestFullscreen || frame.webkitRequestFullscreen;
      if (req) req.call(frame).catch(function () {});
    } else {
      document.exitFullscreen().catch(function () {});
    }
  }

  ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (evt) {
    document.addEventListener(evt, function () {
      var isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      document.getElementById('lightbox').classList.toggle('lb-fullscreen-mode', isFs);
      var v = document.getElementById('lb-video');
      if (v) v.play().catch(function () {});
    });
  });

  /* ---------------- Board / Inquiry modal ---------------- */
  var boardDrag = { sourceIndex: null, touchTargetIndex: null };

  function renderBoard() {
    var thumbs = document.getElementById('board-thumbs');
    var emptyEl = document.getElementById('modal-body-empty');
    var hintEl = document.getElementById('board-reorder-hint');
    if (!thumbs) return;
    thumbs.innerHTML = '';
    if (emptyEl) emptyEl.hidden = pinned.length > 0;
    if (hintEl) hintEl.hidden = pinned.length <= 1;

    pinned.forEach(function (p, i) {
      var thumb = el('div', 'board-thumb');
      thumb.draggable = true;
      thumb.dataset.index = i;
      thumb.dataset.id = p.id;
      thumb.title = 'Drag to reorder (# ' + (i + 1) + ' \u2014 ' + escapeAttr(p.title || '') + ')';

      thumb.innerHTML =
        (p.isVideo ? '<img src="' + p.src + '" alt="' + escapeAttr(p.title) + '">' : '<img src="' + p.src + '" alt="' + escapeAttr(p.title) + '">') +
        '<span class="board-thumb-idx">' + (i + 1) + '</span>' +
        '<span class="board-thumb-grip" title="Drag to reorder">\u283f</span>' +
        '<button class="board-thumb-remove" title="Remove">\u2715</button>';

      var removeBtn = qs('.board-thumb-remove', thumb);
      if (removeBtn) {
        removeBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          togglePin(p);
          renderBoard();
        });
      }

      // Drag and Drop (HTML5)
      thumb.addEventListener('dragstart', function (e) {
        boardDrag.sourceIndex = i;
        thumb.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(i));
      });

      thumb.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (boardDrag.sourceIndex !== null && boardDrag.sourceIndex !== i) {
          thumb.classList.add('drag-over');
        }
      });

      thumb.addEventListener('dragenter', function (e) {
        e.preventDefault();
        if (boardDrag.sourceIndex !== null && boardDrag.sourceIndex !== i) {
          thumb.classList.add('drag-over');
        }
      });

      thumb.addEventListener('dragleave', function () {
        thumb.classList.remove('drag-over');
      });

      thumb.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        thumb.classList.remove('drag-over');
        var fromIndex = boardDrag.sourceIndex !== null ? boardDrag.sourceIndex : parseInt(e.dataTransfer.getData('text/plain'), 10);
        var toIndex = i;
        if (!isNaN(fromIndex) && fromIndex !== toIndex && fromIndex >= 0 && fromIndex < pinned.length) {
          var item = pinned.splice(fromIndex, 1)[0];
          pinned.splice(toIndex, 0, item);
          savePinned();
          renderBoard();
          showToast('REORDERED PINNED ASSETS (#' + (fromIndex + 1) + ' \u2192 #' + (toIndex + 1) + ')');
        }
        boardDrag.sourceIndex = null;
      });

      thumb.addEventListener('dragend', function () {
        thumb.classList.remove('is-dragging');
        qsa('.board-thumb', thumbs).forEach(function (t) { t.classList.remove('drag-over', 'is-dragging'); });
        boardDrag.sourceIndex = null;
      });

      // Touch drag and drop support
      var touchMoved = false;
      thumb.addEventListener('touchstart', function (e) {
        if (e.target.closest('.board-thumb-remove')) return;
        touchMoved = false;
        boardDrag.sourceIndex = i;
      }, { passive: true });

      thumb.addEventListener('touchmove', function (e) {
        if (boardDrag.sourceIndex === null) return;
        touchMoved = true;
        var touch = e.touches[0];
        var targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
        var hoverThumb = targetEl ? targetEl.closest('.board-thumb') : null;
        qsa('.board-thumb', thumbs).forEach(function (t) {
          t.classList.toggle('drag-over', t === hoverThumb && t !== thumb);
        });
        if (hoverThumb && hoverThumb.dataset.index !== undefined) {
          boardDrag.touchTargetIndex = parseInt(hoverThumb.dataset.index, 10);
        } else {
          boardDrag.touchTargetIndex = null;
        }
      }, { passive: true });

      thumb.addEventListener('touchend', function () {
        if (touchMoved && boardDrag.sourceIndex !== null && boardDrag.touchTargetIndex !== null && !isNaN(boardDrag.touchTargetIndex)) {
          var fromIdx = boardDrag.sourceIndex;
          var toIdx = boardDrag.touchTargetIndex;
          if (fromIdx !== toIdx && fromIdx >= 0 && fromIdx < pinned.length && toIdx >= 0 && toIdx < pinned.length) {
            var item = pinned.splice(fromIdx, 1)[0];
            pinned.splice(toIdx, 0, item);
            savePinned();
            renderBoard();
            showToast('REORDERED PINNED ASSETS (#' + (fromIdx + 1) + ' \u2192 #' + (toIdx + 1) + ')');
          }
        }
        qsa('.board-thumb', thumbs).forEach(function (t) { t.classList.remove('drag-over', 'is-dragging'); });
        boardDrag.sourceIndex = null;
        boardDrag.touchTargetIndex = null;
      });

      thumbs.appendChild(thumb);
    });
  }
  function openBoard() { renderBoard(); document.getElementById('board-modal-overlay').classList.add('open'); }
  function closeBoard() { document.getElementById('board-modal-overlay').classList.remove('open'); }

  /* ---------------- Batch export pinned R2/CDN links ---------------- */
  function pinnedStreamUrl(p) {
    // Newer pins carry their real resolved stream URL; older pins saved
    // before this field existed fall back to the thumbnail src.
    return p.streamSrc || p.src;
  }
  function exportPinnedLinks(format) {
    if (!pinned.length) { showToast('BOARD IS EMPTY \u2014 PIN SOME ASSETS FIRST'); return; }
    var content, mime, filename;
    if (format === 'csv') {
      var rows = [['title', 'category', 'tag', 'url']];
      pinned.forEach(function (p) { rows.push([p.title, p.cat || '', p.tag || '', pinnedStreamUrl(p)]); });
      content = rows.map(function (r) {
        return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
      }).join('\n');
      mime = 'text/csv'; filename = 'rawx-board-export.csv';
    } else {
      content = pinned.map(pinnedStreamUrl).join('\n');
      mime = 'text/plain'; filename = 'rawx-board-export.txt';
    }
    var blob = new Blob([content], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', null);
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    showToast('EXPORTED ' + pinned.length + ' LINK' + (pinned.length === 1 ? '' : 'S') + ' (' + format.toUpperCase() + ')');
  }

  /* ---------------- Compare Window: 2 or 4 pinned videos, synced scrub ---------------- */
  function openCompareFromBoard() {
    var candidates = pinned.filter(function (p) { return p.isVideo; });
    if (candidates.length < 2) { showToast('PIN AT LEAST 2 VIDEOS TO COMPARE'); return; }
    var picks = candidates.slice(0, candidates.length >= 4 ? 4 : 2);
    closeBoard();
    openCompareWindow(picks);
  }
  function openCompareWindow(items) {
    var existing = document.getElementById('compare-window');
    if (existing) existing.remove();
    var win = el('div', 'compare-window');
    win.id = 'compare-window';
    win.innerHTML =
      '<div class="compare-head">' +
        '<span>SIDE-BY-SIDE COMPARE \u2014 ' + items.length + ' CLIPS</span>' +
        '<div class="compare-head-actions">' +
          '<button class="win-chip-btn" id="compare-sync-btn">\u21bb SYNC SCRUB</button>' +
          '<button class="win-btn win-close" id="compare-close-btn" title="Close">\u2715</button>' +
        '</div>' +
      '</div>' +
      '<div class="compare-grid compare-grid-' + items.length + '"></div>' +
      '<input type="range" id="compare-scrub" min="0" max="100" value="0" step="0.1">';
    document.body.appendChild(win);
    var grid = qs('.compare-grid', win);
    items.forEach(function (p) {
      var cell = el('div', 'compare-cell');
      cell.innerHTML = '<video class="compare-video" src="' + applyResolution(pinnedStreamUrl(p), Super.resolution) +
        '" data-base-src="' + escapeAttr(pinnedStreamUrl(p)) + '" ' + (Super.isMuted ? 'muted ' : '') + 'loop playsinline autoplay></video>' +
        '<span class="compare-label">' + escapeHtml(p.title) + '</span>';
      var cv = qs('video', cell);
      if (cv) cv.muted = Super.isMuted;
      grid.appendChild(cell);
    });
    var scrub = qs('#compare-scrub', win);
    scrub.addEventListener('input', function () {
      var vids = qsa('.compare-video', win);
      vids.forEach(function (v) {
        if (v.duration && isFinite(v.duration)) v.currentTime = (scrub.value / 100) * v.duration;
      });
    });
    qs('#compare-sync-btn', win).addEventListener('click', function () {
      var vids = qsa('.compare-video', win);
      var t = vids[0] ? vids[0].currentTime : 0;
      vids.forEach(function (v) { if (v.duration) v.currentTime = t % v.duration; });
      showToast('COMPARE CLIPS SYNCED');
    });
    qs('#compare-close-btn', win).addEventListener('click', function () { win.remove(); });
  }

  /* ---------------- Global events ---------------- */
  function bindGlobalEvents() {
    document.getElementById('lb-close').addEventListener('click', closeLightbox);
    document.getElementById('lb-prev').addEventListener('click', function () { lbStep(-1); });
    document.getElementById('lb-next').addEventListener('click', function () { lbStep(1); });
    document.getElementById('lb-pin-btn').addEventListener('click', function () {
      if (!lb.win) return;
      togglePin(lb.win.filtered[lb.index], lb.win);
      renderLightbox();
    });
    document.getElementById('lightbox').addEventListener('click', function (e) { if (e.target.id === 'lightbox') closeLightbox(); });
    document.getElementById('lb-fullscreen-btn').addEventListener('click', toggleForceFullscreen);
    document.getElementById('lb-auto-btn').addEventListener('click', toggleAuto);
    document.getElementById('lb-pip-btn').addEventListener('click', function () {
      var v = document.getElementById('lb-video');
      if (!v) return;
      openPiP(v);
      closeLightbox();
    });

    /* ---- Resolution selector (top bar + lightbox + mobile sheet) ---- */
    function applyResolutionEverywhere(resKey) {
      Super.resolution = resKey;
      savePref('rawx_resolution', resKey);
      qsa('.res-select').forEach(function (sel) { sel.value = resKey; });
      allLiveVideos().forEach(function (v) {
        var base = v.getAttribute('data-base-src');
        if (!base) return;
        var t = v.currentTime;
        var wasPlaying = !v.paused;
        v.src = applyResolution(base, resKey);
        v.currentTime = t;
        if (wasPlaying) v.play().catch(function () {});
      });
    }
    qsa('.res-select').forEach(function (sel) {
      sel.value = Super.resolution;
      sel.addEventListener('change', function (e) { applyResolutionEverywhere(e.target.value); });
    });

    /* ---- Theme accent switcher (top bar + mobile sheet) ---- */
    document.documentElement.setAttribute('data-theme', Super.theme);
    qsa('.theme-select').forEach(function (sel) {
      sel.value = Super.theme;
      sel.addEventListener('change', function (e) {
        Super.theme = e.target.value;
        savePref('rawx_theme', Super.theme);
        document.documentElement.setAttribute('data-theme', Super.theme);
        qsa('.theme-select').forEach(function (s) { s.value = Super.theme; });
      });
    });

    /* ---- Global Mute / Unmute Controller ---- */
    qsa('.global-mute-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleGlobalMute();
      });
    });
    updateGlobalMuteUI();

    /* ---- Tidy Windows: auto-align all open desktop windows in a grid ---- */
    qsa('.tidy-windows-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        tidyWindows();
      });
    });

    /* ---- Magnetic Snapping: align windows to grid & siblings ---- */
    qsa('.snap-toggle-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        SnapEngine.toggleSnap();
      });
    });
    SnapEngine.updateUI();

    /* ---- Sync All Loops: time-align every currently playing video ---- */
    qsa('.sync-loops-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var vids = allLiveVideos().filter(function (v) { return !v.paused && isFinite(v.duration) && v.duration > 0; });
        if (!vids.length) { showToast('NO PLAYING LOOPS TO SYNC'); return; }
        var t = vids[0].currentTime;
        vids.forEach(function (v) { v.currentTime = t % v.duration; });
        showToast('SYNCED ' + vids.length + ' LOOP' + (vids.length === 1 ? '' : 'S'));
      });
    });

    /* ---- Spotlight Hover: dim every card except the one under the cursor ---- */
    qsa('.spotlight-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Super.spotlight = !Super.spotlight;
        qsa('.spotlight-btn').forEach(function (b) { b.classList.toggle('active', Super.spotlight); });
        document.body.classList.toggle('spotlight-mode', Super.spotlight);
        if (!Super.spotlight) qsa('.asset-card.spotlight-dim, .asset-card.spotlight-target').forEach(function (c) {
          c.classList.remove('spotlight-dim', 'spotlight-target');
        });
      });
    });
    WM.desktop && WM.desktop.addEventListener('mouseover', function (e) {
      if (!Super.spotlight) return;
      var card = e.target.closest('.asset-card');
      if (!card) return;
      qsa('.asset-card').forEach(function (c) {
        c.classList.toggle('spotlight-target', c === card);
        c.classList.toggle('spotlight-dim', c !== card);
      });
    });
    WM.desktop && WM.desktop.addEventListener('mouseout', function (e) {
      if (!Super.spotlight) return;
      if (e.target.closest('.asset-card') && !e.relatedTarget) {
        qsa('.asset-card').forEach(function (c) { c.classList.remove('spotlight-target', 'spotlight-dim'); });
      }
    });

    /* ---- Mobile settings sheet: gear button opens/closes the panel ---- */
    var mobileSettingsBtn = document.getElementById('mobile-settings-btn');
    var mobileSheet = document.getElementById('mobile-settings-sheet');
    if (mobileSettingsBtn && mobileSheet) {
      mobileSettingsBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        mobileSheet.classList.toggle('open');
      });
      document.addEventListener('click', function (e) {
        if (mobileSheet.classList.contains('open') && !mobileSheet.contains(e.target) && e.target !== mobileSettingsBtn) {
          mobileSheet.classList.remove('open');
        }
      });
    }
    var mobilePresentationBtn = document.getElementById('mobile-presentation-btn');
    if (mobilePresentationBtn) {
      mobilePresentationBtn.addEventListener('click', function () {
        Super.presentation = !Super.presentation;
        document.body.classList.toggle('presentation-mode', Super.presentation);
        mobilePresentationBtn.classList.toggle('active', Super.presentation);
        if (mobileSheet) mobileSheet.classList.remove('open');
        showToast(Super.presentation ? 'PRESENTATION MODE \u2014 TAP \u2699 TO EXIT' : 'PRESENTATION MODE OFF');
      });
    }

    /* ---- Compare Window: 2 or 4 pinned videos, synced scrubbing ---- */
    var compareBtn = document.getElementById('board-compare-btn');
    if (compareBtn) compareBtn.addEventListener('click', openCompareFromBoard);

    /* ---- Batch export pinned links ---- */
    var exportTxtBtn = document.getElementById('board-export-txt-btn');
    if (exportTxtBtn) exportTxtBtn.addEventListener('click', function () { exportPinnedLinks('txt'); });
    var exportCsvBtn = document.getElementById('board-export-csv-btn');
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', function () { exportPinnedLinks('csv'); });

    // ---- Mobile tap dock: every command gets a real button, no keyboard needed ----
    document.getElementById('lb-dock-prev').addEventListener('click', function () { lbStep(-1); });
    document.getElementById('lb-dock-next').addEventListener('click', function () { lbStep(1); });
    document.getElementById('lb-dock-zoomin').addEventListener('click', function () { setZoom(lb.zoom + 1); });
    document.getElementById('lb-dock-zoomout').addEventListener('click', function () { lb.zoom - 1 <= 1 ? resetZoom() : setZoom(lb.zoom - 1); });
    document.getElementById('lb-dock-fullscreen').addEventListener('click', toggleForceFullscreen);

    // ---- Zoom: wheel to zoom in/out around the cursor, drag to pan while zoomed ----
    var stage = document.getElementById('lb-media');
    stage.addEventListener('wheel', function (e) {
      var media = qs('#lb-media img, #lb-media video');
      if (!media) return;
      e.preventDefault();
      var delta = e.deltaY < 0 ? 0.5 : -0.5;
      setZoom(lb.zoom + delta);
    }, { passive: false });

    stage.addEventListener('mousedown', function (e) {
      if (lb.zoom <= 1 || e.target.tagName === 'BUTTON') return;
      lb.dragging = true;
      lb.dragSX = e.clientX; lb.dragSY = e.clientY;
      lb.dragOX = lb.panX; lb.dragOY = lb.panY;
      stage.classList.add('lb-panning');
    });
    window.addEventListener('mousemove', function (e) {
      if (!lb.dragging) return;
      lb.panX = lb.dragOX + (e.clientX - lb.dragSX);
      lb.panY = lb.dragOY + (e.clientY - lb.dragSY);
      applyZoomTransform();
    });
    window.addEventListener('mouseup', function () { lb.dragging = false; stage.classList.remove('lb-panning'); });
    stage.addEventListener('dblclick', function () { toggleZoomKey(); });

    // ---- Touch: pinch-to-zoom, single-finger swipe nav / swipe-down-to-close, double-tap zoom ----
    var touch = { mode: null, startDist: 0, startZoom: 1, sx: 0, sy: 0, panOX: 0, panOY: 0, lastTap: 0 };
    function touchDist(t0, t1) { return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY); }

    stage.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        touch.mode = 'pinch';
        touch.startDist = touchDist(e.touches[0], e.touches[1]);
        touch.startZoom = lb.zoom;
      } else if (e.touches.length === 1) {
        var now = Date.now();
        if (now - touch.lastTap < 300) { toggleZoomKey(); touch.mode = null; touch.lastTap = 0; return; }
        touch.lastTap = now;
        touch.mode = lb.zoom > 1 ? 'pan' : 'swipe';
        touch.sx = e.touches[0].clientX; touch.sy = e.touches[0].clientY;
        touch.panOX = lb.panX; touch.panOY = lb.panY;
      }
    }, { passive: true });

    stage.addEventListener('touchmove', function (e) {
      if (touch.mode === 'pinch' && e.touches.length === 2) {
        e.preventDefault();
        var dist = touchDist(e.touches[0], e.touches[1]);
        setZoom(touch.startZoom * (dist / touch.startDist));
      } else if (touch.mode === 'pan' && e.touches.length === 1) {
        e.preventDefault();
        lb.panX = touch.panOX + (e.touches[0].clientX - touch.sx);
        lb.panY = touch.panOY + (e.touches[0].clientY - touch.sy);
        applyZoomTransform();
      }
      // 'swipe' mode: let the finger move freely, decide the gesture on touchend
    }, { passive: false });

    stage.addEventListener('touchend', function (e) {
      if (touch.mode === 'swipe' && e.changedTouches.length === 1) {
        var dx = e.changedTouches[0].clientX - touch.sx;
        var dy = e.changedTouches[0].clientY - touch.sy;
        if (Math.abs(dy) > 80 && Math.abs(dy) > Math.abs(dx)) { closeLightbox(); }
        else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { lbStep(dx < 0 ? 1 : -1); }
      }
      touch.mode = null;
    });

    document.getElementById('taskbar-board-btn').addEventListener('click', openBoard);
    document.getElementById('board-modal-close').addEventListener('click', closeBoard);
    document.getElementById('board-modal-overlay').addEventListener('click', function (e) { if (e.target.id === 'board-modal-overlay') closeBoard(); });

    document.getElementById('inquiry-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var company = document.getElementById('inq-company').value;
      var email = document.getElementById('inq-email').value;
      var notes = document.getElementById('inq-notes').value;
      var refList = pinned.map(function (p) { return p.title + ' (' + (p.cat || '') + (p.tag ? '/' + p.tag : '') + ')'; }).join(', ') || 'None pinned';
      var subject = encodeURIComponent('B2B Inquiry \u2014 ' + company);
      var body = encodeURIComponent('Company: ' + company + '\nEmail: ' + email + '\nNotes: ' + notes + '\nReferenced assets: ' + refList);
      window.location.href = 'mailto:hello@handfilm.com?subject=' + subject + '&body=' + body;
      showToast('INQUIRY DRAFTED \u2014 CHECK YOUR MAIL CLIENT');
      closeBoard();
      e.target.reset();
    });

    document.getElementById('launcher-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      document.getElementById('launcher-menu').classList.toggle('open');
    });
    document.addEventListener('click', function () { document.getElementById('launcher-menu').classList.remove('open'); });

    document.getElementById('panels-nav-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      this.classList.toggle('open');
      document.getElementById('panels-menu').classList.toggle('open');
    });
    document.addEventListener('click', function () {
      document.getElementById('panels-nav-btn').classList.remove('open');
      document.getElementById('panels-menu').classList.remove('open');
    });

    PlaybackMaster.init();

    document.addEventListener('keydown', function (e) {
      var typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
      // Shift+P — clean client-pitch presentation mode: hides topbar,
      // taskbar and window chrome for a full-screen walkthrough.
      if (!typing && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        Super.presentation = !Super.presentation;
        document.body.classList.toggle('presentation-mode', Super.presentation);
        var mpBtn = document.getElementById('mobile-presentation-btn');
        if (mpBtn) mpBtn.classList.toggle('active', Super.presentation);
        showToast(Super.presentation ? 'PRESENTATION MODE \u2014 SHIFT+P TO EXIT' : 'PRESENTATION MODE OFF');
        return;
      }
      if (document.getElementById('lightbox').classList.contains('open')) {
        // Escape always closes (and drops fullscreen with it, see closeLightbox)
        if (e.key === 'Escape') { closeLightbox(); return; }
        // N / P / arrows — navigate
        if (e.key === 'n' || e.key === 'N' || e.key === 'ArrowRight') { lbStep(1); return; }
        if (e.key === 'p' || e.key === 'P' || e.key === 'ArrowLeft') { lbStep(-1); return; }
        // Z — cycle zoom (fit -> 2x -> 4x -> fit)
        if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); toggleZoomKey(); return; }
        // F — force fullscreen in/out (image or video, minimal-chrome mode)
        if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleForceFullscreen(); return; }
        // Tab — pause/resume the current video, without shifting page focus
        if (e.key === 'Tab') { e.preventDefault(); lbTogglePlay(); return; }
        return;
      }
      if (typing) return;

      // X — Toggle 1-Stream Exclusive Focus Mode
      if ((e.key === 'x' || e.key === 'X') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        PlaybackMaster.toggleStreamFocus();
        return;
      }

      // Space or K — Play/Pause active video
      if ((e.key === ' ' || e.key === 'k' || e.key === 'K') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (PlaybackMaster.activeVideo) {
          e.preventDefault();
          PlaybackMaster.toggleExclusive(PlaybackMaster.activeVideo, PlaybackMaster.activeMeta);
          return;
        }
      }

      // Left / Right Arrows — Step 1s back / fwd
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (PlaybackMaster.activeVideo) {
          e.preventDefault();
          PlaybackMaster.stepSeconds(e.key === 'ArrowLeft' ? -1 : 1);
          return;
        }
      }

      // Comma / Period — Frame step -1 / +1
      if ((e.key === ',' || e.key === '.') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (PlaybackMaster.activeVideo) {
          e.preventDefault();
          PlaybackMaster.stepFrame(e.key === ',' ? -1 : 1);
          return;
        }
      }

      // [ or ] — Speed down / up
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        var speeds = [0.5, 1, 1.25, 1.5, 2];
        var curIdx = speeds.indexOf(PlaybackMaster.currentSpeed);
        if (curIdx === -1) curIdx = 1;
        var nextIdx = e.key === '[' ? Math.max(0, curIdx - 1) : Math.min(speeds.length - 1, curIdx + 1);
        PlaybackMaster.setSpeed(speeds[nextIdx]);
        return;
      }

      // P (without shift) — Open PiP Mini Player
      if ((e.key === 'p' || e.key === 'P') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (PlaybackMaster.activeVideo) {
          e.preventDefault();
          openPiP(PlaybackMaster.activeVideo);
          return;
        }
      }

      // Alt+T or Shift+T — Tidy open desktop windows into a clean grid
      if (!typing && (e.key === 't' || e.key === 'T') && (e.altKey || e.shiftKey) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        tidyWindows();
        return;
      }
      // Alt+S or Shift+S — Toggle magnetic window snapping to grid & siblings
      if (!typing && (e.key === 's' || e.key === 'S') && (e.altKey || e.shiftKey) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        SnapEngine.toggleSnap();
        return;
      }
      if (!typing && (e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleGlobalMute();
        return;
      }
      if (e.key === 'Escape' && WM.activeId) minimizeWindow(WM.activeId);
    });
  }

  /* ---------------- Boot ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    WM.desktop = document.getElementById('desktop');
    var bar = document.getElementById('boot-bar-fill');
    bar.style.width = '30%';
    bindGlobalEvents();
    renderPinCounts();

    setBootStatus('READING CATEGORY FOLDERS\u2026');
    getCategories().then(function (categories) {
      bar.style.width = '100%';
      document.getElementById('status-text').textContent = 'LIVE';
      document.getElementById('stat-total').textContent = categories.length + ' CATEGORIES';

      if (!categories.length) {
        setBootStatus('NO CATEGORY FOLDERS FOUND \u2014 CHECK driveRootFolderId');
      } else {
        buildCategoryTabs(categories);
        buildLauncherMenu(categories);
        buildHeroGrid(categories);
        spawnWindow(categories[0]);
      }

      setTimeout(function () { document.getElementById('boot').classList.add('hidden'); }, 350);
    }).catch(function (err) {
      console.error(err);
      setBootStatus('DRIVE FETCH FAILED \u2014 CHECK API KEY / FOLDER SHARING');
      bar.style.width = '100%';
      setTimeout(function () { document.getElementById('boot').classList.add('hidden'); }, 800);
    });
  });
})();
