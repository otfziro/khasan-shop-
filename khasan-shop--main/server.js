const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB error:", err.message);
    process.exit(1);
  }
};
const express = require('express');
const compression = require('compression');
const { MongoClient } = require('mongodb');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = 'khasan_shop';

let db;

// Connect to MongoDB
async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log('Connected to MongoDB');
}

// Gzip compression for faster loading
app.use(compression());

// Parse JSON bodies up to 50MB (base64 images can be large)
app.use(express.json({ limit: '50mb' }));

// --- Helper: read/write data from MongoDB ---
async function readData(key) {
  const doc = await db.collection('data').findOne({ _key: key });
  return doc ? doc.value : undefined;
}

async function writeData(key, value) {
  await db.collection('data').updateOne(
    { _key: key },
    { $set: { _key: key, value: value } },
    { upsert: true }
  );
}

// --- API: GET all shared data ---
app.get('/api/data', async (req, res) => {
  try {
    const keys = ['kh_products', 'kh_orders', 'kh_settings', 'kh_categories',
                  '_v_kh_products', '_v_kh_orders', '_v_kh_settings', '_v_kh_categories'];
    const result = {};
    for (const key of keys) {
      const val = await readData(key);
      if (val !== undefined) result[key] = val;
    }
    res.json(result);
  } catch (e) {
    console.error('GET /api/data error:', e.message);
    res.status(500).json({});
  }
});

// --- API: GET single key ---
app.get('/api/data/:key', async (req, res) => {
  try {
    const val = await readData(req.params.key);
    if (val === undefined) return res.status(404).json(null);
    res.json(val);
  } catch (e) {
    res.status(500).json(null);
  }
});

// --- API: PUT single key ---
app.put('/api/data/:key', async (req, res) => {
  try {
    await writeData(req.params.key, req.body.value);
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT error:', e.message);
    res.status(500).json({ ok: false });
  }
});

// --- API: GET products-lite (without base64 images) ---
app.get('/api/products-lite', async (req, res) => {
  try {
    const products = await readData('kh_products');
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
  } catch (e) {
    res.json([]);
  }
});

// --- API: GET settings-lite (without hero base64) ---
app.get('/api/settings-lite', async (req, res) => {
  try {
    const settings = await readData('kh_settings');
    if (!settings) return res.json({});
    const copy = { ...settings };
    if (copy.heroImg && copy.heroImg.startsWith('data:')) {
      copy.heroImg = '/api/hero-image';
    }
    res.json(copy);
  } catch (e) {
    res.json({});
  }
});

// --- API: Serve product image ---
app.get('/api/image/:productId/:index', async (req, res) => {
  try {
    const products = await readData('kh_products');
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
  } catch (e) {
    res.status(500).send('Error');
  }
});

// --- API: Serve hero image ---
app.get('/api/hero-image', async (req, res) => {
  try {
    const settings = await readData('kh_settings');
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
  } catch (e) {
    res.status(500).send('Error');
  }
});

// --- Ping endpoint for uptime monitoring ---
app.get('/ping', (req, res) => res.send('ok'));

// --- Serve static files with caching ---
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// --- Fallback ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start server after DB connection ---
connectDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('KHASAN Shop server running on port ' + PORT);
  });
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err.message);
  process.exit(1);
});
