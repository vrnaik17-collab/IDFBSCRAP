const { randomDelay, withRetry, cleanText } = require('../utils/helpers');
const { autoScroll } = require('./categoryExtractor');
const logger = require('../utils/logger');

const MIN_DELAY = parseInt(process.env.MIN_DELAY_MS) || 1500;
const MAX_DELAY = parseInt(process.env.MAX_DELAY_MS) || 3000;

function getCityName() {
  try {
    const base = process.env.CITY_BASE_URL || process.env.BASE_URL || '';
    const host = new URL(base).hostname;
    const city = host.split('.')[0];
    return city.charAt(0).toUpperCase() + city.slice(1);
  } catch { return 'Bangalore'; }
}

function getCityBase() {
  return process.env.CITY_BASE_URL || process.env.BASE_URL || 'https://bangalore.idbf.in';
}

async function scrapeCategory(page, category) {
  const businesses = [];
  let currentUrl = category.url;
  let pageNum = 1;
  const city = getCityName();
  const cityBase = getCityBase();

  logger.info(`\nScraping category: "${category.name}"`);
  logger.info(`URL: ${category.url}`);

  while (currentUrl) {
    try {
      logger.info(`  Page ${pageNum}: ${currentUrl}`);

      await withRetry(() => page.goto(currentUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 90000
      }), 3, 3000, `goto ${currentUrl}`);

      await page.waitForTimeout(4000);
      await autoScroll(page);
      await page.waitForTimeout(2000);

      // Extract all business listing URLs from this category page
      // These are links matching /NUMERIC_ID/business-slug pattern
      const listingUrls = await page.evaluate((base) => {
        const urls = [];
        const seen = new Set();
        document.querySelectorAll('a[href]').forEach(el => {
          let href = el.getAttribute('href') || '';
          if (!href.startsWith('http')) {
            href = href.startsWith('/') ? `${base}${href}` : '';
          }
          if (!href || !href.startsWith(base)) return;

          // Business detail pages: /DIGITS/slug
          const path = href.replace(base, '');
          if (/^\/\d{4,}\//.test(path) && !seen.has(href)) {
            seen.add(href);
            urls.push(href);
          }
        });
        return urls;
      }, cityBase);

      logger.info(`  Found ${listingUrls.length} business listings`);

      if (listingUrls.length === 0) {
        // Try inline extraction as fallback
        const inline = await extractInlineBusinesses(page, category, city, cityBase);
        if (inline.length > 0) {
          logger.info(`  Extracted ${inline.length} businesses inline`);
          businesses.push(...inline);
        } else {
          logger.warn(`  No businesses found on page ${pageNum}`);
        }
      } else {
        // Visit each business detail page
        for (let i = 0; i < listingUrls.length; i++) {
          const url = listingUrls[i];
          logger.info(`  [${i + 1}/${listingUrls.length}] Visiting: ${url}`);

          try {
            const biz = await scrapeBusinessDetail(page, url, category, city);
            if (biz && biz.name) {
              businesses.push(biz);
              logger.info(`  ✓ ${biz.name} | ${biz.phone || 'no phone'}`);
            }
          } catch (err) {
            logger.error(`  ✗ ${url}: ${err.message}`);
          }

          // Go back to category listing page after each business
          try {
            await page.goto(currentUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 90000
            });
            await page.waitForTimeout(2000);
          } catch (err) {
            logger.warn(`  Could not go back to listing: ${err.message}`);
          }

          await randomDelay(MIN_DELAY, MAX_DELAY);
        }
      }

      // Check for next page
      currentUrl = await getNextPageUrl(page, currentUrl);
      pageNum++;
      if (currentUrl) {
        logger.info(`  → Next page: ${currentUrl}`);
        await randomDelay(2000, 4000);
      }

    } catch (err) {
      logger.error(`Page ${pageNum} failed for "${category.name}": ${err.message}`);
      break;
    }
  }

  logger.info(`Category "${category.name}" complete: ${businesses.length} businesses`);
  return businesses;
}

async function scrapeBusinessDetail(page, url, category, city) {
  return withRetry(async () => {
    // Navigate to business detail page
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });
    await page.waitForTimeout(3000);

    // Click "Show Number & More Information" button
    const phone = await clickShowNumberAndExtract(page);

    // Extract all business data
    const data = await page.evaluate(() => {
      const get = (selectors) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (t && t.length > 1) return t;
          }
        }
        return '';
      };

      // Business name — usually h1
      const name = get([
        'h1', 'h1.listing-title', 'h1.business-name',
        'h1.entry-title', '.business-name', '.listing-name',
        '[itemprop="name"]', '.company-name', '.biz-name',
        '.page-title', '#business-name'
      ]);

      // Address
      const address = get([
        '[itemprop="streetAddress"]', '[itemprop="address"]',
        '.address', '.listing-address', '.full-address',
        '.business-address', '[class*="address"]',
        '.street-address', '.location', '.addr'
      ]);

      // State
      const state = get([
        '[itemprop="addressRegion"]', '.state',
        '[class*="state"]', '.region'
      ]) || 'Karnataka';

      // Pincode
      const pincode = get([
        '[itemprop="postalCode"]', '.pincode',
        '.pin', '.zip', '[class*="pin"]'
      ]);

      // Category from breadcrumb
      const breadEl = document.querySelector(
        '.breadcrumb, .breadcrumbs, nav[aria-label="breadcrumb"], [class*="breadcrumb"]'
      );
      const breadText = breadEl
        ? (breadEl.textContent || '').replace(/\s+/g, ' ').trim()
        : '';

      // Visible phone from tel: link
      const telEl = document.querySelector('a[href^="tel:"]');
      const telPhone = telEl
        ? telEl.getAttribute('href').replace('tel:', '').trim()
        : '';

      return { name, address, state, pincode, breadText, telPhone };
    });

    return {
      name: cleanText(data.name),
      category: cleanText(category.name),
      address: cleanText(data.address),
      phone: cleanText(phone || data.telPhone),
      city: city,
      state: cleanText(data.state) || 'Karnataka',
      source_url: url
    };
  }, 3, 3000, `scrapeBusinessDetail`);
}

async function clickShowNumberAndExtract(page) {
  // Try clicking "Show Number & More Information" or similar button
  const buttonSelectors = [
    'a:has-text("Show Number")',
    'button:has-text("Show Number")',
    'a:has-text("Show Number & More Information")',
    'button:has-text("Show Number & More Information")',
    'a:has-text("Show Mobile")',
    'button:has-text("Show Mobile")',
    'a:has-text("Show Phone")',
    'button:has-text("Show Phone")',
    'a:has-text("Click to Call")',
    'button:has-text("Click to Call")',
    'a:has-text("View Number")',
    '[class*="show-number"]',
    '[class*="show-phone"]',
    '[class*="show-mobile"]',
    '[class*="reveal-number"]',
    '[class*="view-number"]',
    '[id*="show-number"]',
    '[id*="show-phone"]',
    '.phone-reveal',
    '.show-contact'
  ];

  let clicked = false;
  for (const sel of buttonSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.scrollIntoViewIfNeeded();
        await randomDelay(500, 1000);
        await btn.click();
        logger.debug(`  Clicked: ${sel}`);
        await page.waitForTimeout(3000);
        clicked = true;
        break;
      }
    } catch {}
  }

  // Text-based fallback
  if (!clicked) {
    try {
      const found = await page.evaluate(() => {
        const els = document.querySelectorAll('a, button, span, div');
        for (const el of els) {
          const t = (el.textContent || '').toLowerCase().trim();
          if (
            t === 'show number' ||
            t === 'show number & more information' ||
            t === 'show mobile' ||
            t === 'show phone' ||
            t === 'click to call' ||
            t === 'view number' ||
            t.startsWith('show number')
          ) {
            el.click();
            return true;
          }
        }
        return false;
      });
      if (found) {
        await page.waitForTimeout(3000);
      }
    } catch {}
  }

  // Extract phone after clicking
  const phone = await page.evaluate(() => {
    // 1. tel: href links — most reliable
    const telLinks = document.querySelectorAll('a[href^="tel:"]');
    for (const el of telLinks) {
      const num = el.getAttribute('href').replace('tel:', '').trim();
      if (num && /\d{6,}/.test(num)) return num;
    }

    // 2. Known phone element selectors
    const phoneSels = [
      '[itemprop="telephone"]',
      '.phone', '.phone-number', '.phonenumber',
      '.contact-number', '.mobile', '.mobile-number',
      '.telephone', '[class*="phone"]',
      '[class*="mobile"]', '[class*="contact-no"]',
      '.number', '[class*="number"]'
    ];
    for (const sel of phoneSels) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const t = (el.textContent || '').replace(/[\s\-()]/g, '');
        if (/^(\+91)?[6-9]\d{9}$/.test(t) || /^\d{10,}$/.test(t)) return t;
      }
    }

    // 3. Full page scan for Indian mobile numbers
    const bodyText = document.body.innerText || '';
    const match = bodyText.match(/(?:\+91[\s\-]?)?[6-9]\d{9}/);
    return match ? match[0].replace(/[\s\-]/g, '') : '';
  });

  return phone;
}

async function extractInlineBusinesses(page, category, city, cityBase) {
  return await page.evaluate((base, cat, cityName) => {
    const businesses = [];
    const seen = new Set();

    // Try various card/listing selectors
    const selectors = [
      '.listing-item', '.business-card', '.biz-card',
      '.result-item', '.directory-item', '.listing-box',
      '.business-listing', '.company-item', 'article',
      '[class*="listing-item"]', '[class*="business-item"]'
    ];

    let cards = [];
    for (const sel of selectors) {
      cards = Array.from(document.querySelectorAll(sel));
      if (cards.length > 0) break;
    }

    cards.forEach(card => {
      const nameEl = card.querySelector(
        'h1,h2,h3,h4,.name,.title,.business-name,.listing-title,[class*="name"],[class*="title"]'
      );
      const name = nameEl ? (nameEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (!name || name.length < 2) return;

      const addrEl = card.querySelector('.address,[itemprop="streetAddress"],.location,[class*="address"]');
      const address = addrEl ? (addrEl.textContent || '').replace(/\s+/g, ' ').trim() : '';

      const telEl = card.querySelector('a[href^="tel:"]');
      const phone = telEl ? telEl.getAttribute('href').replace('tel:', '').trim() : '';

      const linkEl = card.querySelector('a[href]');
      let url = linkEl ? (linkEl.getAttribute('href') || '') : '';
      if (url && !url.startsWith('http')) {
        url = url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
      }

      const key = url || name;
      if (seen.has(key)) return;
      seen.add(key);

      businesses.push({
        name, category: cat.name, address, phone,
        city: cityName, state: 'Karnataka',
        source_url: url || base
      });
    });

    return businesses;
  }, cityBase, category, city);
}

async function getNextPageUrl(page, currentUrl) {
  return await page.evaluate((current) => {
    const selectors = [
      'a[rel="next"]', 'a.next', '.pagination .next a',
      'a.page-numbers.next', 'li.next a',
      '[aria-label="Next page"] a', '[aria-label="Next"] a',
      '.next-page a', 'a.nextpage'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        let href = el.getAttribute('href') || '';
        if (!href || href === '#') continue;
        if (!href.startsWith('http')) {
          href = window.location.origin + (href.startsWith('/') ? '' : '/') + href;
        }
        if (href !== current) return href;
      }
    }
    for (const el of document.querySelectorAll('a')) {
      const t = (el.textContent || '').trim().toLowerCase();
      if (t === 'next' || t === 'next »' || t === '›' || t === 'next page') {
        let href = el.getAttribute('href') || '';
        if (!href.startsWith('http')) href = window.location.origin + href;
        if (href && href !== current) return href;
      }
    }
    return null;
  }, currentUrl);
}

module.exports = { scrapeCategory };
