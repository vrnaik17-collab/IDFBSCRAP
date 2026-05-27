# IDBF Bangalore Business Scraper

A production-ready Node.js + Playwright scraper for [bangalore.idbf.in](https://bangalore.idbf.in) that extracts all business listings across all categories and stores them in Supabase with CSV/JSON backup.

---

## Features

- Automatic category discovery from homepage
- Full pagination support
- Clicks "Show Number & full details" to reveal hidden phone numbers
- Supabase upsert with duplicate prevention
- JSON + CSV backup exports
- Anti-blocking: random delays, user-agent rotation, stealth mode
- Retry logic with exponential backoff
- Structured logging to console + files
- Chromium headless via Playwright
- Ready for Render deployment

---

## Project Structure

```
idbf-scraper/
├── index.js                  # Entry point & orchestrator
├── scraper/
│   ├── index.js              # Scraper runner
│   ├── browser.js            # Browser/context setup
│   ├── categoryExtractor.js  # Homepage → category links
│   └── businessExtractor.js  # Category → business data
├── database/
│   └── supabase.js           # Supabase client & insert logic
├── utils/
│   ├── logger.js             # Winston logger
│   ├── helpers.js            # Delays, retry, UA rotation
│   └── csvExporter.js        # CSV export
├── output/                   # JSON + CSV + logs (gitignored)
├── .env.example              # Environment variable template
├── render.yaml               # Render deployment config
├── package.json
└── README.md
```

---

## Supabase Setup

1. Go to [supabase.com](https://supabase.com) → New Project
2. Open **SQL Editor** and run:

```sql
create table businesses (
  id bigint generated always as identity primary key,
  name text,
  category text,
  address text,
  phone text,
  city text,
  state text,
  source_url text unique,
  created_at timestamp default now()
);

-- Index for faster duplicate checks
create unique index if not exists businesses_source_url_idx on businesses(source_url);
```

3. Go to **Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon/public key** → `SUPABASE_ANON_KEY`

---

## Local Setup

### Prerequisites
- Node.js 18+
- npm 9+

### Installation

```bash
# Clone repo
git clone https://github.com/YOUR_USERNAME/idbf-scraper.git
cd idbf-scraper

# Install dependencies & Playwright browser
npm run setup

# Configure environment
cp .env.example .env
# Edit .env with your Supabase credentials
```

### Configure `.env`

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key

HEADLESS=true
BASE_URL=https://bangalore.idbf.in
MIN_DELAY_MS=2000
MAX_DELAY_MS=5000
MAX_RETRIES=3
LOG_LEVEL=info
OUTPUT_DIR=./output
```

### Run

```bash
# Standard run (headless)
npm start

# Run with browser visible (for debugging)
npm run scrape:headful
```

Outputs are saved to `./output/`:
- `businesses_<timestamp>.json`
- `businesses_<timestamp>.csv`
- `scraper.log`
- `scraper-error.log`

---

## GitHub Push

```bash
git init
git add .
git commit -m "Initial commit: IDBF scraper"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/idbf-scraper.git
git push -u origin main
```

---

## Render Deployment

1. Push code to GitHub (above)
2. Go to [render.com](https://render.com) → **New → Background Worker**
3. Connect your GitHub repository
4. Render will auto-detect `render.yaml`
5. Add environment variables under **Environment**:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
6. Click **Deploy**

The `render.yaml` sets:
- Build: `npm install && npx playwright install chromium --with-deps`
- Start: `node index.js`

> **Note:** Use **Render Starter** plan or higher (512MB+ RAM) — Chromium needs ~300MB.

---

## Environment Variables

| Variable         | Default                        | Description                        |
|------------------|--------------------------------|------------------------------------|
| `SUPABASE_URL`   | —                              | Your Supabase project URL          |
| `SUPABASE_ANON_KEY` | —                           | Supabase anon/public key           |
| `BASE_URL`       | `https://bangalore.idbf.in`    | Target website                     |
| `HEADLESS`       | `true`                         | Run browser headless               |
| `MIN_DELAY_MS`   | `2000`                         | Minimum delay between requests     |
| `MAX_DELAY_MS`   | `5000`                         | Maximum delay between requests     |
| `MAX_RETRIES`    | `3`                            | Retry attempts on failure          |
| `LOG_LEVEL`      | `info`                         | Logging level (debug/info/warn)    |
| `OUTPUT_DIR`     | `./output`                     | Directory for output files         |

---

## Scaling to Other Cities/Categories

To scale to other cities, update `BASE_URL` in `.env`:

```env
BASE_URL=https://mumbai.idbf.in
# or
BASE_URL=https://delhi.idbf.in
```

The scraper auto-discovers all categories on any IDBF city subdomain.

---

## Troubleshooting

**No businesses found:**
- Run with `HEADLESS=false` to watch the browser
- Check `output/scraper.log` for selector details
- The site structure may differ; inspect element selectors and update `businessExtractor.js`

**Playwright not installed:**
```bash
npx playwright install chromium
```

**Supabase errors:**
- Ensure `source_url` has a unique index (see SQL above)
- Check your anon key has `INSERT` permissions on `businesses`

---

## License

MIT
