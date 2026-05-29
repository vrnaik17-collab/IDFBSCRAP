const { randomDelay, withRetry } = require('../utils/helpers');
const logger = require('../utils/logger');

const CITY = process.env.CITY || 'bangalore';

async function extractCategories(page, city) {
  return withRetry(async () => {

    // STEP 1 — Open idbf.in
    logger.info('Step 1: Opening https://idbf.in');
    await page.goto('https://idbf.in', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForTimeout(5000);
    logger.info(`Loaded: ${await page.title()}`);

    // STEP 2 — Find and click city link (e.g. "Bangalore")
    logger.info(`Step 2: Finding "${city}" city link`);

    const cityClicked = await page.evaluate(({ cityName }) => {
      const anchors = document.querySelectorAll('a[href]');
      for (const el of anchors) {
        const href = (el.getAttribute('href') || '').toLowerCase();
        const text = (el.textContent || '').toLowerCase().trim();
        if (
          href.includes(`${cityName}.idbf.in`) ||
          text === cityName.toLowerCase() ||
          text.includes(cityName.toLowerCase())
        ) {
          el.click();
          return el.getAttribute('href');
        }
      }
      return null;
    }, { cityName: city });

    if (!cityClicked) {
      // Try direct navigation
      logger.warn(`City link not found by click — navigating directly`);
      await page.goto(`https://${city}.idbf.in`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
    } else {
      logger.info(`Clicked city: ${cityClicked}`);
      await page.waitForTimeout(5000);
    }

    await page.waitForTimeout(5000);
    logger.info(`City page: ${await page.title()} | ${page.url()}`);

    const cityBase = new URL(page.url()).origin;
    process.env.BASE_URL = cityBase;
    process.env.CITY_BASE_URL = cityBase;
    logger.info(`City base URL set: ${cityBase}`);

    // STEP 3 — Go to A-Z List page
    logger.info('Step 3: Opening A-Z List');
    const azUrl = `${cityBase}/a-z`;
    await page.goto(azUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForTimeout(5000);
    await autoScroll(page);
    await page.waitForTimeout(3000);

    logger.info(`A-Z page: ${await page.title()} | ${page.url()}`);

    // STEP 4 — Extract ALL category links from A-Z page
    logger.info('Step 4: Extracting all category links from A-Z page');

    const categories = await page.evaluate(({ base }) => {
      const links = [];
      const seen = new Set();

      document.querySelectorAll('a[href]').forEach(el => {
        let href = el.getAttribute('href') || '';
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();

        if (!href || href === '#') return;
        if (!href.startsWith('http')) {
          href = href.startsWith('/') ? `${base}${href}` : '';
        }
        if (!href.startsWith(base)) return;
        if (href === base || href === base + '/') return;

        const path = href.replace(base, '').replace(/^\//, '').replace(/\/$/, '');

        // Skip nav links
        const skip = [
          'register', 'about', 'about-us', 'contact', 'contact-us',
          'login', 'logout', 'privacy', 'terms', 'sitemap', 'a-z'
        ];
        if (skip.includes(path)) return;

        // Skip single letters
        if (/^[a-z]$/.test(path)) return;

        // Skip numeric IDs
        if (/^\d/.test(path)) return;

        // Skip multi-level paths
        if (path.split('/').length > 1) return;

        if (!seen.has(href) && text.length > 1 && text.length < 80) {
          seen.add(href);
          links.push({ name: text, url: href });
        }
      });

      return links;
    }, { base: cityBase });

    logger.info(`Found ${categories.length} categories on A-Z page`);
    categories.forEach(c => logger.info(`  → ${c.name} | ${c.url}`));

    if (categories.length === 0) {
      // Fallback — try extracting from city homepage
      logger.warn('No categories on A-Z page — trying city homepage');
      await page.goto(cityBase, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await page.waitForTimeout(5000);
      await autoScroll(page);

      const fallback = await page.evaluate(({ base }) => {
        const links = [];
        const seen = new Set();
        document.querySelectorAll('a[href]').forEach(el => {
          let href = el.getAttribute('href') || '';
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (!href || href === '#') return;
          if (!href.startsWith('http')) {
            href = href.startsWith('/') ? `${base}${href}` : '';
          }
          if (!href.startsWith(base)) return;
          const path = href.replace(base, '').replace(/^\//, '');
          if (!path || path.length < 2) return;
          if (/^\d/.test(path)) return;
          if (/^[a-z]$/.test(path)) return;
          if (!seen.has(href) && text.length > 1) {
            seen.add(href);
            links.push({ name: text, url: href });
          }
        });
        return links;
      }, { base: cityBase });

      logger.info(`Fallback found ${fallback.length} links`);
      return fallback.length > 0
        ? fallback
        : [{ name: 'All Businesses', url: cityBase }];
    }

    return categories;

  }, 3, 8000, 'extractCategories');
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0;
      const dist = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, dist);
        total += dist;
        if (total >= document.body.scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 200);
    });
  });
}

module.exports = { extractCategories, autoScroll };
