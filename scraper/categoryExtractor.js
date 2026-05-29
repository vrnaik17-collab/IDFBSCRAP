const { randomDelay, withRetry } = require('../utils/helpers');
const logger = require('../utils/logger');

const SKIP_EXACT = [
  'register', 'about', 'about-us', 'contact', 'contact-us',
  'login', 'logout', 'privacy', 'privacy-policy', 'terms',
  'terms-and-conditions', 'sitemap', 'advertise', 'feedback',
  'faq', 'help', 'blog', 'news', 'a', 'b', 'c', 'd', 'e',
  'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p',
  'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'
];

async function extractCategories(page, city) {
  return withRetry(async () => {

    // STEP 1 — Open idbf.in homepage
    logger.info('Step 1: Opening https://idbf.in');
    await page.goto('https://idbf.in', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForTimeout(5000);
    logger.info(`idbf.in loaded. Title: ${await page.title()}`);

    // STEP 2 — Find the city link and click it
    logger.info(`Step 2: Finding link for city "${city}"`);

    const cityLink = await page.evaluate(({ cityName }) => {
      const anchors = document.querySelectorAll('a[href]');
      for (const el of anchors) {
        const href = (el.getAttribute('href') || '').toLowerCase();
        const text = (el.textContent || '').toLowerCase().trim();
        if (
          href.includes(`${cityName}.idbf.in`) ||
          text === cityName.toLowerCase()
        ) {
          return el.getAttribute('href');
        }
      }
      return null;
    }, { cityName: city });

    if (!cityLink) {
      // Log all links to debug
      const allHrefs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
          .map(el => ({
            text: (el.textContent || '').trim(),
            href: el.getAttribute('href')
          }))
          .filter(l => l.href && l.href.includes('idbf.in'))
          .slice(0, 30);
      });
      logger.warn('City link not found. Available idbf.in links:');
      allHrefs.forEach(l => logger.info(`  "${l.text}" → ${l.href}`));
      throw new Error(`City link for "${city}" not found on idbf.in`);
    }

    logger.info(`Found city link: ${cityLink}`);

    // STEP 3 — Click the city link
    logger.info(`Step 3: Clicking city link → ${cityLink}`);
    await page.goto(cityLink, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForTimeout(6000);
    await autoScroll(page);
    await page.waitForTimeout(3000);

    const cityPageTitle = await page.title();
    const cityPageUrl = page.url();
    const cityBase = new URL(cityPageUrl).origin;

    logger.info(`City page loaded: "${cityPageTitle}"`);
    logger.info(`City URL: ${cityPageUrl}`);
    logger.info(`City base: ${cityBase}`);

    // Store for other modules
    process.env.BASE_URL = cityBase;
    process.env.CITY_BASE_URL = cityBase;

    // STEP 4 — Extract all category links from city page
    logger.info('Step 4: Extracting category links');

    const bodyText = await page.evaluate(() => document.body.innerText || '');
    logger.info(`City page body length: ${bodyText.length}`);
    logger.info(`Preview: ${bodyText.substring(0, 300)}`);

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
    }, { base: cityBase });

    logger.info(`Total links on city page: ${allLinks.length}`);

    // Filter to real category pages only
    const categories = allLinks.filter(link => {
      const url = link.url.toLowerCase();
      let path = url.replace(cityBase.toLowerCase(), '');
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
      logger.warn('0 categories found — dumping all links:');
      allLinks.forEach(l => logger.info(`  ${l.name} | ${l.url}`));
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
