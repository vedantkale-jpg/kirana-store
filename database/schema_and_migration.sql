-- ============================================================================
-- VEDANT KIRANA STORE & POS SYSTEM (kirana1.vedant.com)
-- Architecture: Neon Serverless PostgreSQL (JSONB Master & Local Shop Catalog)
-- SRS Compliance: JSONB storage, B-Tree expression index on ((payload->>'price')::int),
-- GIN full-text/JSONB indexing, and high-performance jsonb_to_recordset unnesting
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Main Kirana Catalog Table using native JSONB storage
CREATE TABLE IF NOT EXISTS kirana_catalog (
    id BIGSERIAL PRIMARY KEY,
    sku_code VARCHAR(32) UNIQUE NOT NULL,
    shop_id VARCHAR(64) NOT NULL DEFAULT 'vedant_main_store',
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Specialized B-Tree Expression Index on Numeric Price Extraction
-- Accelerates sub-50 rupee filtering: WHERE ((payload->>'price')::int) < 50
CREATE INDEX IF NOT EXISTS idx_kirana_price_btree
ON kirana_catalog (((payload->>'price')::int));

-- 3. B-Tree Expression Index on Category for Instant Category Tabs
CREATE INDEX IF NOT EXISTS idx_kirana_category_btree
ON kirana_catalog ((payload->>'category'));

-- 4. GIN Index on JSONB payload + Trigram Index on Product Name & Hindi Keywords
CREATE INDEX IF NOT EXISTS idx_kirana_payload_gin
ON kirana_catalog USING GIN (payload jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_kirana_search_trgm
ON kirana_catalog USING GIN (((payload->>'name') || ' ' || COALESCE(payload->>'brand', '') || ' ' || COALESCE(payload->>'hindi_tags', '')) gin_trgm_ops);

-- 5. High-Performance Bulk Unnesting & Migration Procedure (for 10,000 to 600,000 SKUs)
-- Takes a raw JSONB array dump and bulk-upserts records using jsonb_to_recordset()
CREATE OR REPLACE PROCEDURE bulk_load_kirana_jsonb(raw_json_batch JSONB, target_shop VARCHAR DEFAULT 'vedant_main_store')
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO kirana_catalog (sku_code, shop_id, payload, updated_at)
    SELECT
        item.sku,
        target_shop,
        jsonb_build_object(
            'sku', item.sku,
            'name', item.name,
            'brand', item.brand,
            'category', item.category,
            'subcategory', item.subcategory,
            'unit', item.unit,
            'price', item.price,
            'mrp', item.mrp,
            'stock', item.stock,
            'hindi_tags', item.hindi_tags,
            'rating', item.rating,
            'is_essential', COALESCE(item.is_essential, true)
        ),
        NOW()
    FROM jsonb_to_recordset(raw_json_batch) AS item(
        sku TEXT,
        name TEXT,
        brand TEXT,
        category TEXT,
        subcategory TEXT,
        unit TEXT,
        price INT,
        mrp INT,
        stock INT,
        hindi_tags TEXT,
        rating NUMERIC,
        is_essential BOOLEAN
    )
    ON CONFLICT (sku_code) DO UPDATE
    SET payload = EXCLUDED.payload,
        updated_at = NOW();
END;
$$;

-- 6. Orders & POS Billing Table (with Razorpay / UPI Payment Gateway tracking)
CREATE TABLE IF NOT EXISTS kirana_orders (
    order_id VARCHAR(64) PRIMARY KEY,
    customer_name VARCHAR(120) DEFAULT 'Walk-in Customer',
    customer_phone VARCHAR(32) DEFAULT '',
    order_mode VARCHAR(32) DEFAULT 'POS_COUNTER',
    payment_method VARCHAR(32) NOT NULL,
    payment_ref VARCHAR(128) NOT NULL,
    total_mrp INT NOT NULL,
    total_amount INT NOT NULL,
    total_savings INT NOT NULL,
    items_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- SAMPLE HIGH-PERFORMANCE QUERIES (SRS VERIFICATION)
-- ============================================================================

-- Query A: Sub-50 Rupee Fast Filtering (Uses idx_kirana_price_btree)
-- EXPLAIN ANALYZE
-- SELECT sku_code, payload->>'name' AS item_name, (payload->>'price')::int AS price
-- FROM kirana_catalog
-- WHERE ((payload->>'price')::int) < 50
-- ORDER BY ((payload->>'price')::int) ASC
-- LIMIT 40 OFFSET 0;

-- Query B: Combined Search + Category + Sub-50 Filter
-- SELECT sku_code, payload
-- FROM kirana_catalog
-- WHERE ((payload->>'price')::int) <= 50
--   AND (payload->>'category') = 'snacks'
--   AND ((payload->>'name') || ' ' || COALESCE(payload->>'hindi_tags', '')) ILIKE '%maggi%'
-- ORDER BY ((payload->>'price')::int) ASC
-- LIMIT 40;
