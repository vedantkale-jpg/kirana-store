/**
 * VEDANT KIRANA STORE - 10,500+ SKU NEON POSTGRESQL SEEDER
 * Usage:
 *   export DATABASE_URL="postgresql://user:pass@ep-xyz.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
 *   node database/seed_10500_items.js
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

if (!process.env.DATABASE_URL) {
  console.error("❌ Please set DATABASE_URL environment variable from your Neon.tech dashboard!");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const CATALOG_TEMPLATES = [
  // Staples (Atta, Rice, Dal, Sugar, Salt)
  { cat: 'staples', sub: 'Atta & Flours', base: 'Chakki Fresh Whole Wheat Atta', brands: ['Aashirvaad', 'Fortune', 'Pillsbury', 'Patanjali', 'Nature Fresh', 'Annapurna'], tags: 'atta gehu flour chapati roti', units: [['500 g', 28, 32], ['1 kg', 48, 56], ['5 kg', 235, 265], ['10 kg', 445, 495]] },
  { cat: 'staples', sub: 'Rice & Basmati', base: 'Rozana Super Basmati Rice', brands: ['India Gate', 'Daawat', 'Fortune', 'Kohinoor', 'Lal Qilla', 'Charminar'], tags: 'chawal rice basmati biryani pulao', units: [['500 g', 42, 49], ['1 kg', 79, 95], ['5 kg', 375, 440]] },
  { cat: 'staples', sub: 'Rice & Basmati', base: 'Kolam / Sona Masoori Steam Rice', brands: ['Deccan', ' Vedant Select', '24 Mantra', 'Royal', 'Surti Kolam'], tags: 'chawal kolam sona masoori daily rice', units: [['500 g', 30, 35], ['1 kg', 58, 68], ['5 kg', 280, 320]] },
  { cat: 'staples', sub: 'Dal & Pulses', base: 'Unpolished Toor / Arhar Dal', brands: ['Tata Sampann', 'Fortune', '24 Mantra', 'Vedant Kirana', 'Organic Tattva'], tags: 'toor dal arhar tuvar yellow lentils', units: [['250 g', 38, 45], ['500 g', 74, 86], ['1 kg', 145, 168]] },
  { cat: 'staples', sub: 'Dal & Pulses', base: 'Yellow Moong Dal Chilka / Dhuli', brands: ['Tata Sampann', 'Fortune', 'Vedant Kirana', 'Rajdhani', 'bb Royal'], tags: 'moong dal mung khichdi pulse', units: [['250 g', 32, 38], ['500 g', 62, 72], ['1 kg', 118, 135]] },
  { cat: 'staples', sub: 'Dal & Pulses', base: 'Chana Dal & Kabuli Chana', brands: ['Tata Sampann', 'Rajdhani', 'Fortune', 'Vedant Kirana'], tags: 'chana dal besan chole kabuli kala chana', units: [['250 g', 26, 32], ['500 g', 48, 56], ['1 kg', 92, 108]] },
  { cat: 'staples', sub: 'Dal & Pulses', base: 'Thick Poha / Aval Flattened Rice', brands: ['Tata Sampann', 'Rajdhani', 'Indori Choice', 'Vedant Select'], tags: 'poha kanda poha breakfast पोहा', units: [['250 g', 18, 22], ['500 g', 34, 42], ['1 kg', 64, 78]] },
  { cat: 'staples', sub: 'Sugar, Salt & Jaggery', base: 'Vacuum Evaporated Iodised Salt', brands: ['Tata Salt', 'Aashirvaad', 'Saffola', 'Catch', 'Patanjali'], tags: 'namak salt sendha kala namak', units: [['500 g', 14, 16], ['1 kg', 25, 28]] },
  { cat: 'staples', sub: 'Sugar, Salt & Jaggery', base: 'Sulphurless Crystal White Sugar', brands: ['Madhur', 'Trust', 'Dhampure', 'Vedant Loose Pack', 'Parry'], tags: 'chini sugar shakkar gud jaggery', units: [['250 g', 14, 16], ['500 g', 26, 30], ['1 kg', 48, 55], ['5 kg', 235, 260]] },
  { cat: 'staples', sub: 'Flours & Sooji', base: 'Fine Besan & Roasted Rava Sooji', brands: ['Rajdhani', 'Tata Sampann', 'Fortune', 'Aashirvaad'], tags: 'besan sooji rava maida pakoda upma', units: [['200 g', 22, 26], ['500 g', 45, 54], ['1 kg', 88, 105]] },

  // Masala, Oil & Dry Fruits
  { cat: 'oil_masala', sub: 'Cooking Oils', base: 'Refined Sunflower & Soyabean Oil', brands: ['Fortune', 'Saffola', 'Sunrich', 'Gemini', 'Dhara', 'Sunny'], tags: 'tel cooking oil sunflower soyabean', units: [['200 ml', 32, 38], ['500 ml', 68, 78], ['1 L', 128, 145], ['5 L', 625, 710]] },
  { cat: 'oil_masala', sub: 'Mustard & Groundnut Oil', base: 'Kachi Ghani Pure Mustard Oil', brands: ['Fortune', 'Patanjali', 'Dhara', 'Engine', 'Bail Kolhu'], tags: 'sarson tel mustard oil kachi ghani groundnut', units: [['200 ml', 38, 45], ['500 ml', 82, 95], ['1 L', 155, 180]] },
  { cat: 'oil_masala', sub: 'Powdered Spices', base: 'Haldi, Mirchi & Dhaniya Powder', brands: ['Everest', 'MDH', 'Tata Sampann', 'Catch', 'Ramdev', 'Badshah'], tags: 'masala haldi turmeric lal mirch chili dhaniya', units: [['50 g', 16, 20], ['100 g', 30, 36], ['200 g', 58, 68], ['500 g', 135, 160]] },
  { cat: 'oil_masala', sub: 'Blended Masalas', base: 'Garam Masala, Pav Bhaji & Chole Masala', brands: ['Everest', 'MDH', 'Badshah', 'Catch', 'Suhana', 'Shan'], tags: 'garam masala pav bhaji chole paneer sambhar chaat', units: [['15 g Sachet', 10, 12], ['50 g', 38, 44], ['100 g', 68, 78]] },
  { cat: 'oil_masala', sub: 'Whole Spices', base: 'Royal Jeera, Rai, Ajwain & Kali Mirch', brands: ['Vedant Select', 'Tata Sampann', 'Catch', 'Mother Organic'], tags: 'jeera cumin rai mustard elaichi cardamom laung', units: [['25 g', 18, 22], ['50 g', 34, 40], ['100 g', 65, 78], ['250 g', 155, 185]] },
  { cat: 'oil_masala', sub: 'Dry Fruits & Nuts', base: 'California Badam, Kaju & Kishmish', brands: ['Happilo', 'Nutraj', 'Vedant Dryfruits', 'Farmley', 'Wonderland'], tags: 'badam almond kaju cashew kishmish raisin pista', units: [['30 g Trial', 35, 42], ['50 g', 48, 58], ['100 g', 95, 115], ['250 g', 225, 275]] },
  { cat: 'oil_masala', sub: 'Pickles & Pastes', base: 'Homestyle Mango Pickle & Ginger Garlic Paste', brands: ['Mother\'s Recipe', 'Priya', 'Pravin', 'Dabur Hommade', 'Smith & Jones'], tags: 'achar pickle adrak lehsun ginger garlic paste', units: [['25 g Pouch', 5, 6], ['100 g', 25, 30], ['200 g', 45, 52], ['400 g', 85, 99]] },

  // Snacks, Biscuits & Instant Food
  { cat: 'snacks', sub: 'Instant Noodles', base: '2-Minute Masala Instant Noodles', brands: ['Maggi', 'Sunfeast YiPPee!', 'Top Ramen', 'Ching\'s Secret', 'Wai Wai', 'Patanjali'], tags: 'maggi noodles pasta soupy instant snack', units: [['70 g Single', 14, 15], ['140 g Double', 28, 30], ['280 g 4-Pack', 54, 60], ['560 g 8-Pack', 105, 120]] },
  { cat: 'snacks', sub: 'Biscuits & Cookies', base: 'Gluco, Marie Gold & Good Day Butter Cookies', brands: ['Parle-G', 'Britannia', 'Sunfeast', 'McVitie\'s', 'Unibic', 'Cremica'], tags: 'biscuit parle g marie good day bourbon oreo cookies', units: [['Small Pack', 5, 5], ['Regular Pack', 10, 10], ['Family Pack', 25, 30], ['Mega Pack', 45, 55], ['Value Jar', 95, 120]] },
  { cat: 'snacks', sub: 'Namkeen & Bhujia', base: 'Aloo Bhujia, Bikaneri Sev & Khatta Meetha', brands: ['Haldiram\'s', 'Bikaji', 'Balaji', 'Chitale Bandhu', 'Lehar', 'Garden'], tags: 'namkeen bhujia sev chivda farsan mixture', units: [['35 g Pouch', 10, 10], ['80 g Pack', 20, 22], ['150 g Pack', 38, 44], ['200 g Pack', 48, 55], ['400 g Family', 92, 110]] },
  { cat: 'snacks', sub: 'Chips & Crisps', base: 'Masala Munch, Cream & Onion Potato Chips', brands: ['Lay\'s', 'Kurkure', 'Balaji Wafers', 'Bingo!', 'Too Yumm!', 'Pringles'], tags: 'chips wafers kurkure lays nachos popcorn', units: [['Chota Pack', 10, 10], ['Medium Pack', 20, 20], ['Party Pack', 35, 40], ['Share Bag', 48, 55]] },
  { cat: 'snacks', sub: 'Chocolates & Candies', base: 'Dairy Milk, 5-Star, KitKat & Munch Bar', brands: ['Cadbury', 'Nestle', 'Amul', 'Ferrero', 'Parle Melody', 'Pulse'], tags: 'chocolate dairy milk kitkat munch toffee candy', units: [['Mini Bar', 10, 10], ['Classic Bar', 20, 22], ['Silk / Duo', 45, 50], ['Celebrations', 135, 160]] },
  { cat: 'snacks', sub: 'Ketchup & Spreads', base: 'Fresh Tomato Ketchup & Mixed Fruit Jam', brands: ['Kissan', 'Maggi', 'Del Monte', 'FunFoods', 'Veeba'], tags: 'ketchup sauce tomato jam mayo chutney', units: [['15 g Sachet', 2, 2], ['90 g Spout', 18, 20], ['200 g', 45, 52], ['500 g', 98, 115]] },

  // Dairy, Bread & Breakfast
  { cat: 'dairy', sub: 'Milk & Curd', base: 'Taaza Toned Milk, Gold Full Cream & Masti Dahi', brands: ['Amul', 'Mother Dairy', 'Gowardhan', 'Chitale', 'Nandini', 'Gokul'], tags: 'doodh milk dahi curd lassi chaas buttermilk', units: [['200 ml Chaas', 15, 16], ['200 g Dahi', 22, 25], ['500 ml Pouch', 28, 30], ['1 L Tetra', 68, 72]] },
  { cat: 'dairy', sub: 'Butter, Cheese & Paneer', base: 'Pasteurized Table Butter, Cheese Slices & Malai Paneer', brands: ['Amul', 'Britannia', 'Gowardhan', 'Mother Dairy', 'Go Cheese', 'Milky Mist'], tags: 'makhan butter paneer cheese ghee shrikhand', units: [['20 gChiplets', 12, 14], ['100 g Butter', 56, 60], ['200 g Paneer', 85, 95], ['500 g Butter', 275, 290]] },
  { cat: 'dairy', sub: 'Pure Cow & Desi Ghee', base: 'Pure Cow & Buffalo Granular Desi Ghee', brands: ['Amul', 'Gowardhan', 'Patanjali', 'Mother Dairy', 'Chitale', 'Ananda'], tags: 'ghee tup cow ghee desi ghee', units: [['50 ml Pouch', 38, 42], ['200 ml Jar', 145, 160], ['500 ml Jar', 345, 380], ['1 L Tin', 665, 720]] },
  { cat: 'dairy', sub: 'Bread & Bakery', base: 'Whole Wheat Brown Bread, Milk Pav & Toast Rusk', brands: ['Britannia', 'Modern', 'Wibs', 'English Oven', 'Parle Rusk'], tags: 'bread pav bun rusk khari toast bakery', units: [['Small Rusk', 10, 12], ['6 Pc Pav', 22, 25], ['400 g Bread', 42, 45], ['Suji Rusk 200g', 36, 40]] },
  { cat: 'dairy', sub: 'Oats, Cornflakes & Honey', base: 'Rolled Oats, Masala Oats & Corn Flakes', brands: ['Saffola', 'Quaker', 'Kellogg\'s', 'Bagrry\'s', 'Dabur Honey'], tags: 'oats cornflakes muesli breakfast honey', units: [['40 g Pouch', 15, 18], ['100 g Pack', 38, 45], ['400 g Pouch', 78, 92], ['1 kg Saver', 175, 215]] },

  // Tea, Coffee & Beverages
  { cat: 'beverages', sub: 'Tea & Masala Chai', base: 'Assam CTC Strong Leaf Tea & Elaichi Chai', brands: ['Red Label', 'Tata Tea Gold', 'Taj Mahal', 'Wagh Bakri', 'Society Tea', 'Taaza'], tags: 'chai patti tea leaf masala chai green tea', units: [['25 g Pack', 10, 10], ['100 g Pack', 38, 44], ['250 g Pack', 105, 125], ['500 g Pack', 215, 250]] },
  { cat: 'beverages', sub: 'Instant & Filter Coffee', base: 'Classic Instant Coffee & Chicory Roast', brands: ['Nescafe', 'Bru', 'Continental', 'Tata Coffee Grand', 'Rage'], tags: 'coffee nescafe bru cold coffee', units: [['Sachet Pack', 5, 5], ['10 g Pouch', 20, 22], ['25 g Jar', 45, 50], ['50 g Glass Jar', 155, 175]] },
  { cat: 'beverages', sub: 'Soft Drinks & Juices', base: 'Mango Drink, Mixed Fruit Juice & Jeera Soda', brands: ['Maaza', 'Slice', 'Real', 'Tropicana', 'Thums Up', 'Sprite', 'Paper Boat'], tags: 'cold drink juice maaza frooti soda शरबत', units: [['150 ml Pack', 10, 10], ['250 ml PET', 20, 20], ['600 ml Bottle', 38, 40], ['1 L Tetra/PET', 95, 115]] },
  { cat: 'beverages', sub: 'Health Drinks & Sharbat', base: 'Malt Health Drink, Glucose-D & Rose Sharbat', brands: ['Bournvita', 'Horlicks', 'Complan', 'Glucon-D', 'Rooh Afza', 'Tang'], tags: 'bournvita horlicks glucon d tang sharbat energy', units: [['Sachet', 10, 10], ['75 g Pack', 32, 36], ['200 g Jar', 110, 125], ['500 g Refill', 235, 265]] },

  // Personal Care & Household Cleaning
  { cat: 'household', sub: 'Bath Soaps & Handwash', base: 'Germ Protection Bath Soap & Neem Handwash', brands: ['Dettol', 'Lifebuoy', 'Lux', 'Santoor', 'Pears', 'Cinthol', 'Medimix'], tags: 'sabun soap handwash bodywash नहाने का साबुन', units: [['45 g Mini', 10, 10], ['100 g Bar', 34, 38], ['125 g Bar', 46, 52], ['4x100g Multipack', 128, 148]] },
  { cat: 'household', sub: 'Shampoo & Hair Oil', base: 'Coconut Hair Oil, Almond Oil & Anti-Dandruff Shampoo', brands: ['Parachute', 'Dabur Amla', 'Bajaj Almond', 'Clinic Plus', 'Sunsilk', 'Head & Shoulders'], tags: 'shampoo hair oil khopra tel parachute', units: [['Sachet Strip (6)', 12, 12], ['50 ml Bottle', 28, 32], ['100 ml Bottle', 45, 52], ['200 ml Bottle', 98, 118]] },
  { cat: 'household', sub: 'Toothpaste & Oral Care', base: 'Strong Teeth, Dant Kanti & Red Ayurvedic Paste', brands: ['Colgate', 'Patanjali', 'Dabur Red', 'Pepsodent', 'Sensodyne', 'CloseUp'], tags: 'toothpaste colgate brush datun manjan', units: [['20 g Mini', 10, 10], ['50 g Tube', 25, 28], ['100 g Tube', 58, 65], ['200 g Family', 112, 130]] },
  { cat: 'household', sub: 'Detergent & Laundry', base: 'Quick Wash Detergent Powder, Bar & Matic Liquid', brands: ['Surf Excel', 'Ariel', 'Tide', 'Wheel', 'Rin', 'Ghadi'], tags: 'surf detergent washing powder rin kapde dhone ka sabun', units: [['150 g Bar', 10, 10], ['250 g Bar', 18, 20], ['500 g Powder', 36, 42], ['1 kg Powder', 68, 78], ['2 kg Matic', 340, 395]] },
  { cat: 'household', sub: 'Dishwash & Floor Cleaners', base: 'Lemon Dishwash Bar, Gel, Scrubber & Toilet Cleaner', brands: ['Vim', 'Pril', 'Exo', 'Harpic', 'Lizol', 'Colin'], tags: 'vim bar bartan sabun harpic lizol phenyl', units: [['130 g Bar', 10, 10], ['300 g Tub', 28, 32], ['250 ml Gel', 48, 55], ['500 ml Cleaner', 96, 112]] },
  { cat: 'household', sub: 'Pooja & Home Needs', base: 'Agarbatti Incense, Camphor Kapur & Mosquito Repellent', brands: ['Cycle Pure', 'Mangaldeep', 'Good Knight', 'All Out', 'Odonil'], tags: 'agarbatti dhoop kapur all out mosquito', units: [['Small Pack', 10, 12], ['Regular Box', 25, 30], ['Refill 45ml', 72, 80]] }
];

const VARIANT_MODIFIERS = [
  'Classic', 'Premium', 'Gold', 'Super Saver', 'Special', 'Family Choice',
  '100% Pure', 'Select Grade', 'A1 Quality', 'Farm Fresh', 'Extra Strong',
  'Rozana Pack', 'Shudh', 'Deluxe', 'Prime'
];

function generateCatalog(targetCount = 10500) {
  const items = [];
  let skuCounter = 1;

  while (items.length < targetCount) {
    for (const tpl of CATALOG_TEMPLATES) {
      for (const brand of tpl.brands) {
        for (const [unitLabel, basePrice, baseMrp] of tpl.units) {
          const mod = VARIANT_MODIFIERS[skuCounter % VARIANT_MODIFIERS.length];
          const priceDelta = (skuCounter % 5) - 2; // subtle realistic price variation
          const price = Math.max(2, basePrice + priceDelta);
          const mrp = Math.max(price + 1, baseMrp + Math.max(0, priceDelta));
          const sku = `SKU-${String(skuCounter).padStart(5, '0')}`;
          items.push({
            sku,
            name: `${brand} ${tpl.base} (${mod})`,
            brand,
            category: tpl.cat,
            subcategory: tpl.sub,
            unit: unitLabel,
            price,
            mrp,
            stock: 15 + (skuCounter * 7) % 180,
            hindi_tags: tpl.tags,
            rating: Number((4.0 + ((skuCounter % 10) * 0.09)).toFixed(1)),
            is_essential: price <= 100
          });
          skuCounter++;
          if (items.length >= targetCount) break;
        }
        if (items.length >= targetCount) break;
      }
      if (items.length >= targetCount) break;
    }
  }
  return items;
}

async function runSeed() {
  const client = await pool.connect();
  try {
    console.log("🚀 Running schema_and_migration.sql on Neon PostgreSQL...");
    const sqlPath = path.join(__dirname, 'schema_and_migration.sql');
    const schemaSql = fs.readFileSync(sqlPath, 'utf8');
    await client.query(schemaSql);

    console.log("📦 Generating 10,500 realistic Indian Kirana SKUs...");
    const allItems = generateCatalog(10500);

    // Bulk load in batches of 1,500 using our Postgres Stored Procedure
    const batchSize = 1500;
    for (let i = 0; i < allItems.length; i += batchSize) {
      const batch = allItems.slice(i, i + batchSize);
      await client.query('CALL bulk_load_kirana_jsonb($1::jsonb, $2)', [
        JSON.stringify(batch),
        'vedant_main_store'
      ]);
      console.log(`✅ Bulk loaded ${Math.min(i + batchSize, allItems.length)} / ${allItems.length} SKUs into JSONB...`);
    }

    const res = await client.query(`
      SELECT
        COUNT(*) AS total_skus,
        COUNT(*) FILTER (WHERE ((payload->>'price')::int) < 50) AS under_50_skus
      FROM kirana_catalog
    `);
    console.log("🎉 SEEDING COMPLETE!", res.rows[0]);
  } catch (err) {
    console.error("❌ Seed error:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runSeed();
}

module.exports = { generateCatalog };
