require('dotenv').config();

const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');
const { insertBusinesses, testConnection } = require('./database/supabase');
const { exportToCSV } = require('./utils/csvExporter');

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';

async function main() {
  logger.info('='.repeat(50));
  logger.info('IDBF Scraper Starting');
  logger.info('Target: ' + (process.env.BASE_URL || 'https://idbf.in'));
  logger.info('='.repeat(50));

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const dbOk = await testConnection();
  if (!dbOk) {
    logger.warn('Supabase not connected. Saving locally only.');
  } else {
    logger.info('Database connected successfully.');
  }

  // Load scraper
  let runScraper;
  try {
    const scraperModule = require('./scraper/index');
    runScraper = scraperModule.runScraper;
    if (typeof runScraper !== 'function') {
      throw new Error(`runScraper is not a function. Got: ${typeof runScraper}. Module keys: ${Object.keys(scraperModule).join(', ')}`);
    }
  } catch (err) {
    logger.error(`Failed to load scraper module: ${err.message}`);
    process.exit(1);
  }

  let businesses = [];

  try {
    businesses = await runScraper();
    logger.info(`Scraping complete. Total: ${businesses.length}`);
  } catch (err) {
    logger.error(`Scraper Failed:\n${err}`);
    process.exit(1);
  }

  if (businesses.length === 0) {
    logger.warn('No businesses scraped.');
    return;
  }

  // Deduplicate by source_url
  const seen = new Set();
  const unique = businesses.filter(b => {
    if (!b.source_url || seen.has(b.source_url)) return false;
    seen.add(b.source_url);
    return true;
  });
  logger.info(`After dedup: ${unique.length} unique businesses`);

  // Save JSON
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(OUTPUT_DIR, `businesses_${ts}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(unique, null, 2));
  logger.info(`JSON saved: ${jsonPath}`);

  // Save CSV
  try {
    await exportToCSV(unique, `businesses_${ts}.csv`);
  } catch (err) {
    logger.error(`CSV export failed: ${err.message}`);
  }

  // Insert to Supabase
  if (dbOk) {
    try {
      const result = await insertBusinesses(unique);
      logger.info(`Supabase: ${result.inserted} inserted, ${result.skipped} skipped`);
    } catch (err) {
      logger.error(`Supabase insert failed: ${err.message}`);
    }
  }

  // Summary
  logger.info('='.repeat(50));
  logger.info('SUMMARY');
  logger.info(`Total scraped  : ${businesses.length}`);
  logger.info(`Unique records : ${unique.length}`);
  const byCat = {};
  unique.forEach(b => { byCat[b.category] = (byCat[b.category] || 0) + 1; });
  Object.entries(byCat).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
    logger.info(`  ${cat}: ${count}`);
  });
  logger.info('='.repeat(50));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
