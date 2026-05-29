const { launchBrowser, createContext, createPage, closeBrowser } = require('./browser');
const { extractCategories } = require('./categoryExtractor');
const { scrapeCategory } = require('./businessExtractor');
const { randomDelay } = require('../utils/helpers');
const logger = require('../utils/logger');

async function runScraper() {
  let browser = null;
  let context = null;
  const allBusinesses = [];

  const citiesEnv = process.env.CITIES || 'bangalore';
  const cities = citiesEnv.split(',').map(c => c.trim().toLowerCase()).filter(Boolean);

  logger.info(`Cities to scrape: ${cities.join(', ')}`);

  try {
    browser = await launchBrowser();

    for (const city of cities) {
      logger.info(`\n${'='.repeat(50)}`);
      logger.info(`CITY: ${city.toUpperCase()}`);
      logger.info('='.repeat(50));

      context = await createContext(browser);
      const page = await createPage(context);

      try {
        // extractCategories now handles full flow:
        // idbf.in → find city link → click → extract categories
        const categories = await extractCategories(page, city);
        logger.info(`Total categories: ${categories.length}`);

        for (let i = 0; i < categories.length; i++) {
          const cat = categories[i];
          logger.info(`\n[${i + 1}/${categories.length}] ${cat.name}`);

          try {
            const businesses = await scrapeCategory(page, cat);
            allBusinesses.push(...businesses);
            logger.info(`Running total: ${allBusinesses.length}`);
          } catch (err) {
            logger.error(`Category "${cat.name}" failed: ${err.message}`);
          }

          if (i < categories.length - 1) {
            await randomDelay(2000, 4000);
          }
        }

      } catch (err) {
        logger.error(`City "${city}" failed: ${err.message}`);
      } finally {
        await context.close();
        context = null;
      }

      if (cities.indexOf(city) < cities.length - 1) {
        await randomDelay(5000, 10000);
      }
    }

  } finally {
    if (context) await context.close();
    await closeBrowser();
  }

  return allBusinesses;
}

module.exports = { runScraper };
