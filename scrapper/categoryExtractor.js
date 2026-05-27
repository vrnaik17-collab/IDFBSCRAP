const { randomDelay, withRetry, cleanText } = require('../utils/helpers');
const logger = require('../utils/logger');

const BASE_URL = process.env.BASE_URL || 'https://bangalore.idbf.in';

/**
 * Extract all category links from the homepage
 */
async function extractCategories(page) {
  return withRetry(async () => {
    logger.info(`Navigating to homepage: ${BASE_URL}`);

    await page.goto(BASE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await randomDelay(2000, 4000);

    // Scroll to trigger lazy-loaded content
    await autoScroll(page);

    const categories = await page.evaluate((baseUrl) => {
      const links = [];
      const seen = new Set();

      // Try multiple selectors for category links
      const selectors = [
        'a[href*="/category/"]',
        'a[href*="/cat/"]',
        'a[href*="/listing/"]',
        '.category-list a',
        '.categories a',
        '.cat-list a',
        'ul.categories li a',
        '.menu-item a[href*="category"]',
        'nav a[href*="category"]',
        '.widget_categories a',
        'a.category-link'
      ];

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          let href = el.getAttribute('href') || '';
          if (!href) return;
          if (!href.startsWith('http')) {
            href = href.startsWith('/') ? `${baseUrl}${href}` : `${baseUrl}/${href}`;
          }
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (href && !seen.has(href) && text) {
            seen.add(href);
            links.push({ name: text, url: href });
          }
        });
      }

      // Also try to find any links that look like categories even without the selectors
      if (links.length === 0) {
        document.querySelectorAll('a').forEach(el => {
          const href = el.getAttribute('href') || '';
          const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
          const fullHref = href.startsWith('http') ? href :
            href.startsWith('/') ? `${baseUrl}${href}` : '';

          if (fullHref && !seen.has(fullHref) && text &&
              (fullHref.includes('category') || fullHref.includes('listing') || fullHref.includes('cat='))) {
            seen.add(fullHref);
            links.push({ name: text, url: fullHref });
          }
        });
      }

      return links;
    }, BASE_URL);

    // Filter out obvious non-category links
    const filtered = categories.filter(c => {
      const lower = c.url.toLowerCase();
      const exclude = ['login', 'register', 'contact', 'about', 'privacy', 'terms', 'sitemap', '#', 'javascript:'];
      return !exclude.some(e => lower.includes(e)) && c.name.length > 1;
    });

    logger.info(`Found ${filtered.length} categories`);
    filtered.forEach(c => logger.debug(`  Category: ${c.name} -> ${c.url}`));

    if (filtered.length === 0) {
      logger.warn('No categories found via standard selectors. Trying to extract all listing-like links...');
      return await extractFallbackCategories(page);
    }

    return filtered;
  }, 3, 3000, 'extractCategories');
}

/**
 * Fallback: get all unique top-level links as categories
 */
async function extractFallbackCategories(page) {
  const allLinks = await page.evaluate((baseUrl) => {
    const links = [];
    const seen = new Set();
    document.querySelectorAll('a[href]').forEach(el => {
      let href = el.getAttribute('href') || '';
      if (!href || href === '#' || href.startsWith('javascript')) return;
      if (!href.startsWith('http')) {
        href = href.startsWith('/') ? `${baseUrl}${href}` : `${baseUrl}/${href}`;
      }
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!seen.has(href) && text.length > 1) {
        seen.add(href);
        links.push({ name: text, url: href });
      }
    });
    return links;
  }, BASE_URL);

  // Keep only links on the same domain
  return allLinks.filter(l => l.url.startsWith(BASE_URL));
}

/**
 * Auto-scroll page to trigger lazy loading
 */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 150);
    });
  });
}

module.exports = { extractCategories, autoScroll };
