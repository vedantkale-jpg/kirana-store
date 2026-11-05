/**
 * VEDANT KIRANA SHOP & POS - EXPRESS + NEON POSTGRESQL SERVER
 * Features:
 *  - Auto-loads .env file without external dependencies
 *  - High-performance Neon PostgreSQL JSONB catalog with B-Tree index on ((payload->>'price')::int)
 *  - Customer Orders & POS Billing API with Neon DB persistence
 *  - Dedicated Admin Panel Endpoints:
 *      * GET /api/admin/orders (Live order feed from Neon DB)
 *      * PATCH /api/admin/orders/:id/status (Update order status: Pending, Packed, Out for Delivery, Delivered)
 *      * GET /api/admin/analytics (Live sales, revenue, and order status counts)
 *      * POST /api/admin/products (Add new SKU to catalog)
 *      * DELETE /api/admin/products/:sku (Remove SKU from catalog)
 *  - Fallback in-memory catalog & order store if DATABASE_URL is temporarily unavailable
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { generateCatalog } = require('./database/seed_10500_items');

// 1. Auto-read .env file if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  try {
    const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
    envLines.forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || '').trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    });
    console.log("📁 Loaded environment variables from .env file.");
  } catch (e) {
    console.warn("Could not read .env file:", e.message);
  }
}

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

if (pool) {
  console.log("🔗 Neon PostgreSQL Pool initialized with DATABASE_URL.");
} else {
  console.log("⚠️ DATABASE_URL not detected. Running in Local Memory Fallback Mode.");
}

// In-memory fallback stores
let fallbackCatalog = generateCatalog(10500);
let inMemoryOrders = [
  {
    order_id: 'ORD-8841',
    customer_name: 'Rahul Khadse',
    customer_phone: '9876543210',
    customer_address: 'Flat 402, Green Valley Apartments, FC Road, Pune - 411005',
    order_mode: 'Home Delivery',
    payment_method: 'UPI (rahul@okicici)',
    payment_ref: 'pay_P9kL82mN10xKirana',
    status: 'PACKED',
    total_mrp: 156,
    total_amount: 138,
    total_savings: 18,
    created_at: new Date(Date.now() - 3600000).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
    items: [
      { sku: 'SKU-00018', name: 'Maggi 2-Minute Masala Instant Noodles', unit: '70 g Single', price: 14, qty: 2 },
      { sku: 'SKU-00002', name: 'Aashirvaad Chakki Fresh Whole Wheat Atta', unit: '1 kg', price: 48, qty: 1 },
      { sku: 'SKU-00025', name: 'Amul Pasteurized Table Butter', unit: '100 g Butter', price: 62, qty: 1 }
    ]
  }
];

// Ensure kirana_orders table exists with status column in Neon DB
async function ensureDbSchema() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kirana_orders (
        order_id VARCHAR(64) PRIMARY KEY,
        customer_name VARCHAR(120) DEFAULT 'Customer',
        customer_phone VARCHAR(32) DEFAULT '',
        customer_address TEXT DEFAULT '',
        order_mode VARCHAR(32) DEFAULT 'Counter Pickup',
        payment_method VARCHAR(64) NOT NULL,
        payment_ref VARCHAR(128) NOT NULL,
        status VARCHAR(32) DEFAULT 'NEW',
        total_mrp INT NOT NULL,
        total_amount INT NOT NULL,
        total_savings INT NOT NULL,
        items_payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      ALTER TABLE kirana_orders ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'NEW';
      ALTER TABLE kirana_orders ADD COLUMN IF NOT EXISTS customer_address TEXT DEFAULT '';
    `);
    console.log("✅ Neon DB kirana_orders table verified with status & address fields.");
  } catch (err) {
    console.error("Neon DB schema check warning:", err.message);
  }
}
ensureDbSchema();

// Health & DB Status Endpoint
app.get('/api/status', async (req, res) => {
  if (!pool) {
    return res.json({
      mode: 'LOCAL_MEMORY_FALLBACK',
      database: 'Neon PostgreSQL (Ready to connect via DATABASE_URL)',
      connected: false,
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
      connected: true,
      latency_ms: Date.now() - start,
      ...rows[0]
    });
  } catch (err) {
    res.status(500).json({ mode: 'NEON_ERROR', connected: false, error: err.message });
  }
});

// Product Catalog Search & Filtering API
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
      console.error("Neon query error, using fallback catalog:", err.message);
    }
  }

  // Fallback in-memory catalog
  const start = Date.now();
  let filtered = fallbackCatalog.filter(i => !i.hidden);
  if (under50 === 'true') filtered = filtered.filter(i => i.price < 50);
  if (maxPrice !== '') filtered = filtered.filter(i => i.price <= parseInt(maxPrice, 10));
  if (minPrice !== '') filtered = filtered.filter(i => i.price >= parseInt(minPrice, 10));
  if (category && category !== 'all') filtered = filtered.filter(i => i.category === category);
  if (brand && brand !== 'all') filtered = filtered.filter(i => i.brand === brand);
  if (q.trim()) {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    filtered = filtered.filter(i => {
      const blob = (i.sku + ' ' + i.name + ' ' + i.brand + ' ' + (i.hindi_tags || '')).toLowerCase();
      return words.every(w => blob.includes(w));
    });
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

// ============================================================================
// CUSTOMER ORDERS & CHECKOUT API
// ============================================================================

// Place New Order (Customer Checkout)
app.post('/api/orders', async (req, res) => {
  const order = req.body;
  if (!order || !order.order_id) {
    return res.status(400).json({ error: 'Invalid order payload' });
  }

  const orderRecord = {
    order_id: order.order_id,
    customer_name: order.customer_name || 'Customer',
    customer_phone: order.customer_phone || '',
    customer_address: order.customer_address || '',
    order_mode: order.order_mode || 'Counter Pickup',
    payment_method: order.payment_method || 'UPI',
    payment_ref: order.payment_ref || ('pay_' + Date.now()),
    status: order.status || 'NEW',
    total_mrp: parseInt(order.total_mrp, 10) || 0,
    total_amount: parseInt(order.total_amount, 10) || 0,
    total_savings: parseInt(order.total_savings, 10) || 0,
    items: order.items || [],
    created_at: order.created_at || new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  };

  // Always store in memory for instant local feed
  inMemoryOrders.unshift(orderRecord);

  // Persist directly into Neon PostgreSQL
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO kirana_orders (order_id, customer_name, customer_phone, customer_address, order_mode, payment_method, payment_ref, status, total_mrp, total_amount, total_savings, items_payload, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
         ON CONFLICT (order_id) DO UPDATE
         SET status = EXCLUDED.status, items_payload = EXCLUDED.items_payload`,
        [
          orderRecord.order_id,
          orderRecord.customer_name,
          orderRecord.customer_phone,
          orderRecord.customer_address,
          orderRecord.order_mode,
          orderRecord.payment_method,
          orderRecord.payment_ref,
          orderRecord.status,
          orderRecord.total_mrp,
          orderRecord.total_amount,
          orderRecord.total_savings,
          JSON.stringify(orderRecord.items)
        ]
      );
      console.log(`✅ Order #${orderRecord.order_id} successfully saved to Neon PostgreSQL table kirana_orders!`);
    } catch (err) {
      console.error("❌ Neon DB Order Insert Error:", err.message);
    }
  } else {
    console.warn(`⚠️ Order #${orderRecord.order_id} saved to Memory only (DATABASE_URL not set in PM2).`);
  }

  res.json({ status: 'ok', order_id: orderRecord.order_id });
});

// ============================================================================
// ADMIN PANEL ENDPOINTS (LIVE ORDERS, STATUS UPDATE, ANALYTICS & INVENTORY)
// ============================================================================

// 1. Live Orders Feed for Admin (Fetches from Neon DB, falls back to memory)
app.get('/api/admin/orders', async (req, res) => {
  if (pool) {
    try {
      const { rows } = await pool.query(`
        SELECT
          order_id,
          customer_name,
          customer_phone,
          customer_address,
          order_mode,
          payment_method,
          payment_ref,
          COALESCE(status, 'NEW') AS status,
          total_mrp,
          total_amount,
          total_savings,
          items_payload AS items,
          to_char(created_at, 'DD Mon YYYY, HH12:MI AM') AS created_at
        FROM kirana_orders
        ORDER BY created_at DESC
        LIMIT 100
      `);

      const dbIds = new Set(rows.map(r => r.order_id));
      const freshMemory = inMemoryOrders.filter(o => !dbIds.has(o.order_id));
      const combined = [...freshMemory, ...rows];

      return res.json({ source: 'NEON_POSTGRES_DB', count: combined.length, orders: combined });
    } catch (err) {
      console.error("Admin orders fetch error, using memory:", err.message);
    }
  }

  res.json({ source: 'IN_MEMORY_STORE', count: inMemoryOrders.length, orders: inMemoryOrders });
});

// 2. Update Order Status (NEW -> PACKED -> OUT_FOR_DELIVERY -> DELIVERED / CANCELLED)
app.patch('/api/admin/orders/:id/status', async (req, res) => {
  const orderId = req.params.id;
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'Status is required' });

  // Update in memory
  const memoryOrder = inMemoryOrders.find(o => o.order_id === orderId);
  if (memoryOrder) memoryOrder.status = status;

  // Update in Neon DB
  if (pool) {
    try {
      await pool.query(
        `UPDATE kirana_orders SET status = $1 WHERE order_id = $2`,
        [status, orderId]
      );
    } catch (err) {
      console.error("Neon DB Status Update Error:", err.message);
    }
  }

  console.log(`📦 Order #${orderId} status updated to: ${status}`);
  res.json({ status: 'ok', order_id: orderId, updated_status: status });
});

// 3. Admin Analytics & Sales Metrics
app.get('/api/admin/analytics', async (req, res) => {
  let allOrders = inMemoryOrders;

  if (pool) {
    try {
      const { rows } = await pool.query(`
        SELECT
          COUNT(*)::int AS total_orders,
          COALESCE(SUM(total_amount), 0)::int AS total_revenue,
          COUNT(*) FILTER (WHERE status = 'NEW')::int AS pending_orders,
          COUNT(*) FILTER (WHERE status = 'PACKED')::int AS packed_orders,
          COUNT(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered_orders
        FROM kirana_orders
      `);
      return res.json({ source: 'NEON_POSTGRES_DB', ...rows[0] });
    } catch (err) {
      console.error("Analytics error, calculating from memory:", err.message);
    }
  }

  const totalRevenue = allOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
  const pendingOrders = allOrders.filter(o => o.status === 'NEW').length;
  const packedOrders = allOrders.filter(o => o.status === 'PACKED' || o.status === 'OUT_FOR_DELIVERY').length;
  const deliveredOrders = allOrders.filter(o => o.status === 'DELIVERED').length;

  res.json({
    source: 'IN_MEMORY_STORE',
    total_orders: allOrders.length,
    total_revenue: totalRevenue,
    pending_orders: pendingOrders,
    packed_orders: packedOrders,
    delivered_orders: deliveredOrders
  });
});

// 4. Admin Add Custom Item to Catalog
app.post('/api/admin/products', async (req, res) => {
  const item = req.body;
  if (!item || !item.name || !item.price) {
    return res.status(400).json({ error: 'Name and price are required' });
  }

  const sku = item.sku || ('SKU-' + String(fallbackCatalog.length + 1).padStart(5, '0'));
  const fullItem = {
    sku,
    name: item.name,
    brand: item.brand || 'Kirana Select',
    category: item.category || 'staples',
    subcategory: item.subcategory || 'Store Special',
    unit: item.unit || '1 Pack',
    price: parseInt(item.price, 10),
    mrp: parseInt(item.mrp, 10) || parseInt(item.price, 10) + 5,
    stock: parseInt(item.stock, 10) || 50,
    rating: '4.8',
    is_essential: true,
    hindi_tags: item.hindi_tags || 'custom special'
  };

  fallbackCatalog.unshift(fullItem);

  if (pool) {
    try {
      await pool.query(
        `INSERT INTO kirana_catalog (sku_code, payload)
         VALUES ($1, $2::jsonb)
         ON CONFLICT (sku_code) DO UPDATE SET payload = EXCLUDED.payload`,
        [sku, JSON.stringify(fullItem)]
      );
    } catch (err) {
      console.error("Neon DB Add Item Warning:", err.message);
    }
  }

  res.json({ status: 'ok', item: fullItem });
});

// 5. Admin Remove Item from Catalog
app.delete('/api/admin/products/:sku', async (req, res) => {
  const { sku } = req.params;
  const target = fallbackCatalog.find(i => i.sku === sku);
  if (target) target.hidden = true;

  if (pool) {
    try {
      await pool.query(`DELETE FROM kirana_catalog WHERE sku_code = $1`, [sku]);
    } catch (err) {
      console.error("Neon DB Delete Item Warning:", err.message);
    }
  }

  res.json({ status: 'ok', removed_sku: sku });
});

app.listen(PORT, () => {
  console.log(`✅ Kirana Shop & POS Server running on http://localhost:${PORT}`);
});
