const { randomDelay, withRetry } = require('../utils/helpers');
const logger = require('../utils/logger');

const SKIP_SLUGS = [
  'register', 'about', 'about-us', 'contact', 'contact-us',
  'login', 'logout', 'privacy', 'privacy-policy', 'terms',
  'terms-and-conditions', 'sitemap', 'advertise', 'feedback',
  'faq', 'help', 'blog', 'news'
];

async function navigateToCityPage(page) {
  const CITY = process.env.CITY || 'bangalore';

  // Build the city URL directly — no need to go through the homepage.
  // The site always follows the pattern: https://{city}.idbf.in
  const cityBase = `https://${CITY}.idbf.in`;
  process.env.CITY_BASE_URL = cityBase;
  process.env.BASE_URL = cityBase;

  logger.info(`Step 1: Navigating directly to city page ${cityBase}`);
  await page.goto(cityBase, {
    waitUntil: 'networkidle',   // wait for JS-rendered content
    timeout: 90000
  });
  await page.waitForTimeout(5000);
  await autoScroll(page);
  await page.waitForTimeout(2000);

  logger.info(`City page loaded: ${await page.title()}`);
  logger.info(`City base URL: ${cityBase}`);

  return cityBase;
}

async function extractCategories(page) {
  return withRetry(async () => {

    // Navigate directly to the city page
    const cityBase = await navigateToCityPage(page);

    // Step 2 — find the A-Z category index link
    logger.info('Step 2: Finding A-Z category list');

    const azUrl = await page.evaluate((base) => {
      const anchors = document.querySelectorAll('a[href]');
      for (const el of anchors) {
        const href = (el.getAttribute('href') || '');
        const text = (el.textContent || '').toLowerCase().trim();
        if (
          text.includes('a-z') || text.includes('a to z') ||
          text.includes('categories') || text.includes('all categories') ||
          href.includes('/a-z') || href.includes('/categories')
        ) {
          if (!href.startsWith('http')) {
            return href.startsWith('/') ? `${base}${href}` : `${base}/${href}`;
          }
          return href;
        }
      }
      return null;
    }, cityBase);

    if (azUrl) {
      logger.info(`Found A-Z link: ${azUrl}`);
      logger.info('Step 3: Opening A-Z category page');
      await page.goto(azUrl, {
        waitUntil: 'networkidle',
        timeout: 90000
      });
      await page.waitForTimeout(4000);
      await autoScroll(page);
      await page.waitForTimeout(2000);
    } else {
      logger.info('No A-Z link found — extracting categories from city homepage directly');
    }

    // Step 4 — extract all category links
    logger.info('Step 4: Extracting category links');

    const allLinks = await page.evaluate((base) => {
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
        if (!seen.has(href) && text.length > 1 && text.length < 80) {
          seen.add(href);
          links.push({ name: text, url: href });
        }
      });
      return links;
    }, cityBase);

    logger.info(`Total links found: ${allLinks.length}`);

    // Filter to real category slugs only
    const categories = allLinks.filter(link => {
      const url = link.url.toLowerCase();
      let path = url.replace(cityBase.toLowerCase(), '');
      path = path.replace(/^\//, '').replace(/\/$/, '');

      if (!path || path.length < 2) return false;
      if (SKIP_SLUGS.includes(path)) return false;
      if (/^[a-z]$/.test(path)) return false;
      if (/^\d/.test(path)) return false;

      const parts = path.split('/');
      if (parts.length > 1 && !path.includes('page')) return false;
      if (!/[a-z]/.test(path)) return false;

      return true;
    });

    // Deduplicate
    const seenUrls = new Set();
    const unique = categories.filter(c => {
      if (seenUrls.has(c.url)) return false;
      seenUrls.add(c.url);
      return true;
    });

    logger.info(`Found ${unique.length} categories`);
    unique.forEach(c => logger.info(`  → ${c.name} | ${c.url}`));

    if (unique.length === 0) {
      logger.warn('No categories found — dumping all links:');
      allLinks.slice(0, 30).forEach(l => logger.info(`  ${l.name} | ${l.url}`));
      return [{ name: 'All Businesses', url: cityBase }];
    }

    return unique;
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
