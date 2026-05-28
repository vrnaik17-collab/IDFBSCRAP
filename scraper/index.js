const { launchBrowser, createContext, createPage, closeBrowser } = require('./browser');
const { extractCategories } = require('./categoryExtractor');
const { scrapeCategory } = require('./businessExtractor');
const { randomDelay } = require('../utils/helpers');
const logger = require('../utils/logger');

async function runScraper() {
  let browser = null;
  let context = null;
  const allBusinesses = [];

  const citiesEnv = process.env.CITIES || '';
  const cities = citiesEnv
    ? citiesEnv.split(',').map(c => c.trim().toLowerCase()).filter(Boolean)
    : null;

  const baseUrl = process.env.BASE_URL || 'https://bangalore.idbf.in';

  const cityUrls = cities
    ? cities.map(c => ({ city: c, url: `https://${c}.idbf.in` }))
    : [{ city: baseUrl.replace('https://', '').split('.')[0], url: baseUrl }];

  try {
    browser = await launchBrowser();

    for (const cityInfo of cityUrls) {
      logger.info(`\n${'='.repeat(50)}`);
      logger.info(`Scraping city: ${cityInfo.city} | ${cityInfo.url}`);
      logger.info('='.repeat(50));

      process.env.BASE_URL = cityInfo.url;

      context = await createContext(browser);
      const page = await createPage(context);

      try {
        const categories = await extractCategories(page);
        logger.info(`Found ${categories.length} categories for ${cityInfo.city}`);

        for (let i = 0; i < categories.length; i++) {
          const cat = categories[i];
          logger.info(`\n[${i + 1}/${categories.length}] ${cat.name}`);

          try {
            const businesses = await scrapeCategory(page, cat);
            allBusinesses.push(...businesses);
            logger.info(`Total so far: ${allBusinesses.length}`);
          } catch (err) {
            logger.error(`Category "${cat.name}" failed: ${err.message}`);
          }

          if (i < categories.length - 1) await randomDelay(3000, 6000);
        }
      } catch (err) {
        logger.error(`City ${cityInfo.city} failed: ${err.message}`);
      } finally {
        await context.close();
        context = null;
      }

      if (cityUrls.indexOf(cityInfo) < cityUrls.length - 1) {
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
