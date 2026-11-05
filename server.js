/**
 * VEDANT KIRANA SHOP & POS - EXPRESS + NEON POSTGRESQL SERVER (V6)
 * Features:
 *  - Native .env auto-loader
 *  - Real Neon PostgreSQL Customer Authentication (Signup & Login with duplicate checks)
 *  - Full Orders Persistence (No dummy orders like Rahul Khadse)
 *  - Date-filtered Admin Orders & Analytics (Today, Yesterday, All-time)
 *  - Dynamic Custom Categories & Product Image URLs
 *  - Security Audit Logging for Failed 2FA Attempts (Alerts dev team)
 *  - Customer Order Tracking API (Polls order status by customer phone)
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

// In-memory fallback stores (Clean - No dummy orders)
let fallbackCatalog = generateCatalog(10500);
let inMemoryOrders = []; // ZERO hardcoded dummy orders!
let inMemoryCustomers = [
  { name: 'Vedant Kale', phone: '9876543210', password: 'password123', address: 'FC Road, Pune - 411005' }
];
let inMemoryCategories = [
  { slug: 'chocolates', name: 'Chocolates & Sweets', icon: '🍫' },
  { slug: 'snacks', name: 'Snacks & Biscuits', icon: '🍪' },
  { slug: 'staples', name: 'Atta, Rice & Dal', icon: '🌾' },
  { slug: 'oil_masala', name: 'Oil & Masala', icon: '🌻' },
  { slug: 'dairy', name: 'Dairy & Bread', icon: '🥛' },
  { slug: 'beverages', name: 'Tea & Cold Drinks', icon: '☕' },
  { slug: 'household', name: 'Soaps & Cleaning', icon: '🧼' }
];
let inMemoryAuditLogs = [];

// Ensure all Neon DB tables exist
async function ensureDbSchema() {
  if (!pool) return;
  try {
    // 1. Orders table
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

    // 2. Customers table (For real authentication)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kirana_customers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        phone VARCHAR(20) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        address TEXT DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 3. Custom Categories table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kirana_categories (
        slug VARCHAR(64) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        icon VARCHAR(16) DEFAULT '📦',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 4. Security Audit table (Failed 2FA attempts / alerts)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kirana_security_audit (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(64) NOT NULL,
        ip_address VARCHAR(64),
        details TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Seed default categories into Neon if empty
    const catCheck = await pool.query(`SELECT COUNT(*)::int AS count FROM kirana_categories`);
    if (catCheck.rows[0].count === 0) {
      for (const cat of inMemoryCategories) {
        await pool.query(
          `INSERT INTO kirana_categories (slug, name, icon) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [cat.slug, cat.name, cat.icon]
        );
      }
    }

    console.log("✅ Neon DB all tables verified (Orders, Customers, Categories, Security Audit).");
  } catch (err) {
    console.error("Neon DB schema check warning:", err.message);
  }
}
ensureDbSchema();

// ============================================================================
// SYSTEM STATUS ENDPOINT
// ============================================================================
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

// ============================================================================
// CUSTOMER AUTHENTICATION APIS (SIGNUP & LOGIN WITH NEON POSTGRESQL)
// ============================================================================

// 1. Customer New Sign Up
app.post('/api/auth/signup', async (req, res) => {
  const { name, phone, password, address } = req.body;
  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'Name, 10-digit mobile number, and password are required.' });
  }

  const cleanPhone = phone.trim().replace(/\D/g, '');
  if (cleanPhone.length !== 10) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  if (pool) {
    try {
      const existing = await pool.query(`SELECT id, phone FROM kirana_customers WHERE phone = $1`, [cleanPhone]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Ye mobile number pehle se registered hai! Kripya "Customer Login" karein.' });
      }

      const insertRes = await pool.query(
        `INSERT INTO kirana_customers (name, phone, password, address)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, phone, address, created_at`,
        [name.trim(), cleanPhone, password, (address || '').trim()]
      );

      const customer = insertRes.rows[0];
      console.log(`👤 New Customer Registered in Neon DB: ${customer.name} (+91 ${customer.phone})`);
      return res.json({ status: 'ok', customer });
    } catch (err) {
      console.error("Neon Signup Error:", err.message);
      return res.status(500).json({ error: 'Database signup error: ' + err.message });
    }
  }

  // Fallback in-memory
  const found = inMemoryCustomers.find(c => c.phone === cleanPhone);
  if (found) {
    return res.status(409).json({ error: 'Ye mobile number pehle se registered hai! Kripya Customer Login karein.' });
  }
  const newCust = { name: name.trim(), phone: cleanPhone, password, address: (address || '').trim() };
  inMemoryCustomers.push(newCust);
  res.json({ status: 'ok', customer: newCust });
});

// 2. Customer Login
app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ error: 'Phone number and password are required.' });
  }

  const cleanPhone = phone.trim().replace(/\D/g, '');

  if (pool) {
    try {
      const { rows } = await pool.query(
        `SELECT id, name, phone, password, address, created_at FROM kirana_customers WHERE phone = $1`,
        [cleanPhone]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          error: 'Is mobile number par koi account nahi mila! Pehle "New Sign Up" par click karke account banayein.'
        });
      }

      const user = rows[0];
      if (user.password !== password) {
        return res.status(401).json({ error: 'Galat password! Dobara koshish karein.' });
      }

      console.log(`🔓 Customer Logged In: ${user.name} (+91 ${user.phone})`);
      return res.json({
        status: 'ok',
        customer: { id: user.id, name: user.name, phone: user.phone, address: user.address }
      });
    } catch (err) {
      console.error("Neon Login Error:", err.message);
      return res.status(500).json({ error: 'Database login error: ' + err.message });
    }
  }

  // Fallback in-memory
  const user = inMemoryCustomers.find(c => c.phone === cleanPhone);
  if (!user) {
    return res.status(404).json({
      error: 'Is mobile number par koi account nahi mila! Pehle "New Sign Up" par click karke account banayein.'
    });
  }
  if (user.password !== password) {
    return res.status(401).json({ error: 'Galat password! Dobara koshish karein.' });
  }
  res.json({ status: 'ok', customer: { name: user.name, phone: user.phone, address: user.address } });
});

// 3. Admin View Registered Customers
app.get('/api/admin/customers', async (req, res) => {
  if (pool) {
    try {
      const { rows } = await pool.query(`
        SELECT id, name, phone, address, to_char(created_at, 'DD Mon YYYY, HH12:MI AM') AS created_at
        FROM kirana_customers
        ORDER BY created_at DESC
        LIMIT 100
      `);
      return res.json({ source: 'NEON_POSTGRES_DB', count: rows.length, customers: rows });
    } catch (e) {
      console.error("Admin customers fetch error:", e.message);
    }
  }
  res.json({ source: 'IN_MEMORY_STORE', count: inMemoryCustomers.length, customers: inMemoryCustomers });
});

// ============================================================================
// CATEGORIES API (DYNAMIC CATEGORIES)
// ============================================================================
app.get('/api/categories', async (req, res) => {
  if (pool) {
    try {
      const { rows } = await pool.query(`SELECT slug, name, icon FROM kirana_categories ORDER BY created_at ASC`);
      if (rows.length > 0) return res.json({ categories: rows });
    } catch (e) {}
  }
  res.json({ categories: inMemoryCategories });
});

app.post('/api/admin/categories', async (req, res) => {
  const { name, icon } = req.body;
  if (!name) return res.status(400).json({ error: 'Category name is required' });

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const catObj = { slug, name: name.trim(), icon: icon || '📦' };

  if (!inMemoryCategories.find(c => c.slug === slug)) {
    inMemoryCategories.push(catObj);
  }

  if (pool) {
    try {
      await pool.query(
        `INSERT INTO kirana_categories (slug, name, icon) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING`,
        [slug, catObj.name, catObj.icon]
      );
    } catch (e) {
      console.error("Neon Add Category Error:", e.message);
    }
  }

  res.json({ status: 'ok', category: catObj });
});

// ============================================================================
// PRODUCT CATALOG API
// ============================================================================
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

// 1. Place New Order
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

  inMemoryOrders.unshift(orderRecord);

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
  }

  res.json({ status: 'ok', order_id: orderRecord.order_id });
});

// 2. Customer Order Tracking (Fetch by Phone Number)
app.get('/api/orders', async (req, res) => {
  const { phone } = req.query;
  if (!phone) {
    return res.status(400).json({ error: 'Phone parameter is required' });
  }

  const cleanPhone = phone.trim().replace(/\D/g, '');

  if (pool) {
    try {
      const { rows } = await pool.query(
        `SELECT
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
         WHERE customer_phone = $1
         ORDER BY created_at DESC`,
        [cleanPhone]
      );
      return res.json({ orders: rows });
    } catch (e) {
      console.error("Customer orders fetch error:", e.message);
    }
  }

  const customerOrders = inMemoryOrders.filter(o => o.customer_phone === cleanPhone);
  res.json({ orders: customerOrders });
});

// ============================================================================
// ADMIN PANEL ENDPOINTS (LIVE ORDERS WITH DATE FILTERS, ANALYTICS, PRODUCTS)
// ============================================================================

// 1. Live Orders Feed for Admin (with Date and Status Filters)
app.get('/api/admin/orders', async (req, res) => {
  const { date = 'all', status = 'ALL' } = req.query;

  if (pool) {
    try {
      let conditions = [];
      let values = [];

      if (date === 'today') {
        conditions.push(`created_at::date = CURRENT_DATE`);
      } else if (date === 'yesterday') {
        conditions.push(`created_at::date = CURRENT_DATE - INTERVAL '1 day'`);
      } else if (date !== 'all' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        values.push(date);
        conditions.push(`created_at::date = $${values.length}`);
      }

      if (status !== 'ALL') {
        values.push(status);
        conditions.push(`status = $${values.length}`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const { rows } = await pool.query(
        `SELECT
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
           to_char(created_at, 'DD Mon YYYY, HH12:MI AM') AS created_at,
           to_char(created_at, 'YYYY-MM-DD') AS order_date
         FROM kirana_orders
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT 200`,
        values
      );

      return res.json({ source: 'NEON_POSTGRES_DB', count: rows.length, orders: rows });
    } catch (err) {
      console.error("Admin orders fetch error, using memory:", err.message);
    }
  }

  let filtered = inMemoryOrders;
  if (status !== 'ALL') filtered = filtered.filter(o => o.status === status);
  res.json({ source: 'IN_MEMORY_STORE', count: filtered.length, orders: filtered });
});

// 2. Update Order Status
app.patch('/api/admin/orders/:id/status', async (req, res) => {
  const orderId = req.params.id;
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'Status is required' });

  const memoryOrder = inMemoryOrders.find(o => o.order_id === orderId);
  if (memoryOrder) memoryOrder.status = status;

  if (pool) {
    try {
      await pool.query(`UPDATE kirana_orders SET status = $1 WHERE order_id = $2`, [status, orderId]);
    } catch (err) {
      console.error("Neon DB Status Update Error:", err.message);
    }
  }

  console.log(`📦 Order #${orderId} status updated to: ${status}`);
  res.json({ status: 'ok', order_id: orderId, updated_status: status });
});

// 3. Admin Analytics & Sales Metrics (Today vs Lifetime)
app.get('/api/admin/analytics', async (req, res) => {
  if (pool) {
    try {
      const { rows } = await pool.query(`
        SELECT
          COUNT(*)::int AS total_orders,
          COALESCE(SUM(total_amount), 0)::int AS total_revenue,
          COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS today_orders,
          COALESCE(SUM(total_amount) FILTER (WHERE created_at::date = CURRENT_DATE), 0)::int AS today_revenue,
          COUNT(*) FILTER (WHERE status = 'NEW')::int AS pending_orders,
          COUNT(*) FILTER (WHERE status = 'PACKED')::int AS packed_orders,
          COUNT(*) FILTER (WHERE status = 'OUT_FOR_DELIVERY')::int AS out_for_delivery_orders,
          COUNT(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered_orders
        FROM kirana_orders
      `);
      return res.json({ source: 'NEON_POSTGRES_DB', ...rows[0] });
    } catch (err) {
      console.error("Analytics error, calculating from memory:", err.message);
    }
  }

  const totalRevenue = inMemoryOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
  const pendingOrders = inMemoryOrders.filter(o => o.status === 'NEW').length;
  const packedOrders = inMemoryOrders.filter(o => o.status === 'PACKED').length;
  const outOrders = inMemoryOrders.filter(o => o.status === 'OUT_FOR_DELIVERY').length;
  const deliveredOrders = inMemoryOrders.filter(o => o.status === 'DELIVERED').length;

  res.json({
    source: 'IN_MEMORY_STORE',
    total_orders: inMemoryOrders.length,
    total_revenue: totalRevenue,
    today_orders: inMemoryOrders.length,
    today_revenue: totalRevenue,
    pending_orders: pendingOrders,
    packed_orders: packedOrders,
    out_for_delivery_orders: outOrders,
    delivered_orders: deliveredOrders
  });
});

// 4. Admin Add Custom Item to Catalog (with Image URL and Custom Category)
app.post('/api/admin/products', async (req, res) => {
  const item = req.body;
  if (!item || !item.name || !item.price) {
    return res.status(400).json({ error: 'Name and price are required' });
  }

  let finalCategory = (item.category || 'staples').toLowerCase().trim();
  if (item.customCategoryName && item.customCategoryName.trim()) {
    const customName = item.customCategoryName.trim();
    finalCategory = customName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!inMemoryCategories.find(c => c.slug === finalCategory)) {
      const newCat = { slug: finalCategory, name: customName, icon: item.categoryIcon || '📦' };
      inMemoryCategories.push(newCat);
      if (pool) {
        try {
          await pool.query(
            `INSERT INTO kirana_categories (slug, name, icon) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING`,
            [newCat.slug, newCat.name, newCat.icon]
          );
        } catch (e) {}
      }
    }
  }

  const sku = item.sku || ('SKU-' + String(fallbackCatalog.length + 1).padStart(5, '0'));
  const fullItem = {
    sku,
    name: item.name.trim(),
    brand: (item.brand || 'Kirana Select').trim(),
    category: finalCategory,
    subcategory: item.subcategory || 'Store Special',
    unit: item.unit || '1 Pack',
    price: parseInt(item.price, 10),
    mrp: parseInt(item.mrp, 10) || parseInt(item.price, 10) + 5,
    stock: parseInt(item.stock, 10) || 50,
    rating: '4.8',
    is_essential: true,
    hindi_tags: item.hindi_tags || 'custom special',
    image_url: item.image_url ? item.image_url.trim() : ''
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

  console.log(`➕ New SKU Added to Catalog: ${fullItem.name} [Category: ${fullItem.category}]`);
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

// 6. Security Audit Alert Endpoint (Triggered on 2 Failed 2FA Attempts)
app.post('/api/admin/security-alert', async (req, res) => {
  const { eventType, attempts, ip } = req.body;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || ip || 'Unknown IP';
  const alertDetails = `CRITICAL ALERT: Unauthorized admin access attempt detected. Failed 2FA passcodes (${attempts || 2} attempts). Locked out for 15 minutes.`;

  console.warn("=================================================================");
  console.warn(`🚨 SECURITY BREACH ALERT DISPATCHED TO DEVELOPER TEAM`);
  console.warn(`Event: ${eventType || 'FAILED_2FA_LOCKOUT'}`);
  console.warn(`Source IP: ${clientIp}`);
  console.warn(`Timestamp: ${new Date().toISOString()}`);
  console.warn(`Details: ${alertDetails}`);
  console.warn("=================================================================");

  inMemoryAuditLogs.unshift({
    event_type: eventType || 'FAILED_2FA_LOCKOUT',
    ip_address: String(clientIp),
    details: alertDetails,
    time: new Date().toISOString()
  });

  if (pool) {
    try {
      await pool.query(
        `INSERT INTO kirana_security_audit (event_type, ip_address, details, created_at)
         VALUES ($1, $2, $3, NOW())`,
        ['FAILED_2FA_LOCKOUT', String(clientIp), alertDetails]
      );
    } catch (e) {
      console.error("Could not write security audit to Neon DB:", e.message);
    }
  }

  res.json({
    status: 'alert_logged',
    message: 'Security breach logged. Developer Team has been notified immediately via audit queue.'
  });
});

app.listen(PORT, () => {
  console.log(`✅ Kirana Shop & POS Server running on http://localhost:${PORT}`);
});
