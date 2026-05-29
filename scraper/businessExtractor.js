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

      // From screenshot Image 2:
      // Each business card has a "Show Number & full details of {Name}" button
      // Clicking it navigates to the business detail page
      // Collect all such button links from the listing page
      const detailUrls = await page.evaluate((base) => {
        const urls = [];
        const seen = new Set();

        // Primary: links whose text matches "Show Number & full details"
        document.querySelectorAll('a[href]').forEach(el => {
          const text = (el.textContent || '').toLowerCase().trim();
          let href = el.getAttribute('href') || '';

          if (!href.startsWith('http')) {
            href = href.startsWith('/') ? `${base}${href}` : '';
          }
          if (!href || !href.startsWith(base)) return;
          if (seen.has(href)) return;

          if (
            text.includes('show number') ||
            text.includes('full details') ||
            // Business detail pages have numeric ID in path: /12345/business-slug
            /\/\d{4,}\//.test(href)
          ) {
            seen.add(href);
            urls.push(href);
          }
        });

        return urls;
      }, cityBase);

      logger.info(`  Found ${detailUrls.length} business detail links`);

      if (detailUrls.length === 0) {
        // Fallback: try inline extraction from cards
        const inline = await extractInlineBusinesses(page, { cityBase, category, city });
        if (inline.length > 0) {
          logger.info(`  Extracted ${inline.length} businesses inline`);
          businesses.push(...inline);
        } else {
          logger.warn(`  No businesses found on page ${pageNum}`);
        }
      } else {
        for (let i = 0; i < detailUrls.length; i++) {
          const url = detailUrls[i];
          logger.info(`  [${i + 1}/${detailUrls.length}] ${url}`);

          try {
            const biz = await scrapeBusinessDetail(page, url, category, city);
            if (biz && biz.name) {
              businesses.push(biz);
              logger.info(`  ✓ ${biz.name} | ${biz.phone || 'no phone'}`);
            }
          } catch (err) {
            logger.error(`  ✗ ${url}: ${err.message}`);
          }

          // Return to category listing page
          try {
            await page.goto(currentUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 90000
            });
            await page.waitForTimeout(2000);
          } catch (err) {
            logger.warn(`  Could not return to listing: ${err.message}`);
          }

          await randomDelay(MIN_DELAY, MAX_DELAY);
        }
      }

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
    // From screenshot Image 1: business detail page layout
    // - h1: business name (e.g. "Acme Sales in Bangalore")
    // - ADDRESS section: full address
    // - CITY/STATE section
    // - MOBILE NUMBER section: phone number directly visible (no click needed)
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      const getText = (selectors) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (t && t.length > 1) return t;
          }
        }
        return '';
      };

      // Business name — h1 on detail page e.g. "Acme Sales in Bangalore"
      let name = getText(['h1', '.business-name', '[itemprop="name"]', '.listing-name', '.company-name']);
      // Strip trailing " in CityName" if present
      name = name.replace(/\s+in\s+\w+\s*$/i, '').trim();

      // Address — from ADDRESS card section
      const address = getText([
        '[itemprop="streetAddress"]', '[itemprop="address"]',
        '.address', '.listing-address', '.full-address',
        '.business-address', '[class*="address"]'
      ]);

      // City/State — from CITY / STATE card
      const cityState = getText([
        '[itemprop="addressLocality"]', '[itemprop="addressRegion"]',
        '.city-state', '.location', '[class*="city"]'
      ]);

      // Phone — MOBILE NUMBER is shown directly on detail page (no click needed)
      // Try tel: links first (most reliable), then text patterns
      let phone = '';
      const telEl = document.querySelector('a[href^="tel:"]');
      if (telEl) {
        phone = telEl.getAttribute('href').replace('tel:', '').trim();
      }
      if (!phone) {
        // Scan known selectors
        const phoneSels = [
          '[itemprop="telephone"]', '.phone', '.phone-number',
          '.mobile', '.mobile-number', '.contact-number',
          '[class*="phone"]', '[class*="mobile"]', '[class*="number"]'
        ];
        for (const sel of phoneSels) {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            const t = (el.textContent || '').replace(/[\s\-()]/g, '');
            if (/^(\+91)?[6-9]\d{9}$/.test(t) || /^\d{7,}$/.test(t)) {
              phone = t;
              break;
            }
          }
          if (phone) break;
        }
      }
      if (!phone) {
        // Full page scan for Indian mobile number
        const match = (document.body.innerText || '').match(/(?:\+91[\s\-]?)?[6-9]\d{9}/);
        if (match) phone = match[0].replace(/[\s\-]/g, '');
      }

      return { name, address, cityState, phone };
    });

    return {
      name: cleanText(data.name),
      category: cleanText(category.name),
      address: cleanText(data.address),
      phone: cleanText(data.phone),
      city: city,
      state: 'Karnataka',
      source_url: url
    };
  }, 3, 3000, 'scrapeBusinessDetail');
}

// FIX: single object arg to avoid Playwright "Too many arguments" error
async function extractInlineBusinesses(page, { cityBase, category, city }) {
  return await page.evaluate(({ base, cat, cityName }) => {
    const businesses = [];
    const seen = new Set();

    const selectors = [
      '.listing-item', '.business-card', '.biz-card',
      '.result-item', '.directory-item', '.listing-box',
      '.business-listing', '.company-item', 'article',
      '[class*="listing-item"]', '[class*="business-item"]',
      '[class*="card"]'
    ];

    let cards = [];
    for (const sel of selectors) {
      cards = Array.from(document.querySelectorAll(sel));
      if (cards.length > 0) break;
    }

    cards.forEach(card => {
      const nameEl = card.querySelector(
        'h2,h3,h4,.name,.title,.business-name,.listing-title,[class*="name"],[class*="title"]'
      );
      const name = nameEl ? (nameEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (!name || name.length < 2) return;

      const addrEl = card.querySelector(
        '.address,[itemprop="streetAddress"],.location,[class*="address"]'
      );
      const address = addrEl ? (addrEl.textContent || '').replace(/\s+/g, ' ').trim() : '';

      const telEl = card.querySelector('a[href^="tel:"]');
      const phone = telEl ? telEl.getAttribute('href').replace('tel:', '').trim() : '';

      // Get detail page URL from "Show Number & full details" link
      let url = '';
      const links = card.querySelectorAll('a[href]');
      for (const link of links) {
        const t = (link.textContent || '').toLowerCase();
        const href = link.getAttribute('href') || '';
        if (t.includes('show number') || t.includes('full details') || /\/\d{4,}\//.test(href)) {
          url = href.startsWith('http') ? href : `${base}${href}`;
          break;
        }
      }

      const key = url || name;
      if (seen.has(key)) return;
      seen.add(key);

      businesses.push({
        name,
        category: cat.name,
        address,
        phone,
        city: cityName,
        state: 'Karnataka',
        source_url: url || base
      });
    });

    return businesses;
  }, { base: cityBase, cat: category, cityName: city });
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
