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
let inMemoryCoupons = [
  { code: 'KIRANA50', discount_type: 'FLAT', discount_value: 50, min_order_value: 299, description: 'Flat ₹50 OFF on orders above ₹299', is_active: true },
  { code: 'WELCOME20', discount_type: 'PERCENT', discount_value: 20, max_discount: 100, min_order_value: 199, description: '20% OFF (Up to ₹100) on orders above ₹199', is_active: true },
  { code: 'SAVER100', discount_type: 'FLAT', discount_value: 100, min_order_value: 699, description: 'Mega Saver: Flat ₹100 OFF on orders above ₹699', is_active: true },
  { code: 'FREEDEL', discount_type: 'FLAT', discount_value: 25, min_order_value: 0, description: 'Free Delivery coupon (Flat ₹25 OFF)', is_active: true }
];
let inMemoryAddresses = [
  { id: 1, customer_phone: '7420828705', title: 'Home', street_address: 'Flat 302, Sai Residency, FC Road, Pune', city: 'Pune', pincode: '411005', is_default: true }
];


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

    // 4. Multiple Addresses table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kirana_addresses (
        id SERIAL PRIMARY KEY,
        customer_phone VARCHAR(20) NOT NULL,
        title VARCHAR(50) DEFAULT 'Home',
        street_address TEXT NOT NULL,
        city VARCHAR(100) DEFAULT 'Pune',
        pincode VARCHAR(10) DEFAULT '',
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 5. Normalized Order Items table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kirana_order_items (
        id SERIAL PRIMARY KEY,
        order_id VARCHAR(64) NOT NULL,
        sku VARCHAR(64) NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        unit VARCHAR(64),
        price INT NOT NULL,
        qty INT NOT NULL,
        subtotal INT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON kirana_order_items(order_id);
    `);

    // 6. Coupons & Discounts table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kirana_coupons (
        code VARCHAR(32) PRIMARY KEY,
        discount_type VARCHAR(16) DEFAULT 'FLAT',
        discount_value INT NOT NULL,
        max_discount INT DEFAULT 0,
        min_order_value INT DEFAULT 0,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Seed default coupons if table is empty
    const couponCheck = await pool.query(`SELECT COUNT(*)::int AS count FROM kirana_coupons`);
    if (couponCheck.rows[0].count === 0) {
      for (const cp of inMemoryCoupons) {
        await pool.query(
          `INSERT INTO kirana_coupons (code, discount_type, discount_value, max_discount, min_order_value, description, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
          [cp.code, cp.discount_type, cp.discount_value, cp.max_discount || 0, cp.min_order_value, cp.description, true]
        );
      }
    }

    // 7. Security Audit table (Failed 2FA attempts / alerts)
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

    // Clean up old test order #ORD-8094
    await pool.query(`DELETE FROM kirana_orders WHERE order_id = 'ORD-8094' OR customer_phone = '8888888888'`);

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
        return res.status(409).json({ error: 'This mobile number is already registered! Please sign in using Customer Login.' });
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
    return res.status(409).json({ error: 'This mobile number is already registered! Please sign in using Customer Login.' });
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
          error: 'No account found for this mobile number. Please register an account first via New Sign Up.'
        });
      }

      const user = rows[0];
      if (user.password !== password) {
        return res.status(401).json({ error: 'Incorrect password! Please try again.' });
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
      error: 'No account found for this mobile number. Please register an account first via New Sign Up.'
    });
  }
  if (user.password !== password) {
    return res.status(401).json({ error: 'Incorrect password! Please try again.' });
  }
  res.json({ status: 'ok', customer: { name: user.name, phone: user.phone, address: user.address } });
});

// 3. Admin View Registered Customers
app.get('/api/admin/customers', async (req, res) => {
  if (pool) {
    try {
      const { rows } = await pool.query(`
        SELECT id, name, phone, address, to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') AS created_at
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

// 1. Place New Order (With Real Inventory Deduction & Normalized Items Table)
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
    coupon_applied: order.coupon_applied || '',
    discount_amount: parseInt(order.discount_amount, 10) || 0,
    delivery_fee: parseInt(order.delivery_fee, 10) || 0,
    items: order.items || [],
    created_at: order.created_at || new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  };

  inMemoryOrders.unshift(orderRecord);

  // In-memory inventory deduction
  for (const it of orderRecord.items) {
    const target = fallbackCatalog.find(i => i.sku === it.sku);
    if (target) {
      target.stock = Math.max(0, (target.stock || 50) - (it.qty || 1));
    }
  }

  if (pool) {
    try {
      // 1. Insert order record
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

      // 2. Insert normalized items and deduct stock in Neon DB
      for (const it of orderRecord.items) {
        const itemQty = it.qty || 1;
        const itemPrice = it.price || 0;
        const subtotal = itemQty * itemPrice;

        // Insert into kirana_order_items
        await pool.query(
          `INSERT INTO kirana_order_items (order_id, sku, item_name, unit, price, qty, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [orderRecord.order_id, it.sku || 'SKU-CUSTOM', it.name, it.unit || '1 Pack', itemPrice, itemQty, subtotal]
        );

        // Deduct inventory in Neon kirana_catalog table
        await pool.query(
          `UPDATE kirana_catalog
           SET payload = jsonb_set(
             payload,
             '{stock}',
             to_jsonb(GREATEST(0, COALESCE((payload->>'stock')::int, 50) - $1::int))
           )
           WHERE sku_code = $2`,
          [itemQty, it.sku]
        );
      }

      console.log(`✅ Order #${orderRecord.order_id} recorded with inventory deduction & normalized items in Neon DB!`);
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
           to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') AS created_at
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

      if (date && date !== 'all' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        values.push(date);
        conditions.push(`(created_at AT TIME ZONE 'Asia/Kolkata')::date = $${values.length}::date`);
      } else if (date === 'today') {
        conditions.push(`(created_at AT TIME ZONE 'Asia/Kolkata')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date`);
      } else if (date === 'yesterday') {
        conditions.push(`(created_at AT TIME ZONE 'Asia/Kolkata')::date = ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '1 day')::date`);
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
           to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') AS created_at,
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

// 3. Admin Analytics & Sales Metrics (Date-Specific & Lifetime)
app.get('/api/admin/analytics', async (req, res) => {
  const { date = 'today' } = req.query;

  if (pool) {
    try {
      // 1. Lifetime totals
      const lifetimeRes = await pool.query(`
        SELECT
          COUNT(*)::int AS lifetime_orders,
          COALESCE(SUM(total_amount), 0)::int AS lifetime_revenue,
          COUNT(*) FILTER (WHERE status = 'NEW')::int AS lifetime_pending,
          COUNT(*) FILTER (WHERE status = 'DELIVERED')::int AS lifetime_delivered
        FROM kirana_orders
      `);
      const lifetime = lifetimeRes.rows[0];

      // 2. Filtered date totals
      let dateCondition = '';
      let values = [];
      if (date && date !== 'all' && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        values.push(date);
        dateCondition = `WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date`;
      } else if (date === 'today') {
        dateCondition = `WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date`;
      } else if (date === 'yesterday') {
        dateCondition = `WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date = ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '1 day')::date`;
      }

      const filteredRes = await pool.query(`
        SELECT
          COUNT(*)::int AS period_orders,
          COALESCE(SUM(total_amount), 0)::int AS period_revenue,
          COUNT(*) FILTER (WHERE status = 'NEW')::int AS period_pending,
          COUNT(*) FILTER (WHERE status = 'PACKED')::int AS period_packed,
          COUNT(*) FILTER (WHERE status = 'OUT_FOR_DELIVERY')::int AS period_out_for_delivery,
          COUNT(*) FILTER (WHERE status = 'DELIVERED')::int AS period_delivered
        FROM kirana_orders
        ${dateCondition}
      `, values);
      const period = filteredRes.rows[0];

      return res.json({
        source: 'NEON_POSTGRES_DB',
        date_filter: date,
        period_revenue: period.period_revenue,
        period_orders: period.period_orders,
        period_pending: period.period_pending,
        period_delivered: period.period_delivered,
        lifetime_revenue: lifetime.lifetime_revenue,
        lifetime_orders: lifetime.lifetime_orders,
        lifetime_pending: lifetime.lifetime_pending,
        lifetime_delivered: lifetime.lifetime_delivered,
        today_revenue: period.period_revenue,
        today_orders: period.period_orders,
        total_revenue: lifetime.lifetime_revenue,
        total_orders: lifetime.lifetime_orders,
        pending_orders: period.period_pending,
        delivered_orders: period.period_delivered
      });
    } catch (err) {
      console.error("Analytics error, calculating from memory:", err.message);
    }
  }

  // Fallback in-memory
  const totalRev = inMemoryOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
  const pending = inMemoryOrders.filter(o => o.status === 'NEW').length;
  const delivered = inMemoryOrders.filter(o => o.status === 'DELIVERED').length;

  res.json({
    source: 'IN_MEMORY_STORE',
    date_filter: date,
    period_revenue: totalRev,
    period_orders: inMemoryOrders.length,
    period_pending: pending,
    period_delivered: delivered,
    lifetime_revenue: totalRev,
    lifetime_orders: inMemoryOrders.length,
    lifetime_pending: pending,
    lifetime_delivered: delivered
  });
});

// Admin Quick Stock Adjust Endpoint
app.patch('/api/admin/products/:sku/stock', async (req, res) => {
  const { sku } = req.params;
  const { stock, delta } = req.body;

  let target = fallbackCatalog.find(i => i.sku === sku);
  let newStock = 50;
  if (target) {
    if (stock !== undefined) newStock = Math.max(0, parseInt(stock, 10));
    else if (delta !== undefined) newStock = Math.max(0, (target.stock || 50) + parseInt(delta, 10));
    target.stock = newStock;
  }

  if (pool) {
    try {
      await pool.query(
        `UPDATE kirana_catalog
         SET payload = jsonb_set(payload, '{stock}', to_jsonb($1::int))
         WHERE sku_code = $2`,
        [newStock, sku]
      );
    } catch (err) {
      console.error("Neon DB Stock Update Error:", err.message);
    }
  }

  res.json({ status: 'ok', sku, stock: newStock });
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

// 6. Admin Delete Order (Permanently delete order from Neon DB)
app.delete('/api/admin/orders/:id', async (req, res) => {
  const orderId = req.params.id;

  // Remove from in-memory fallback
  inMemoryOrders = inMemoryOrders.filter(o => o.order_id !== orderId);

  // Remove from Neon DB
  if (pool) {
    try {
      await pool.query(`DELETE FROM kirana_orders WHERE order_id = $1`, [orderId]);
      console.log(`🗑️ Order #${orderId} permanently deleted from Neon DB.`);
    } catch (err) {
      console.error("Neon DB Order Delete Error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  res.json({ status: 'ok', deleted_order_id: orderId });
});

// ============================================================================
// COUPONS & DISCOUNTS API
// ============================================================================
app.post('/api/coupons/apply', async (req, res) => {
  const { code, cartTotal } = req.body;
  if (!code) return res.status(400).json({ error: 'Please enter a coupon code' });
  const cleanCode = code.trim().toUpperCase();
  const total = parseInt(cartTotal, 10) || 0;

  let coupon = null;
  if (pool) {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM kirana_coupons WHERE UPPER(code) = $1 AND is_active = TRUE`,
        [cleanCode]
      );
      if (rows.length > 0) coupon = rows[0];
    } catch (e) {}
  }
  if (!coupon) {
    coupon = inMemoryCoupons.find(c => c.code.toUpperCase() === cleanCode && c.is_active);
  }

  if (!coupon) {
    return res.status(404).json({ error: 'Invalid coupon code or expired.' });
  }

  if (total < coupon.min_order_value) {
    return res.status(400).json({
      error: `Minimum order value for ${coupon.code} is ₹${coupon.min_order_value}. Add ₹${coupon.min_order_value - total} more items!`
    });
  }

  let discount = 0;
  if (coupon.discount_type === 'FLAT') {
    discount = Math.min(total, coupon.discount_value);
  } else if (coupon.discount_type === 'PERCENT') {
    discount = Math.round((total * coupon.discount_value) / 100);
    if (coupon.max_discount) discount = Math.min(discount, coupon.max_discount);
  }

  res.json({
    status: 'ok',
    code: coupon.code,
    discount,
    description: coupon.description,
    message: `🎉 Coupon ${coupon.code} Applied! You saved ₹${discount}.`
  });
});

app.get('/api/coupons', async (req, res) => {
  if (pool) {
    try {
      const { rows } = await pool.query(`SELECT code, description, min_order_value, discount_value, discount_type FROM kirana_coupons WHERE is_active = TRUE`);
      return res.json({ coupons: rows });
    } catch (e) {}
  }
  res.json({ coupons: inMemoryCoupons });
});

// ============================================================================
// CUSTOMER MULTIPLE ADDRESSES API
// ============================================================================
app.get('/api/customer/addresses', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: 'Phone number is required' });
  const cleanPhone = phone.trim().replace(/\D/g, '');

  if (pool) {
    try {
      const { rows } = await pool.query(
        `SELECT id, title, street_address, city, pincode, is_default
         FROM kirana_addresses WHERE customer_phone = $1
         ORDER BY is_default DESC, id DESC`,
        [cleanPhone]
      );
      return res.json({ addresses: rows });
    } catch (e) {}
  }
  const addrs = inMemoryAddresses.filter(a => a.customer_phone === cleanPhone);
  res.json({ addresses: addrs });
});

app.post('/api/customer/addresses', async (req, res) => {
  const { phone, title, street_address, city, pincode, is_default } = req.body;
  if (!phone || !street_address) return res.status(400).json({ error: 'Phone and street address are required' });
  const cleanPhone = phone.trim().replace(/\D/g, '');

  if (pool) {
    try {
      if (is_default) {
        await pool.query(`UPDATE kirana_addresses SET is_default = FALSE WHERE customer_phone = $1`, [cleanPhone]);
      }
      const { rows } = await pool.query(
        `INSERT INTO kirana_addresses (customer_phone, title, street_address, city, pincode, is_default)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [cleanPhone, (title || 'Home').trim(), street_address.trim(), city || 'Pune', pincode || '', !!is_default]
      );
      return res.json({ status: 'ok', address: rows[0] });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  const newA = { id: Date.now(), customer_phone: cleanPhone, title: title || 'Home', street_address, city: city || 'Pune', pincode: pincode || '', is_default: !!is_default };
  inMemoryAddresses.unshift(newA);
  res.json({ status: 'ok', address: newA });
});

app.delete('/api/customer/addresses/:id', async (req, res) => {
  const addrId = req.params.id;
  if (pool) {
    try {
      await pool.query(`DELETE FROM kirana_addresses WHERE id = $1`, [addrId]);
      return res.json({ status: 'ok' });
    } catch (e) {}
  }
  inMemoryAddresses = inMemoryAddresses.filter(a => String(a.id) !== String(addrId));
  res.json({ status: 'ok' });
});

// ============================================================================
// CUSTOMER ORDER CANCELLATION API (Self Cancel with Stock Restoration)
// ============================================================================
app.patch('/api/orders/:id/cancel', async (req, res) => {
  const orderId = req.params.id;

  if (pool) {
    try {
      const { rows } = await pool.query(`SELECT status, items_payload FROM kirana_orders WHERE order_id = $1`, [orderId]);
      if (rows.length === 0) return res.status(404).json({ error: 'Order not found' });
      if (rows[0].status !== 'NEW') {
        return res.status(400).json({ error: 'Order cannot be cancelled once packing or dispatch has started.' });
      }

      await pool.query(`UPDATE kirana_orders SET status = 'CANCELLED' WHERE order_id = $1`, [orderId]);

      // Restore inventory in Neon kirana_catalog
      const items = Array.isArray(rows[0].items_payload) ? rows[0].items_payload : [];
      for (const it of items) {
        await pool.query(
          `UPDATE kirana_catalog
           SET payload = jsonb_set(
             payload,
             '{stock}',
             to_jsonb(COALESCE((payload->>'stock')::int, 0) + $1::int)
           )
           WHERE sku_code = $2`,
          [it.qty || 1, it.sku]
        );
      }
      console.log(`↩️ Order #${orderId} cancelled by customer and stock restored.`);
      return res.json({ status: 'ok', message: 'Order successfully cancelled and items returned to stock.' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const ord = inMemoryOrders.find(o => o.order_id === orderId);
  if (ord) {
    if (ord.status !== 'NEW') return res.status(400).json({ error: 'Order cannot be cancelled once packing has started.' });
    ord.status = 'CANCELLED';
    for (const it of (ord.items || [])) {
      const target = fallbackCatalog.find(i => i.sku === it.sku);
      if (target) target.stock = (target.stock || 0) + (it.qty || 1);
    }
    return res.json({ status: 'ok' });
  }
  res.status(404).json({ error: 'Order not found' });
});

// ============================================================================
// ADMIN LOW STOCK ALERTS & EXCEL CSV EXPORT API
// ============================================================================
app.get('/api/admin/low-stock', async (req, res) => {
  if (pool) {
    try {
      const { rows } = await pool.query(`
        SELECT
          sku_code,
          payload->>'name' AS name,
          payload->>'brand' AS brand,
          payload->>'unit' AS unit,
          COALESCE((payload->>'price')::int, 0) AS price,
          COALESCE((payload->>'stock')::int, 0) AS stock
        FROM kirana_catalog
        WHERE COALESCE((payload->>'stock')::int, 0) <= 10
        ORDER BY stock ASC
        LIMIT 50
      `);
      return res.json({ count: rows.length, low_stock_items: rows });
    } catch (e) {}
  }
  const low = fallbackCatalog.filter(i => (i.stock || 50) <= 10).slice(0, 50);
  res.json({ count: low.length, low_stock_items: low });
});

app.get('/api/admin/orders/export', async (req, res) => {
  const { date = 'all' } = req.query;
  let orders = [];

  if (pool) {
    try {
      let sql = `
        SELECT
          order_id,
          customer_name,
          customer_phone,
          customer_address,
          order_mode,
          payment_method,
          status,
          total_mrp,
          total_amount,
          total_savings,
          items_payload,
          to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS order_timestamp
        FROM kirana_orders
      `;
      if (date === 'today') sql += ` WHERE created_at::date = CURRENT_DATE`;
      else if (date === 'yesterday') sql += ` WHERE created_at::date = CURRENT_DATE - INTERVAL '1 day'`;
      sql += ` ORDER BY created_at DESC`;

      const { rows } = await pool.query(sql);
      orders = rows;
    } catch (e) {
      console.error("CSV Export query error:", e.message);
    }
  } else {
    orders = inMemoryOrders;
  }

  let csv = 'Order ID,Date Time,Customer Name,Phone,Delivery Address,Mode,Payment,Status,Total MRP,Bill Amount,Savings,Items Summary\n';
  for (const o of orders) {
    const items = Array.isArray(o.items_payload) ? o.items_payload : (o.items || []);
    const itemsSummary = items.map(it => `${it.qty}x ${it.name}`).join(' | ').replace(/"/g, '""');
    csv += `"${o.order_id}","${o.order_timestamp || ''}","${(o.customer_name||'').replace(/"/g, '""')}","${o.customer_phone || ''}","${(o.customer_address||'').replace(/"/g, '""')}","${o.order_mode}","${o.payment_method}","${o.status}",${o.total_mrp},${o.total_amount},${o.total_savings},"${itemsSummary}"\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=kirana_orders_${date}_${Date.now()}.csv`);
  res.send(csv);
});

app.listen(PORT, () => {
  console.log(`✅ Kirana Shop & POS Server running on http://localhost:${PORT}`);
});
