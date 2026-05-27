require('dotenv').config();

const path = require('path');
const fs = require('fs');
const { runScraper } = require('./scraper');
const { insertBusinesses, testConnection } = require('./database/supabase');
const { exportToCSV } = require('./utils/csvExporter');
const logger = require('./utils/logger');

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';

async function main() {
  logger.info('='.repeat(60));
  logger.info('  IDBF Bangalore Business Scraper');
  logger.info('  Target: ' + (process.env.BASE_URL || 'https://bangalore.idbf.in'));
  logger.info('='.repeat(60));

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Test DB connection (non-fatal)
  logger.info('Testing Supabase connection...');
  const dbOk = await testConnection();
  if (!dbOk) {
    logger.warn('Supabase not configured or unreachable. Data will be saved locally only.');
  }

  let businesses = [];

  try {
    // Run the scraper
    businesses = await runScraper();
    logger.info(`\nScraping complete. Total businesses: ${businesses.length}`);
  } catch (err) {
    logger.error(`Scraper failed: ${err.message}`, { stack: err.stack });
    process.exit(1);
  }

  if (businesses.length === 0) {
    logger.warn('No businesses were scraped. Check selectors or site structure.');
    return;
  }

  // Deduplicate by source_url in memory
  const seen = new Set();
  const deduplicated = businesses.filter(b => {
    if (!b.source_url || seen.has(b.source_url)) return false;
    seen.add(b.source_url);
    return true;
  });
  logger.info(`After deduplication: ${deduplicated.length} unique businesses`);

  // Save JSON backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(OUTPUT_DIR, `businesses_${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(deduplicated, null, 2), 'utf8');
  logger.info(`JSON backup saved: ${jsonPath}`);

  // Save CSV
  try {
    const csvPath = await exportToCSV(deduplicated, `businesses_${timestamp}.csv`);
    logger.info(`CSV saved: ${csvPath}`);
  } catch (err) {
    logger.error(`CSV export failed: ${err.message}`);
  }

  // Insert into Supabase
  if (dbOk) {
    logger.info('Inserting into Supabase...');
    try {
      const result = await insertBusinesses(deduplicated);
      logger.info(`Supabase insert complete: ${result.inserted} inserted, ${result.skipped} skipped, ${result.errors || 0} errors`);
    } catch (err) {
      logger.error(`Supabase insert failed: ${err.message}`);
    }
  }

  // Summary
  logger.info('\n' + '='.repeat(60));
  logger.info('SUMMARY');
  logger.info('-'.repeat(60));
  logger.info(`Total businesses scraped : ${businesses.length}`);
  logger.info(`After deduplication      : ${deduplicated.length}`);

  // Per-category breakdown
  const byCat = {};
  deduplicated.forEach(b => {
    byCat[b.category] = (byCat[b.category] || 0) + 1;
  });
  Object.entries(byCat).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
    logger.info(`  ${cat}: ${count}`);
  });

  logger.info('='.repeat(60));
}

main().catch(err => {
  logger.error('Unhandled error in main:', err);
  process.exit(1);
});
