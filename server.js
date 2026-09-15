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

// Helper: HTTP GET with promises
function httpsGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, options, resolve).on('error', reject);
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
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
// - Disk-backed chunk caching for zero-latency replays & loops
// ================================================================
app.get('/api/stream/:fileId', (req, res) => {
  const fileId = req.params.fileId;
  if (!fileId || !/^[\w-]+$/.test(fileId)) {
    return res.status(400).send('Invalid file ID');
  }

  const cacheFile = path.join(CONFIG.cacheDir, `${fileId}.mp4`);
  const range = req.headers.range;

  // 1. FAST PATH: Serve from local disk cache if fully downloaded
  if (fs.existsSync(cacheFile)) {
    try {
      const stat = fs.statSync(cacheFile);
      const fileSize = stat.size;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize) {
          res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
          return res.end();
        }

        const chunkSize = end - start + 1;
        const fileStream = fs.createReadStream(cacheFile, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'video/mp4',
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length'
        });

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
        return fs.createReadStream(cacheFile).pipe(res);
      }
    } catch (err) {
      console.warn('Error reading cached file, falling back to Drive:', err.message);
    }
  }

  // 2. PROXIED STREAM: Stream directly from Google Drive API with Range passthrough
  const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${CONFIG.driveApiKey}`;
  const options = {
    headers: {}
  };

  if (range) {
    options.headers['Range'] = range;
  }

  https.get(driveUrl, options, (driveRes) => {
    const statusCode = driveRes.statusCode;

    // If Google Drive returns an error, forward status and error
    if (statusCode !== 200 && statusCode !== 206) {
      res.status(statusCode);
      return driveRes.pipe(res);
    }

    // Set streaming-optimized headers (explicitly omitting content-disposition and x-frame-options)
    const responseHeaders = {
      'Content-Type': driveRes.headers['content-type'] || 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length'
    };

    if (driveRes.headers['content-range']) {
      responseHeaders['Content-Range'] = driveRes.headers['content-range'];
    }
    if (driveRes.headers['content-length']) {
      responseHeaders['Content-Length'] = driveRes.headers['content-length'];
    }

    res.writeHead(statusCode, responseHeaders);
    driveRes.pipe(res);

    // Trigger background cache download if not already cached and not actively downloading
    if (!fs.existsSync(cacheFile) && !activeDownloads.has(fileId)) {
      triggerBackgroundCache(fileId, cacheFile);
    }
  }).on('error', (err) => {
    console.error(`Stream error for file ${fileId}:`, err.message);
    if (!res.headersSent) {
      res.status(502).send('Stream gateway error');
    }
  });
});

// Background cache population for instant subsequent scrubs/loops
function triggerBackgroundCache(fileId, targetPath) {
  activeDownloads.set(fileId, true);
  const tempPath = `${targetPath}.part`;
  const streamUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${CONFIG.driveApiKey}`;

  https.get(streamUrl, (res) => {
    if (res.statusCode !== 200) {
      activeDownloads.delete(fileId);
      return;
    }
    const writeStream = fs.createWriteStream(tempPath);
    res.pipe(writeStream);
    writeStream.on('finish', () => {
      writeStream.close(() => {
        try {
          fs.renameSync(tempPath, targetPath);
        } catch (e) {}
        activeDownloads.delete(fileId);
      });
    });
    writeStream.on('error', () => {
      activeDownloads.delete(fileId);
      try { fs.unlinkSync(tempPath); } catch (e) {}
    });
  }).on('error', () => {
    activeDownloads.delete(fileId);
  });
}

// ================================================================
// THUMBNAIL / POSTER PROXY (/api/poster/:fileId)
// ================================================================
app.get('/api/poster/:fileId', (req, res) => {
  const fileId = req.params.fileId;
  const thumbUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`;

  https.get(thumbUrl, (thumbRes) => {
    if (thumbRes.statusCode >= 300 && thumbRes.statusCode < 400 && thumbRes.headers.location) {
      return https.get(thumbRes.headers.location, (redirRes) => {
        res.writeHead(redirRes.statusCode, {
          'Content-Type': redirRes.headers['content-type'] || 'image/jpeg',
          'Cache-Control': 'public, max-age=604800',
          'Access-Control-Allow-Origin': '*'
        });
        redirRes.pipe(res);
      });
    }

    res.writeHead(thumbRes.statusCode, {
      'Content-Type': thumbRes.headers['content-type'] || 'image/jpeg',
      'Cache-Control': 'public, max-age=604800',
      'Access-Control-Allow-Origin': '*'
    });
    thumbRes.pipe(res);
  }).on('error', () => {
    res.status(502).end();
  });
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

app.listen(PORT, HOST, () => {
  console.log(`RAWX Motion Lab high-speed streaming server running on http://${HOST}:${PORT}`);
});
