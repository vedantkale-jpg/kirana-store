# 🛒 Vedant Super Kirana & POS (`kirana1.vedant.com`)
**Neon PostgreSQL (`JSONB` + B-Tree Indexing) + 10,500+ SKUs + AWS Free Tier Deployment Guide (Hinglish)**

Ye package tumhare interview assignment ke saare core SRS points cover karta hai:
1. **10,500+ Realistic Indian Kirana SKUs** (Staples, Oil & Masala, Snacks & Biscuits, Dairy & Bread, Tea & Beverages, Personal Care & Household).
2. **Neon PostgreSQL `JSONB` Architecture** (`database/schema_and_migration.sql`) jismein `((payload->>'price')::int)` par **B-Tree Expression Index** aur `jsonb_to_recordset()` bulk unnesting stored procedure laga hai.
3. **Blinkit-Inspired Kirana UI** jismein Studio Product Photos, `< ₹50` Instant Filter, Category Sidebar, Live Search, POS Cart, aur **Razorpay Test Gateway + Dynamic UPI QR Code** dono hain.

---

## 🚀 Step 1: Neon PostgreSQL Setup (5 Minutes)

1. [https://neon.tech](https://neon.tech) par jao aur Free Sign-up karo.
2. Ek naya project banao (Naam rakho: `vedant-kirana-db`, Region: `AWS Singapore / ap-southeast-1`).
3. Dashboard se apni **Connection String (`DATABASE_URL`)** copy karo:
   `postgresql://neondb_owner:xxxx@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`

---

## 💻 Step 2: AWS EC2 Free Tier Par Live Karna (10 Minutes)

1. **AWS Console -> EC2 -> Launch Instance** par click karo:
   - **Name:** `vedant-kirana-server`
   - **OS Image:** `Ubuntu Server 24.04 LTS` (Free Tier Eligible)
   - **Instance Type:** `t2.micro` ya `t3.micro` (Free Tier)
   - **Security Group (Firewall):** `Allow SSH (22)`, `Allow HTTP (80)`, `Allow HTTPS (443)`, aur custom TCP `3000` tick kar do.
2. Instance connect karke terminal mein ye commands copy-paste karo:

```bash
# 1. Node.js 20 aur Nginx install karo
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx unzip

# 2. Project folder mein dependencies install karo
npm install

# 3. Apna Neon PostgreSQL URL set karke 10,500 SKUs seed karo (sirf 5 second lagenge!)
export DATABASE_URL="postgresql://neondb_owner:YOUR_PASSWORD@ep-xyz.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
npm run seed

# 4. Server start karo (Port 3000 par)
nohup npm start > kirana.log 2>&1 &
```

---

## 🌐 Step 3: Custom Domain (`kirana1.vedant.com`) Connect Karna

1. Jahan se tumne domain kharida hai (GoDaddy / Namecheap / Hostinger / AWS Route53), uske **DNS Management** mein jao.
2. Ek **A Record** add karo:
   - **Type:** `A`
   - **Host / Name:** `kirana1` (ya `@` agar main domain hai)
   - **Value / Points to:** `TUMHARE_AWS_EC2_KA_PUBLIC_IPv4_ADDRESS`
   - **TTL:** `300` (5 mins)
3. EC2 par Nginx reverse proxy chala do taaki bina `:3000` ke seedha `kirana1.vedant.com` khule:

```bash
sudo bash -c 'cat > /etc/nginx/sites-available/default <<EOF
server {
    listen 80;
    server_name kirana1.vedant.com _;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
}
EOF'
sudo systemctl restart nginx
```

Free HTTPS (SSL Lock) lagane ke liye:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d kirana1.vedant.com
```
