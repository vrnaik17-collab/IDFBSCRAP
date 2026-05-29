const { randomDelay, withRetry, cleanText } = require('../utils/helpers');
const { autoScroll } = require('./categoryExtractor');
const logger = require('../utils/logger');

const MIN_DELAY = parseInt(process.env.MIN_DELAY_MS) || 1500;
const MAX_DELAY = parseInt(process.env.MAX_DELAY_MS) || 3000;

function getCityBase() {
  return process.env.CITY_BASE_URL || process.env.BASE_URL || 'https://bangalore.idbf.in';
}

function getCityName() {
  try {
    const base = getCityBase();
    const host = new URL(base).hostname;
    const city = host.split('.')[0];
    return city.charAt(0).toUpperCase() + city.slice(1);
  } catch { return 'Bangalore'; }
}

async function scrapeCategory(page, category) {
  const businesses = [];
  let currentUrl = category.url;
  let pageNum = 1;
  const cityBase = getCityBase();
  const city = getCityName();

  logger.info(`\nScraping: "${category.name}" | ${category.url}`);

  while (currentUrl) {
    try {
      logger.info(`  Page ${pageNum}: ${currentUrl}`);

      await withRetry(() => page.goto(currentUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      }), 3, 3000, `goto ${currentUrl}`);

      await page.waitForTimeout(4000);
      await autoScroll(page);
      await page.waitForTimeout(2000);

      // Extract all "Show Number & full details" button links
      // These are the business detail page links on the listing page
      const businessLinks = await page.evaluate(({ base }) => {
        const links = [];
        const seen = new Set();

        // Look for "Show Number & full details" buttons
        document.querySelectorAll('a[href]').forEach(el => {
          const text = (el.textContent || '').toLowerCase().trim();
          let href = el.getAttribute('href') || '';

          if (!href.startsWith('http')) {
            href = href.startsWith('/') ? `${base}${href}` : '';
          }
          if (!href.startsWith(base)) return;

          // Match "Show Number & full details" links
          if (text.includes('show number') || text.includes('full details')) {
            if (!seen.has(href)) {
              seen.add(href);
              links.push(href);
            }
            return;
          }

          // Also match business detail URLs: /DIGITS/slug
          const path = href.replace(base, '');
          if (/^\/\d{4,}\//.test(path) && !seen.has(href)) {
            seen.add(href);
            links.push(href);
          }
        });

        return links;
      }, { base: cityBase });

      logger.info(`  Found ${businessLinks.length} business links`);

      if (businessLinks.length === 0) {
        // Try inline extraction
        const inline = await extractInlineBusinesses(page, category, city, cityBase);
        if (inline.length > 0) {
          logger.info(`  Extracted ${inline.length} inline`);
          businesses.push(...inline);
        } else {
          logger.warn(`  No businesses found on page ${pageNum}`);
        }
      } else {
        for (let i = 0; i < businessLinks.length; i++) {
          const url = businessLinks[i];
          logger.info(`  [${i + 1}/${businessLinks.length}] ${url}`);

          try {
            const biz = await scrapeBusinessDetail(page, url, category, city);
            if (biz && biz.name) {
              businesses.push(biz);
              logger.info(`  ✓ ${biz.name} | ${biz.phone || 'no phone'}`);
            }
          } catch (err) {
            logger.error(`  ✗ ${url}: ${err.message}`);
          }

          // Go back to listing page
          try {
            await page.goto(currentUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 60000
            });
            await page.waitForTimeout(2000);
          } catch (err) {
            logger.warn(`  Could not go back: ${err.message}`);
          }

          await randomDelay(MIN_DELAY, MAX_DELAY);
        }
      }

      // Next page
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

  logger.info(`"${category.name}" done: ${businesses.length} businesses`);
  return businesses;
}

async function scrapeBusinessDetail(page, url, category, city) {
  return withRetry(async () => {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await page.waitForTimeout(3000);

    // The phone is already visible on the detail page
    // as seen in screenshot: "MOBILE NUMBER 9341247042"
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

      // Business name — h1
      const name = get([
        'h1', 'h1.listing-title', 'h1.business-name',
        'h1.entry-title', '.business-name', '.listing-name',
        '[itemprop="name"]', '.company-name'
      ]);

      // Address — from ADDRESS section
      const address = get([
        '[itemprop="streetAddress"]', '[itemprop="address"]',
        '.address', '.listing-address', '.full-address',
        '.business-address', '[class*="address"]'
      ]);

      // City/State — from CITY / STATE section
      const cityState = get([
        '[itemprop="addressLocality"]', '.city-state',
        '[class*="city"]', '[class*="location"]'
      ]);

      // State
      const state = get([
        '[itemprop="addressRegion"]', '.state',
        '[class*="state"]'
      ]) || 'Karnataka';

      // Phone — MOBILE NUMBER section visible directly
      // Look for tel: links and phone number containers
      const telEl = document.querySelector('a[href^="tel:"]');
      const telPhone = telEl
        ? telEl.getAttribute('href').replace('tel:', '').trim()
        : '';

      // Also scan for phone in text — mobile number label
      let phoneFromText = '';
      const allText = document.body.innerText || '';
      const phoneMatch = allText.match(/(?:mobile number|phone|contact)[:\s]*([6-9]\d{9})/i);
      if (phoneMatch) phoneFromText = phoneMatch[1];

      // Direct number scan
      const directMatch = allText.match(/[6-9]\d{9}/);
      const directPhone = directMatch ? directMatch[0] : '';

      return {
        name,
        address,
        cityState,
        state,
        telPhone,
        phoneFromText,
        directPhone
      };
    });

    // Pick best phone
    const phone = data.telPhone || data.phoneFromText || data.directPhone || '';

    return {
      name: cleanText(data.name),
      category: cleanText(category.name),
      address: cleanText(data.address),
      phone: cleanText(phone),
      city: city,
      state: cleanText(data.state) || 'Karnataka',
      source_url: url
    };
  }, 3, 2000, 'scrapeBusinessDetail');
}

async function extractInlineBusinesses(page, category, city, cityBase) {
  return await page.evaluate(({ base, cat, cityName }) => {
    const businesses = [];
    const seen = new Set();

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
        'h1,h2,h3,h4,.name,.title,.business-name,.listing-title,[class*="name"]'
      );
      const name = nameEl
        ? (nameEl.textContent || '').replace(/\s+/g, ' ').trim()
        : '';
      if (!name || name.length < 2) return;

      const addrEl = card.querySelector(
        '.address,[itemprop="streetAddress"],.location,[class*="address"]'
      );
      const address = addrEl
        ? (addrEl.textContent || '').replace(/\s+/g, ' ').trim()
        : '';

      const telEl = card.querySelector('a[href^="tel:"]');
      const phone = telEl
        ? telEl.getAttribute('href').replace('tel:', '').trim()
        : '';

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
  }, { base: cityBase, cat: category, cityName: city });
}

async function getNextPageUrl(page, currentUrl) {
  return await page.evaluate(({ current }) => {
    const selectors = [
      'a[rel="next"]', 'a.next', '.pagination .next a',
      'a.page-numbers.next', 'li.next a',
      '[aria-label="Next page"] a', '[aria-label="Next"] a'
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
  }, { current: currentUrl });
}

module.exports = { scrapeCategory };
