const { randomDelay, withRetry, cleanText } = require('../utils/helpers');
const { autoScroll } = require('./categoryExtractor');
const logger = require('../utils/logger');

const BASE_URL = process.env.BASE_URL || 'https://bangalore.idbf.in';
const MIN_DELAY = parseInt(process.env.MIN_DELAY_MS) || 2000;
const MAX_DELAY = parseInt(process.env.MAX_DELAY_MS) || 5000;

/**
 * Scrape all businesses from a category URL, handling pagination
 */
async function scrapeCategory(page, category) {
  const businesses = [];
  let currentUrl = category.url;
  let pageNum = 1;

  logger.info(`Scraping category: "${category.name}" | ${category.url}`);

  while (currentUrl) {
    try {
      logger.info(`  Page ${pageNum}: ${currentUrl}`);

      await withRetry(() => page.goto(currentUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      }), 3, 2000, `Navigate to ${currentUrl}`);

      await randomDelay(MIN_DELAY, MAX_DELAY);
      await autoScroll(page);

      // Extract business cards/listings from the current page
      const listingUrls = await extractListingUrls(page);
      logger.info(`  Found ${listingUrls.length} listings on page ${pageNum}`);

      if (listingUrls.length === 0) {
        // Maybe businesses are inline on listing page, try direct extraction
        const inlineBusinesses = await extractInlineBusinesses(page, category);
        if (inlineBusinesses.length > 0) {
          logger.info(`  Extracted ${inlineBusinesses.length} businesses inline`);
          businesses.push(...inlineBusinesses);
        }
      } else {
        // Visit each listing detail page
        for (let i = 0; i < listingUrls.length; i++) {
          const listingUrl = listingUrls[i];
          logger.debug(`  Processing listing ${i + 1}/${listingUrls.length}: ${listingUrl}`);

          try {
            const business = await scrapeBusinessDetail(page, listingUrl, category);
            if (business) {
              businesses.push(business);
              logger.info(`  ✓ ${business.name} | ${business.phone || 'no phone'}`);
            }
            await randomDelay(MIN_DELAY, MAX_DELAY);
          } catch (err) {
            logger.error(`  ✗ Failed to scrape ${listingUrl}: ${err.message}`);
          }
        }
      }

      // Check for next page
      currentUrl = await getNextPageUrl(page, currentUrl);
      pageNum++;

      if (currentUrl) {
        logger.info(`  Moving to page ${pageNum}...`);
        await randomDelay(MIN_DELAY + 1000, MAX_DELAY + 1000);
      }
    } catch (err) {
      logger.error(`Error scraping page ${pageNum} of ${category.name}: ${err.message}`);
      break;
    }
  }

  logger.info(`Category "${category.name}" complete: ${businesses.length} businesses`);
  return businesses;
}

/**
 * Extract all listing/detail page URLs from a category listing page
 */
async function extractListingUrls(page) {
  return await page.evaluate((baseUrl) => {
    const urls = [];
    const seen = new Set();

    const selectors = [
      '.listing-item a[href]',
      '.business-card a[href]',
      '.entry-title a[href]',
      'h2.title a[href]',
      'h3.title a[href]',
      '.listing-title a[href]',
      '.company-name a[href]',
      'article a.listing-link',
      '.post-title a',
      '.biz-name a',
      'a.listing-detail-url',
      '.list-item a',
      '.result-item a[href]'
    ];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(el => {
        let href = el.getAttribute('href') || '';
        if (!href || href === '#') return;
        if (!href.startsWith('http')) {
          href = href.startsWith('/') ? `${baseUrl}${href}` : `${baseUrl}/${href}`;
        }
        if (!seen.has(href)) {
          seen.add(href);
          urls.push(href);
        }
      });
      if (urls.length > 0) break;
    }

    // Broader fallback: all internal links that look like detail pages
    if (urls.length === 0) {
      document.querySelectorAll('a[href]').forEach(el => {
        let href = el.getAttribute('href') || '';
        if (!href.startsWith('http')) {
          href = href.startsWith('/') ? `${baseUrl}${href}` : '';
        }
        if (!href || !href.startsWith(baseUrl)) return;
        // Avoid pagination, category links
        if (href.includes('page/') || href.includes('category/') || href === baseUrl + '/') return;
        if (!seen.has(href)) {
          seen.add(href);
          urls.push(href);
        }
      });
    }

    return urls;
  }, BASE_URL);
}

/**
 * Visit a business detail page and extract all data
 */
async function scrapeBusinessDetail(page, url, category) {
  return withRetry(async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(1500, 3000);

    // Click "Show Number & full details" button if present
    const phone = await revealAndExtractPhone(page);

    const data = await page.evaluate((pageUrl, categoryInfo) => {
      const getText = (selectors) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent.trim()) return el.textContent.replace(/\s+/g, ' ').trim();
        }
        return '';
      };

      // Business name
      const name = getText([
        'h1.entry-title', 'h1.listing-title', 'h1.business-name', 'h1',
        '.listing-name h1', '.business-title', '.company-name',
        '[itemprop="name"]', '.biz-name', 'h1.page-title'
      ]);

      // Address
      const address = getText([
        '[itemprop="streetAddress"]', '.address', '.listing-address',
        '.business-address', '.street-address', '.full-address',
        '[class*="address"]', '.location-address'
      ]);

      // City
      const city = getText([
        '[itemprop="addressLocality"]', '.city', '.listing-city',
        '[class*="city"]'
      ]) || 'Bangalore';

      // State
      const state = getText([
        '[itemprop="addressRegion"]', '.state', '.listing-state',
        '[class*="state"]'
      ]) || 'Karnataka';

      // Phone (visible/already shown)
      const visiblePhone = getText([
        '[itemprop="telephone"]', '.phone', '.phone-number',
        '.listing-phone', '.contact-phone', 'a[href^="tel:"]',
        '[class*="phone"]', '.telephone', '.mobile'
      ]);

      const telLink = document.querySelector('a[href^="tel:"]');
      const telFromHref = telLink ? telLink.getAttribute('href').replace('tel:', '') : '';

      return {
        name: name || document.title || '',
        address: address || '',
        city: city || 'Bangalore',
        state: state || 'Karnataka',
        visible_phone: visiblePhone || telFromHref || '',
        source_url: pageUrl
      };
    }, url, category);

    return {
      name: cleanText(data.name),
      category: cleanText(category.name),
      address: cleanText(data.address),
      phone: cleanText(phone || data.visible_phone),
      city: cleanText(data.city),
      state: cleanText(data.state),
      source_url: url
    };
  }, 3, 2000, `scrapeBusinessDetail(${url})`);
}

/**
 * Attempt to click "Show Number & full details" button and extract phone
 */
async function revealAndExtractPhone(page) {
  const buttonSelectors = [
    'button:has-text("Show Number")',
    'button:has-text("Show Phone")',
    'button:has-text("Reveal Number")',
    'a:has-text("Show Number")',
    'a:has-text("Click to Call")',
    '[class*="show-number"]',
    '[class*="show-phone"]',
    '[class*="reveal-phone"]',
    '[data-action="show-phone"]',
    '.show-contact',
    '.view-phone',
    'button.contact-btn',
    'a.show-number-btn',
    '[onclick*="showNumber"]',
    '[onclick*="revealPhone"]'
  ];

  let clicked = false;
  for (const selector of buttonSelectors) {
    try {
      const btn = await page.$(selector);
      if (btn) {
        await btn.scrollIntoViewIfNeeded();
        await randomDelay(500, 1000);
        await btn.click();
        clicked = true;
        logger.debug(`Clicked phone reveal button: ${selector}`);
        await randomDelay(1500, 3000);
        break;
      }
    } catch (err) {
      // Continue trying other selectors
    }
  }

  if (!clicked) {
    // Try text-based fallback
    try {
      const clicked2 = await page.evaluate(() => {
        const allElements = document.querySelectorAll('button, a, span, div');
        for (const el of allElements) {
          const text = (el.textContent || '').toLowerCase();
          if (text.includes('show number') || text.includes('show phone') ||
              text.includes('reveal number') || text.includes('click to call') ||
              text.includes('view number')) {
            el.click();
            return true;
          }
        }
        return false;
      });
      if (clicked2) {
        logger.debug('Clicked phone reveal via text match');
        await randomDelay(1500, 2500);
      }
    } catch (err) {
      // Ignore
    }
  }

  // Now extract the phone number that appeared
  const phone = await page.evaluate(() => {
    const phoneSelectors = [
      '[itemprop="telephone"]', '.phone-number', '.phone',
      '.listing-phone', '.contact-number', '.mobile-number',
      '[class*="phone"]', 'a[href^="tel:"]', '.revealed-phone',
      '.show-phone', '[class*="contact"]'
    ];

    for (const sel of phoneSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.replace(/\s+/g, ' ').trim();
        const href = el.getAttribute('href') || '';
        const val = href.startsWith('tel:') ? href.replace('tel:', '') : text;
        // Basic phone validation: must contain digits
        if (val && /\d{6,}/.test(val)) return val;
      }
    }

    // Regex fallback: scan full page text for phone patterns
    const bodyText = document.body.innerText || '';
    const phoneMatch = bodyText.match(/(?:\+91[\s-]?)?(?:[789]\d{9}|0\d{10}|\d{2,4}[\s-]\d{6,8})/);
    return phoneMatch ? phoneMatch[0] : '';
  });

  return phone;
}

/**
 * Extract businesses directly from a listing page (no detail page visit)
 */
async function extractInlineBusinesses(page, category) {
  return await page.evaluate((baseUrl, cat) => {
    const businesses = [];
    const cards = document.querySelectorAll(
      '.listing-item, .business-card, article, .result-item, .list-item, .entry'
    );

    cards.forEach(card => {
      const name = (card.querySelector('h2, h3, h1, .title, .name, .business-name')
        || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim();

      const address = (card.querySelector('.address, [itemprop="streetAddress"], .location')
        || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim();

      const phone = (card.querySelector('[itemprop="telephone"], .phone, a[href^="tel:"]')
        || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim();

      const link = card.querySelector('a[href]');
      const url = link ? (link.getAttribute('href').startsWith('http')
        ? link.getAttribute('href')
        : `${baseUrl}${link.getAttribute('href')}`) : window.location.href;

      if (name) {
        businesses.push({
          name,
          category: cat.name,
          address,
          phone,
          city: 'Bangalore',
          state: 'Karnataka',
          source_url: url
        });
      }
    });

    return businesses;
  }, BASE_URL, category);
}

/**
 * Get next page URL from pagination
 */
async function getNextPageUrl(page, currentUrl) {
  return await page.evaluate((current) => {
    // Standard next page selectors
    const nextSelectors = [
      'a.next', 'a[rel="next"]', 'a:has-text("Next")',
      '.pagination .next a', '.nav-next a', '.page-next a',
      'a.page-numbers.next', '.wp-pagenavi a.next',
      '[aria-label="Next page"]', '[aria-label="Next"]',
      'li.next a', 'a.nextpostslink'
    ];

    for (const selector of nextSelectors) {
      try {
        const el = document.querySelector(selector);
        if (el) {
          let href = el.getAttribute('href') || '';
          if (href && href !== '#' && href !== current) {
            if (!href.startsWith('http')) {
              href = href.startsWith('/') ? window.location.origin + href : window.location.origin + '/' + href;
            }
            return href !== current ? href : null;
          }
        }
      } catch (e) {}
    }

    // Text-based fallback
    const allLinks = document.querySelectorAll('a');
    for (const el of allLinks) {
      const text = (el.textContent || '').trim().toLowerCase();
      if (text === 'next' || text === 'next »' || text === '›' || text === '→' || text === 'next page') {
        let href = el.getAttribute('href') || '';
        if (href && href !== '#') {
          if (!href.startsWith('http')) {
            href = window.location.origin + (href.startsWith('/') ? '' : '/') + href;
          }
          if (href !== current) return href;
        }
      }
    }

    return null;
  }, currentUrl);
}

module.exports = { scrapeCategory };
