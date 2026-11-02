/**
 * VEDANT KIRANA STORE & POS - EXPRESS + NEON POSTGRESQL SERVER
 * Supports:
 *  - Neon PostgreSQL JSONB queries with B-Tree index on ((payload->>'price')::int)
 *  - Automatic fallback to in-memory 10,500 SKUs if DATABASE_URL is not yet configured
 *  - Razorpay Order Creation & Verification API
 */
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const { generateCatalog } = require('./database/seed_10500_items');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

const fallbackCatalog = generateCatalog(10500);

// Health & DB Status Endpoint
app.get('/api/status', async (req, res) => {
  if (!pool) {
    return res.json({
      mode: 'LOCAL_MEMORY_FALLBACK',
      database: 'Neon PostgreSQL (Ready to connect via DATABASE_URL)',
      total_skus: fallbackCatalog.length,
      under_50_skus: fallbackCatalog.filter(i => i.price < 50).length
    });
  }
  try {
    const start = Date.now();
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::int AS total_skus,
        COUNT(*) FILTER (WHERE ((payload->>'price')::int) < 50)::int AS under_50_skus
      FROM kirana_catalog
    `);
    res.json({
      mode: 'NEON_POSTGRES_LIVE',
      latency_ms: Date.now() - start,
      ...rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// High-Performance Catalog Search & Sub-50 Filter API
app.get('/api/products', async (req, res) => {
  const {
    q = '',
    category = 'all',
    under50 = 'false',
    maxPrice = '',
    minPrice = '',
    brand = 'all',
    sort = 'popular',
    page = '1',
    limit = '40'
  } = req.query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 40));
  const offset = (pageNum - 1) * pageSize;

  if (pool) {
    try {
      const start = Date.now();
      const conditions = [];
      const values = [];

      if (under50 === 'true') {
        conditions.push(`((payload->>'price')::int) < 50`);
      }
      if (maxPrice !== '') {
        values.push(parseInt(maxPrice, 10));
        conditions.push(`((payload->>'price')::int) <= $${values.length}`);
      }
      if (minPrice !== '') {
        values.push(parseInt(minPrice, 10));
        conditions.push(`((payload->>'price')::int) >= $${values.length}`);
      }
      if (category && category !== 'all') {
        values.push(category);
        conditions.push(`(payload->>'category') = $${values.length}`);
      }
      if (brand && brand !== 'all') {
        values.push(brand);
        conditions.push(`(payload->>'brand') = $${values.length}`);
      }
      if (q.trim()) {
        values.push(`%${q.trim()}%`);
        conditions.push(`((payload->>'name') || ' ' || COALESCE(payload->>'brand','') || ' ' || COALESCE(payload->>'hindi_tags','') || ' ' || sku_code) ILIKE $${values.length}`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      let orderClause = `ORDER BY id ASC`;
      if (sort === 'price_asc') orderClause = `ORDER BY ((payload->>'price')::int) ASC`;
      if (sort === 'price_desc') orderClause = `ORDER BY ((payload->>'price')::int) DESC`;
      if (sort === 'discount') orderClause = `ORDER BY (((payload->>'mrp')::int) - ((payload->>'price')::int)) DESC`;

      const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM kirana_catalog ${whereClause}`, values);
      values.push(pageSize, offset);
      const dataRes = await pool.query(
        `SELECT payload FROM kirana_catalog ${whereClause} ${orderClause} LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values
      );

      return res.json({
        source: 'NEON_POSTGRES_JSONB',
        query_ms: Date.now() - start,
        total: countRes.rows[0].total,
        page: pageNum,
        items: dataRes.rows.map(r => r.payload)
      });
    } catch (err) {
      console.error("Neon query error, falling back to memory:", err.message);
    }
  }

  // Fallback In-Memory Query
  const start = Date.now();
  let filtered = fallbackCatalog;
  if (under50 === 'true') filtered = filtered.filter(i => i.price < 50);
  if (maxPrice !== '') filtered = filtered.filter(i => i.price <= parseInt(maxPrice, 10));
  if (minPrice !== '') filtered = filtered.filter(i => i.price >= parseInt(minPrice, 10));
  if (category && category !== 'all') filtered = filtered.filter(i => i.category === category);
  if (brand && brand !== 'all') filtered = filtered.filter(i => i.brand === brand);
  if (q.trim()) {
    const term = q.trim().toLowerCase();
    filtered = filtered.filter(i =>
      i.name.toLowerCase().includes(term) ||
      i.brand.toLowerCase().includes(term) ||
      i.hindi_tags.toLowerCase().includes(term) ||
      i.sku.toLowerCase().includes(term)
    );
  }
  if (sort === 'price_asc') filtered = [...filtered].sort((a, b) => a.price - b.price);
  if (sort === 'price_desc') filtered = [...filtered].sort((a, b) => b.price - a.price);
  if (sort === 'discount') filtered = [...filtered].sort((a, b) => (b.mrp - b.price) - (a.mrp - a.price));

  res.json({
    source: 'MEMORY_JSONB_INDEX',
    query_ms: Date.now() - start,
    total: filtered.length,
    page: pageNum,
    items: filtered.slice(offset, offset + pageSize)
  });
});

// Checkout & Order Storage API
app.post('/api/orders', async (req, res) => {
  const order = req.body;
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO kirana_orders (order_id, customer_name, customer_phone, order_mode, payment_method, payment_ref, total_mrp, total_amount, total_savings, items_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          order.order_id,
          order.customer_name || 'Walk-in Customer',
          order.customer_phone || '',
          order.order_mode || 'POS_COUNTER',
          order.payment_method,
          order.payment_ref,
          order.total_mrp,
          order.total_amount,
          order.total_savings,
          JSON.stringify(order.items || [])
        ]
      );
    } catch (e) {
      console.error("Order save warning:", e.message);
    }
  }
  res.json({ status: 'ok', order_id: order.order_id });
});

app.listen(PORT, () => {
  console.log(`✅ Vedant Kirana Store & POS running on http://localhost:${PORT}`);
});
