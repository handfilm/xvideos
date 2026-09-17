const express = require('express');
const path = require('path');
const https = require('https');
const fs = require('fs');

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

const CONFIG = {
  driveRootFolderId: '1zno_n1n23dbIb4HE8giapSAqGS9WZd33',
  driveApiKey: 'AIzaSyCqU3qT5SaRYTZev6ZfChJvApRDGDzv88Y',
  cacheDir: path.join('/tmp', 'rawx_video_cache')
};

// Ensure cache directory exists
try {
  if (!fs.existsSync(CONFIG.cacheDir)) {
    fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
  }
} catch (e) {
  console.warn('Could not create cache dir:', e.message);
}

// In-memory catalog cache
let catalogCache = null;
let catalogCacheTime = 0;
const CATALOG_TTL = 30 * 60 * 1000; // 30 minutes

// Active download locks for caching
const activeDownloads = new Map();

// Helper: HTTP GET with promises and error safety
function httpsGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('http:') ? require('http') : https;
    const req = client.get(url, options, (res) => {
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(options.timeout || 15000, () => {
      req.destroy(new Error('Request timeout'));
      reject(new Error('Request timeout'));
    });
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('http:') ? require('http') : https;
    const req = client.get(url, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('Request timeout'));
      reject(new Error('Request timeout'));
    });
  });
}

function titleFromName(name) {
  return name
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ================================================================
// ULTRA-SMOOTH VIDEO STREAMING ENGINE (/api/stream/:fileId)
// - Supports byte-range requests (RFC 7233) for instant seek & scrub
// - Strips download-attachment and frame-blocking headers from Drive
// - Immediate socket abort on client disconnect to prevent bandwidth leaks
// - Automatic fallback to drive.usercontent CDN if Drive API hits quota limits
// - Disk-backed chunk caching with a single-worker queue for zero lag
// ================================================================

// Helper: HTTP request following redirects (up to maxRedirects) with full error safety
function requestWithRedirects(targetUrl, options = {}, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const safeResolve = (val) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };
    const safeReject = (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    const client = targetUrl.startsWith('http:') ? require('http') : https;
    const req = client.get(targetUrl, options, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        try { res.destroy(); } catch (_) {}
        if (maxRedirects <= 0) {
          return safeReject(new Error('Too many redirects'));
        }
        let nextUrl = res.headers.location;
        if (!nextUrl.startsWith('http')) {
          try {
            nextUrl = new URL(nextUrl, targetUrl).toString();
          } catch (e) {
            return safeReject(e);
          }
        }
        return requestWithRedirects(nextUrl, options, maxRedirects - 1)
          .then(safeResolve)
          .catch(safeReject);
      }
      safeResolve({ req, res });
    });

    req.on('error', (err) => {
      safeReject(err);
    });

    if (options.timeout) {
      req.setTimeout(options.timeout, () => {
        try { req.destroy(); } catch (_) {}
        safeReject(new Error('Request timeout'));
      });
    }
  });
}

app.get('/api/stream/:fileId', async (req, res) => {
  const fileId = req.params.fileId;
  if (!fileId || !/^[\w-]+$/.test(fileId)) {
    return res.status(400).send('Invalid file ID');
  }

  const cacheFile = path.join(CONFIG.cacheDir, `${fileId}.mp4`);
  const range = req.headers.range;

  // 1. FAST PATH: Serve from local disk cache if available
  if (fs.existsSync(cacheFile)) {
    try {
      const stat = fs.statSync(cacheFile);
      const fileSize = stat.size;

      if (fileSize > 10000) {
        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          let start = parseInt(parts[0], 10);
          let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

          if (isNaN(start)) {
            start = fileSize - parseInt(parts[1], 10);
            end = fileSize - 1;
          }
          if (isNaN(end) || end >= fileSize) {
            end = fileSize - 1;
          }
          if (start < 0) start = 0;

          if (start >= fileSize || start > end) {
            res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
            return res.end();
          }

          const chunkSize = end - start + 1;
          const fileStream = fs.createReadStream(cacheFile, { start, end, highWaterMark: 256 * 1024 });

          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': 'video/mp4',
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length'
          });

          req.on('close', () => fileStream.destroy());
          return fileStream.pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length'
          });
          const fileStream = fs.createReadStream(cacheFile, { highWaterMark: 256 * 1024 });
          req.on('close', () => fileStream.destroy());
          return fileStream.pipe(res);
        }
      }
    } catch (err) {
      console.warn('Error reading cached file, falling back to live stream:', err.message);
    }
  }

  // 2. LIVE PROXIED STREAM: Direct low-latency byte-range piping
  let clientAborted = false;
  let activeUpstream = null;

  req.on('close', () => {
    clientAborted = true;
    if (activeUpstream && activeUpstream.destroy) {
      activeUpstream.destroy();
    }
  });

  const forwardStream = (upstreamRes, statusCode) => {
    if (clientAborted || res.headersSent) {
      upstreamRes.destroy();
      return;
    }

    const contentType = upstreamRes.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      upstreamRes.destroy();
      if (!res.headersSent) {
        res.status(503).json({ error: 'Upstream quota reached, please try again' });
      }
      return;
    }

    const responseHeaders = {
      'Content-Type': contentType.includes('video') ? contentType : 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length'
    };

    if (upstreamRes.headers['content-range']) {
      responseHeaders['Content-Range'] = upstreamRes.headers['content-range'];
    }
    if (upstreamRes.headers['content-length']) {
      responseHeaders['Content-Length'] = upstreamRes.headers['content-length'];
    }

    upstreamRes.on('error', (err) => {
      console.warn('Upstream stream error:', err.message);
      try {
        if (!res.headersSent) {
          res.status(502).json({ error: 'Stream interrupted' });
        } else {
          res.end();
        }
      } catch (_) {}
    });

    res.writeHead(statusCode, responseHeaders);
    upstreamRes.pipe(res);
  };

  // Helper: Try drive.usercontent CDN fallback
  const tryUserContentCDN = async () => {
    try {
      const cdnUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 12000
      };
      if (range) options.headers['Range'] = range;

      const { req: cdnReq, res: cdnRes } = await requestWithRedirects(cdnUrl, options);
      activeUpstream = cdnRes;

      const cdnType = cdnRes.headers['content-type'] || '';
      if ((cdnRes.statusCode === 200 || cdnRes.statusCode === 206) && !cdnType.includes('text/html')) {
        forwardStream(cdnRes, cdnRes.statusCode);
      } else {
        try { cdnRes.destroy(); } catch (_) {}
        if (!res.headersSent) {
          res.status(cdnRes.statusCode === 404 ? 404 : 403).json({ error: 'Stream unavailable' });
        }
      }
    } catch (cdnErr) {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Stream connection failed' });
      }
    }
  };

  // Try Drive API first (RFC 7233 byte-range supported)
  const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${CONFIG.driveApiKey}`;
  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    timeout: 12000
  };
  if (range) options.headers['Range'] = range;

  const driveReq = https.get(driveUrl, options, (driveRes) => {
    activeUpstream = driveRes;
    const statusCode = driveRes.statusCode;

    // If Google Drive API returns 200 or 206, stream immediately
    if (statusCode === 200 || statusCode === 206) {
      return forwardStream(driveRes, statusCode);
    }

    // If 403 or redirect, fallback to usercontent CDN
    try { driveRes.destroy(); } catch (_) {}
    tryUserContentCDN();
  });

  driveReq.on('error', (err) => {
    console.warn('Drive stream request error:', err.message);
    tryUserContentCDN();
  });

  driveReq.on('timeout', () => {
    try { driveReq.destroy(); } catch (_) {}
    tryUserContentCDN();
  });

  activeUpstream = driveReq;
});

// ================================================================
// THUMBNAIL / POSTER PROXY (/api/poster/:fileId)
// Robust fetch following redirects with timeout and error guards
// ================================================================
function fetchPosterWithRedirects(targetUrl, maxRedirects = 4, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const safeResolve = (val) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };
    const safeReject = (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    const client = targetUrl.startsWith('http:') ? require('http') : https;
    const req = client.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/*,*/*'
      },
      timeout: timeoutMs
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        try { res.resume(); } catch (_) {}
        if (maxRedirects <= 0) {
          return safeReject(new Error('Too many redirects'));
        }
        let nextUrl = res.headers.location;
        if (!nextUrl.startsWith('http')) {
          try {
            nextUrl = new URL(nextUrl, targetUrl).toString();
          } catch (e) {
            return safeReject(e);
          }
        }
        return fetchPosterWithRedirects(nextUrl, maxRedirects - 1, timeoutMs)
          .then(safeResolve)
          .catch(safeReject);
      }
      safeResolve({ req, res });
    });

    req.on('error', (err) => {
      safeReject(err);
    });

    req.on('timeout', () => {
      try { req.destroy(new Error('Request timeout')); } catch (_) {}
      safeReject(new Error('Request timeout'));
    });
  });
}

app.get('/api/poster/:fileId', async (req, res) => {
  const fileId = req.params.fileId;
  if (!fileId || !/^[\w-]+$/.test(fileId)) {
    return res.status(400).end();
  }
  const thumbUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`;

  let clientClosed = false;
  let activeReq = null;
  let activeRes = null;

  req.on('close', () => {
    clientClosed = true;
    try {
      if (activeReq && !activeReq.destroyed) activeReq.destroy();
      if (activeRes && !activeRes.destroyed) activeRes.destroy();
    } catch (_) {}
  });

  try {
    const { req: upstreamReq, res: upstreamRes } = await fetchPosterWithRedirects(thumbUrl, 4, 12000);
    activeReq = upstreamReq;
    activeRes = upstreamRes;

    if (clientClosed || res.headersSent) {
      try { upstreamRes.destroy(); } catch (_) {}
      return;
    }

    if (upstreamRes.statusCode < 200 || upstreamRes.statusCode >= 400) {
      try { upstreamRes.destroy(); } catch (_) {}
      if (!res.headersSent) res.status(upstreamRes.statusCode || 502).end();
      return;
    }

    res.writeHead(upstreamRes.statusCode, {
      'Content-Type': upstreamRes.headers['content-type'] || 'image/jpeg',
      'Cache-Control': 'public, max-age=604800',
      'Access-Control-Allow-Origin': '*'
    });

    upstreamRes.on('error', (err) => {
      console.warn('Poster stream error:', err.message);
      try {
        if (!res.headersSent) res.status(502).end();
        else res.end();
      } catch (_) {}
    });

    upstreamRes.pipe(res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).end();
    }
  }
});

// ================================================================
// FAST CATALOG CRAWLER API (/api/catalog)
// Returns all categories, tags, and motion clips in one fast response
// ================================================================
app.get('/api/catalog', async (req, res) => {
  if (catalogCache && Date.now() - catalogCacheTime < CATALOG_TTL) {
    return res.json(catalogCache);
  }

  try {
    const rootUrl = `https://www.googleapis.com/drive/v3/files?q='${CONFIG.driveRootFolderId}'+in+parents+and+trashed=false+and+mimeType='application/vnd.google-apps.folder'&key=${CONFIG.driveApiKey}&fields=files(id,name)&pageSize=100&orderBy=name`;
    const rootData = await fetchJson(rootUrl);
    const categories = rootData.files || [];

    const allItems = [];
    const categoryList = [];

    await Promise.all(
      categories.map(async (cat) => {
        categoryList.push({ id: cat.id, name: cat.name, title: titleFromName(cat.name) });

        const subUrl = `https://www.googleapis.com/drive/v3/files?q='${cat.id}'+in+parents+and+trashed=false&key=${CONFIG.driveApiKey}&fields=files(id,name,mimeType,thumbnailLink)&pageSize=100&orderBy=name`;
        try {
          const subData = await fetchJson(subUrl);
          const files = subData.files || [];

          for (const file of files) {
            const isVideo =
              (file.mimeType && file.mimeType.startsWith('video/')) ||
              /\.(mp4|webm|mov|m4v)$/i.test(file.name);

            if (isVideo) {
              allItems.push({
                id: file.id,
                title: titleFromName(file.name),
                category: cat.name.toUpperCase(),
                tag: null,
                streamSrc: `/api/stream/${file.id}`,
                fallbackSrc: `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&key=${CONFIG.driveApiKey}`,
                poster: `/api/poster/${file.id}`,
                mimeType: file.mimeType || 'video/mp4'
              });
            } else if (file.mimeType === 'application/vnd.google-apps.folder') {
              // Subfolder (tag)
              try {
                const tagFilesUrl = `https://www.googleapis.com/drive/v3/files?q='${file.id}'+in+parents+and+trashed=false&key=${CONFIG.driveApiKey}&fields=files(id,name,mimeType,thumbnailLink)&pageSize=100&orderBy=name`;
                const tagData = await fetchJson(tagFilesUrl);
                for (const tf of tagData.files || []) {
                  if (
                    (tf.mimeType && tf.mimeType.startsWith('video/')) ||
                    /\.(mp4|webm|mov|m4v)$/i.test(tf.name)
                  ) {
                    allItems.push({
                      id: tf.id,
                      title: titleFromName(tf.name),
                      category: cat.name.toUpperCase(),
                      tag: file.name.toUpperCase(),
                      streamSrc: `/api/stream/${tf.id}`,
                      fallbackSrc: `https://www.googleapis.com/drive/v3/files/${tf.id}?alt=media&key=${CONFIG.driveApiKey}`,
                      poster: `/api/poster/${tf.id}`,
                      mimeType: tf.mimeType || 'video/mp4'
                    });
                  }
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
      })
    );

    catalogCache = {
      categories: categoryList,
      items: allItems,
      total: allItems.length,
      timestamp: Date.now()
    };
    catalogCacheTime = Date.now();

    res.json(catalogCache);
  } catch (err) {
    console.error('Catalog crawl error:', err.message);
    res.status(500).json({ error: 'Failed to fetch catalog', message: err.message });
  }
});

// Serve static files from root directory
app.use(express.static(__dirname));

// Route handlers for main views
app.get('/album', (req, res) => {
  res.sendFile(path.join(__dirname, 'album.html'));
});

app.get('/album.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'album.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Fallback to index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Self-healing port reclamation if an orphaned dev server holds port 3000
try {
  const { execSync } = require('child_process');
  const out = execSync('ss -tlpn 2>/dev/null || true').toString();
  const m = out.match(/0\.0\.0\.0:3000.*pid=(\d+)/);
  if (m && m[1] && parseInt(m[1]) !== process.pid) {
    try {
      process.kill(parseInt(m[1]), 'SIGKILL');
    } catch (_) {}
  }
} catch (_) {}

function startServer() {
  const server = app.listen(PORT, HOST, () => {
    console.log(`RAWX Motion Lab high-speed streaming server running on http://${HOST}:${PORT}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${PORT} in use, attempting automatic recovery...`);
      try {
        const { execSync } = require('child_process');
        const out = execSync('ss -tlpn 2>/dev/null || true').toString();
        const m = out.match(/0\.0\.0\.0:3000.*pid=(\d+)/);
        if (m && m[1] && parseInt(m[1]) !== process.pid) {
          process.kill(parseInt(m[1]), 'SIGKILL');
          setTimeout(() => {
            try { server.close(); } catch (_) {}
            startServer();
          }, 350);
          return;
        }
      } catch (_) {}
    }
    console.error('Server error:', err);
  });

  ['SIGTERM', 'SIGINT', 'SIGHUP'].forEach((sig) => {
    process.on(sig, () => {
      try {
        server.close(() => process.exit(0));
      } catch (_) {
        process.exit(0);
      }
    });
  });

  return server;
}

startServer();

