const express = require('express');
const compression = require('compression');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Data storage directory
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Gzip compression for faster loading
app.use(compression());

// Parse JSON bodies up to 50MB (base64 images can be large)
app.use(express.json({ limit: '50mb' }));

// --- Helper: read/write JSON data ---
function getDataPath(key) {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DATA_DIR, safe + '.json');
}

function readData(key) {
  const p = getDataPath(key);
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('Error reading', key, e.message);
    return undefined;
  }
}

function writeData(key, value) {
  const p = getDataPath(key);
  fs.writeFileSync(p, JSON.stringify(value), 'utf8');
}

// --- API: GET all shared data ---
app.get('/api/data', (req, res) => {
  const keys = ['kh_products', 'kh_orders', 'kh_settings', 'kh_categories',
                '_v_kh_products', '_v_kh_orders', '_v_kh_settings', '_v_kh_categories'];
  const result = {};
  for (const key of keys) {
    const val = readData(key);
    if (val !== undefined) result[key] = val;
  }
  res.json(result);
});

// --- API: GET single key ---
app.get('/api/data/:key', (req, res) => {
  const val = readData(req.params.key);
  if (val === undefined) return res.status(404).json(null);
  res.json(val);
});

// --- API: PUT single key ---
app.put('/api/data/:key', (req, res) => {
  const { value } = req.body;
  writeData(req.params.key, value);
  res.json({ ok: true });
});

// --- API: GET products-lite (without base64 images) ---
app.get('/api/products-lite', (req, res) => {
  const products = readData('kh_products');
  if (!products || !Array.isArray(products)) return res.json([]);

  const lite = products.map(p => {
    const copy = { ...p };
    if (copy.img && copy.img.startsWith('data:')) {
      copy.img = '/api/image/' + copy.id + '/0';
    }
    if (copy.images && Array.isArray(copy.images)) {
      copy.images = copy.images.map((img, i) => {
        if (img && img.startsWith('data:')) return '/api/image/' + copy.id + '/' + i;
        return img;
      });
    }
    return copy;
  });
  res.json(lite);
});

// --- API: GET settings-lite (without hero base64) ---
app.get('/api/settings-lite', (req, res) => {
  const settings = readData('kh_settings');
  if (!settings) return res.json({});

  const copy = { ...settings };
  if (copy.heroImg && copy.heroImg.startsWith('data:')) {
    copy.heroImg = '/api/hero-image';
  }
  res.json(copy);
});

// --- API: Serve product image ---
app.get('/api/image/:productId/:index', (req, res) => {
  const products = readData('kh_products');
  if (!products || !Array.isArray(products)) return res.status(404).send('Not found');

  const product = products.find(p => p.id === req.params.productId);
  if (!product) return res.status(404).send('Not found');

  const idx = parseInt(req.params.index) || 0;
  const images = product.images || (product.img ? [product.img] : []);
  const img = images[idx];
  if (!img) return res.status(404).send('Not found');

  if (img.startsWith('data:')) {
    const match = img.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      res.set('Content-Type', match[1]);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(Buffer.from(match[2], 'base64'));
    }
  }
  res.redirect(img);
});

// --- API: Serve hero image ---
app.get('/api/hero-image', (req, res) => {
  const settings = readData('kh_settings');
  if (!settings || !settings.heroImg) return res.status(404).send('Not found');

  const img = settings.heroImg;
  if (img.startsWith('data:')) {
    const match = img.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      res.set('Content-Type', match[1]);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(Buffer.from(match[2], 'base64'));
    }
  }
  res.redirect(img);
});

// --- Ping endpoint for uptime monitoring ---
app.get('/ping', (req, res) => res.send('ok'));

// --- Serve static files with caching ---
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// --- Fallback ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('KHASAN Shop server running on port ' + PORT);
});
