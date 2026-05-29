const { randomDelay, withRetry } = require('../utils/helpers');
const logger = require('../utils/logger');

const BASE_URL = process.env.BASE_URL || 'https://bangalore.idbf.in';

const SKIP_EXACT = [
  'register', 'about', 'about-us', 'contact', 'contact-us',
  'login', 'logout', 'privacy', 'privacy-policy', 'terms',
  'terms-and-conditions', 'sitemap', 'advertise', 'feedback',
  'faq', 'help', 'blog', 'news', 'a', 'b', 'c', 'd', 'e',
  'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p',
  'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'
];

async function extractCategories(page) {
  return withRetry(async () => {
    const baseUrl = process.env.BASE_URL || BASE_URL;
    logger.info(`Opening homepage: ${baseUrl}`);

    // Step 1 — visit idbf.in first to get cookies
    logger.info('Warming up via idbf.in first...');
    try {
      await page.goto('https://idbf.in', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });
      await page.waitForTimeout(4000);
      logger.info(`idbf.in title: ${await page.title()}`);
    } catch (err) {
      logger.warn(`idbf.in warmup failed: ${err.message} — continuing anyway`);
    }

    // Step 2 — now navigate to city page
    await page.waitForTimeout(2000);
    logger.info(`Navigating to city: ${baseUrl}`);
    await page.goto(baseUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    await page.waitForTimeout(8000);
    await autoScroll(page);
    await page.waitForTimeout(4000);

    const title = await page.title();
    const bodyLen = await page.evaluate(() => (document.body.innerText || '').length);
    const htmlLen = await page.evaluate(() => document.body.innerHTML.length);

    logger.info(`Title: "${title}" | Body: ${bodyLen} chars | HTML: ${htmlLen} chars`);

    if (bodyLen < 50) {
      logger.warn('Still blank — trying page.reload()');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(10000);
    }

    const bodyPreview = await page.evaluate(() => (document.body.innerText || '').substring(0, 400));
    logger.info(`Preview: ${bodyPreview}`);

    const allLinks = await page.evaluate(({ base }) => {
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
    }, { base: baseUrl });

    logger.info(`Total links found: ${allLinks.length}`);

    if (allLinks.length === 0) {
      const html = await page.evaluate(() => document.documentElement.outerHTML.substring(0, 500));
      logger.info(`HTML snapshot: ${html}`);
      throw new Error('Page still blank after all attempts');
    }

    const categories = allLinks.filter(link => {
      const url = link.url.toLowerCase();
      let path = url.replace(baseUrl.toLowerCase(), '');
      path = path.replace(/^\//, '').replace(/\/$/, '');

      if (!path || path.length < 2) return false;
      if (SKIP_EXACT.includes(path)) return false;

      const parts = path.split('/');
      if (parts.length > 1 && !path.includes('page')) return false;

      if (/^\d+/.test(path)) return false;
      if (!/[a-z]/.test(path)) return false;

      return true;
    });

    const seenUrls = new Set();
    const unique = categories.filter(c => {
      if (seenUrls.has(c.url)) return false;
      seenUrls.add(c.url);
      return true;
    });

    logger.info(`Found ${unique.length} real categories`);
    unique.forEach(c => logger.info(`  → ${c.name} | ${c.url}`));

    if (unique.length === 0) {
      logger.warn('0 real categories — dumping all links:');
      allLinks.forEach(l => logger.info(`  ${l.name} | ${l.url}`));
      return [{ name: 'All Businesses', url: baseUrl }];
    }

    return unique;
  }, 5, 8000, 'extractCategories');
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
