const { randomDelay, withRetry } = require('../utils/helpers');
const logger = require('../utils/logger');

const SKIP_SLUGS = [
  'register', 'about', 'about-us', 'contact', 'contact-us',
  'login', 'logout', 'privacy', 'privacy-policy', 'terms',
  'terms-and-conditions', 'sitemap', 'advertise', 'feedback',
  'faq', 'help', 'blog', 'news', 'disclaimer', 'terms-conditions'
];

async function navigateToCityPage(page) {
  const CITY = process.env.CITY || 'bangalore';

  // Step 1 — Open idbf.in
  logger.info('Step 1: Opening https://idbf.in');
  await page.goto('https://idbf.in', {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });

  // Wait for city pill/badge buttons to appear in the DOM
  // From the screenshot, cities appear as clickable elements (pills) on the homepage
  logger.info('Waiting for city list to render...');
  await page.waitForTimeout(6000); // give JS time to render city pills
  await autoScroll(page);
  await page.waitForTimeout(2000);

  const title = await page.title();
  const bodyLen = await page.evaluate(() => document.body.innerHTML.length);
  logger.info(`idbf.in loaded: "${title}" (body: ${bodyLen} chars)`);

  // Step 2 — Find and click the city pill
  // Cities are shown as pill buttons. We match by text content (e.g. "Bangalore")
  // The element could be <a>, <span>, <button>, or <div>
  logger.info(`Step 2: Finding and clicking city pill for "${CITY}"`);

  const clicked = await page.evaluate((city) => {
    const cityLower = city.toLowerCase();
    // Search all clickable-looking elements for matching city name
    const candidates = document.querySelectorAll('a, button, span, div, li');
    for (const el of candidates) {
      const text = (el.textContent || '').toLowerCase().trim();
      // Match exact city name, or city name inside parentheses e.g. "Mysuru (Mysore)"
      if (text === cityLower || text.startsWith(cityLower + ' (') || text.endsWith(') ' + cityLower)) {
        el.click();
        return { found: true, text: el.textContent.trim(), tag: el.tagName, href: el.getAttribute('href') };
      }
    }
    return { found: false };
  }, CITY);

  if (!clicked.found) {
    // Debug — show what text content is on the page
    const pageTexts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a, button, span'))
        .map(el => el.textContent.trim())
        .filter(t => t.length > 1 && t.length < 40)
        .slice(0, 50);
    });
    logger.warn(`City pill not found. Sample text elements on page:`);
    pageTexts.forEach(t => logger.info(`  "${t}"`));
    throw new Error(`City pill for "${CITY}" not found on idbf.in`);
  }

  logger.info(`Clicked city pill: "${clicked.text}" (${clicked.tag}) href=${clicked.href}`);

  // Step 3 — Wait for navigation to bangalore.idbf.in
  logger.info('Step 3: Waiting for navigation to city page...');
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await autoScroll(page);
  await page.waitForTimeout(2000);

  const cityUrl = page.url();
  const cityBase = new URL(cityUrl).origin;
  process.env.CITY_BASE_URL = cityBase;
  process.env.BASE_URL = cityBase;

  const cityTitle = await page.title();
  const cityBodyLen = await page.evaluate(() => document.body.innerHTML.length);
  logger.info(`City page loaded: "${cityTitle}" (body: ${cityBodyLen} chars)`);
  logger.info(`City base URL: ${cityBase}`);

  return cityBase;
}

async function extractCategories(page) {
  return withRetry(async () => {

    const cityBase = await navigateToCityPage(page);

    // Step 4 — Navigate to A-Z list page
    // From screenshot: nav has "A-Z List" link → goes to /a-z-list
    logger.info('Step 4: Finding A-Z List link');

    const azUrl = await page.evaluate((base) => {
      const anchors = document.querySelectorAll('a[href]');
      for (const el of anchors) {
        const href = (el.getAttribute('href') || '');
        const text = (el.textContent || '').toLowerCase().trim();
        if (
          text === 'a-z list' || text === 'a-z' || text === 'a to z' ||
          text.includes('all categories') ||
          href.includes('/a-z') || href.includes('a-z-list') ||
          href.includes('/categories')
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
      logger.info(`Found A-Z List link: ${azUrl}`);
      logger.info('Step 5: Navigating to A-Z category page');
      await page.goto(azUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 90000
      });
      await page.waitForTimeout(4000);
      await autoScroll(page);
      await page.waitForTimeout(2000);
    } else {
      logger.info('No A-Z link found — using city homepage for categories');
    }

    // Step 6 — Extract category links from the A-Z grid
    // From screenshot: each category is a card/link inside the grid
    logger.info('Step 6: Extracting category links from A-Z grid');

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

    const categories = allLinks.filter(link => {
      const url = link.url.toLowerCase();
      let path = url.replace(cityBase.toLowerCase(), '');
      path = path.replace(/^\//, '').replace(/\/$/, '');

      if (!path || path.length < 2) return false;
      if (SKIP_SLUGS.includes(path)) return false;
      if (/^[a-z]$/.test(path)) return false; // single letter A-Z nav links
      if (/^\d/.test(path)) return false;      // numeric IDs = business pages

      const parts = path.split('/');
      if (parts.length > 1 && !path.includes('page')) return false;
      if (!/[a-z]/.test(path)) return false;

      return true;
    });

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
