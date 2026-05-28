const { randomDelay, withRetry } = require('../utils/helpers');
const logger = require('../utils/logger');

const BASE_URL = process.env.BASE_URL || 'https://bangalore.idbf.in';

async function extractCategories(page) {
  return withRetry(async () => {
    logger.info(`Opening: ${BASE_URL}`);

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await randomDelay(3000, 5000);
    await autoScroll(page);

    const categories = await page.evaluate((baseUrl) => {
      const links = [];
      const seen = new Set();

      const allAnchors = document.querySelectorAll('a[href]');
      allAnchors.forEach(el => {
        let href = el.getAttribute('href') || '';
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();

        if (!href || href === '#' || href.startsWith('javascript') || href.startsWith('mailto')) return;
        if (!href.startsWith('http')) {
          href = href.startsWith('/') ? `${baseUrl}${href}` : `${baseUrl}/${href}`;
        }

        if (!href.includes('idbf.in')) return;

        const skip = ['about', 'contact', 'register', 'login', 'privacy', 'terms', 'sitemap'];
        if (skip.some(s => href.toLowerCase().includes(s))) return;

        if (text.length > 1 && text.length < 60 && !seen.has(href)) {
          seen.add(href);
          links.push({ name: text, url: href });
        }
      });

      return links;
    }, BASE_URL);

    const filtered = categories.filter(c => {
      const url = c.url.toLowerCase();
      return url.startsWith(BASE_URL.toLowerCase()) &&
             url !== BASE_URL + '/' &&
             url !== BASE_URL &&
             !url.includes('#');
    });

    logger.info(`Found ${filtered.length} category/page links`);

    if (filtered.length === 0) {
      logger.warn('No links found — using homepage as single source');
      return [{ name: 'All Businesses', url: BASE_URL }];
    }

    return filtered;
  }, 3, 3000, 'extractCategories');
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
