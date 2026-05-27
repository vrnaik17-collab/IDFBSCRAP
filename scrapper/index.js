const { launchBrowser, createContext, createPage, closeBrowser } = require('./browser');
const { extractCategories } = require('./categoryExtractor');
const { scrapeCategory } = require('./businessExtractor');
const { randomDelay } = require('../utils/helpers');
const logger = require('../utils/logger');

/**
 * Run the full scrape: homepage → categories → businesses
 */
async function runScraper() {
  let browser = null;
  let context = null;
  const allBusinesses = [];

  try {
    browser = await launchBrowser();
    context = await createContext(browser);
    const page = await createPage(context);

    // Step 1: Extract all categories
    const categories = await extractCategories(page);

    if (categories.length === 0) {
      logger.warn('No categories found. Attempting to scrape homepage directly...');
      // Treat the homepage itself as a single "category"
      categories.push({
        name: 'All Businesses',
        url: process.env.BASE_URL || 'https://bangalore.idbf.in'
      });
    }

    logger.info(`Starting scrape of ${categories.length} categories`);

    // Step 2: Scrape each category
    for (let i = 0; i < categories.length; i++) {
      const category = categories[i];
      logger.info(`\n[${i + 1}/${categories.length}] Category: ${category.name}`);

      try {
        const businesses = await scrapeCategory(page, category);
        allBusinesses.push(...businesses);
        logger.info(`Category "${category.name}": ${businesses.length} businesses (total: ${allBusinesses.length})`);

        // Delay between categories
        if (i < categories.length - 1) {
          await randomDelay(3000, 6000);
        }
      } catch (err) {
        logger.error(`Failed to scrape category "${category.name}": ${err.message}`);
      }
    }

    return allBusinesses;
  } finally {
    if (context) await context.close();
    await closeBrowser();
  }
}

module.exports = { runScraper };
