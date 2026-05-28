const { randomDelay, withRetry, cleanText } = require('../utils/helpers');
const { autoScroll } = require('./categoryExtractor');
const logger = require('../utils/logger');

const BASE_URL = process.env.BASE_URL || 'https://bangalore.idbf.in';
const MIN_DELAY = parseInt(process.env.MIN_DELAY_MS) || 2000;
const MAX_DELAY = parseInt(process.env.MAX_DELAY_MS) || 5000;

function getCityFromUrl() {
  try {
    const host = new URL(BASE_URL).hostname;
    const city = host.split('.')[0];
    return city.charAt(0).toUpperCase() + city.slice(1);
  } catch { return 'Bangalore'; }
}

async function scrapeCategory(page, category) {
  const businesses = [];
  let currentUrl = category.url;
  let pageNum = 1;
  const city = getCityFromUrl();

  logger.info(`Scraping: "${category.name}" | ${category.url}`);

  while (currentUrl) {
    try {
      logger.info(`  Page ${pageNum}: ${currentUrl}`);

      await withRetry(() => page.goto(currentUrl, {
        waitUntil: 'domcontentloaded', timeout: 60000
      }), 3, 3000, `goto ${currentUrl}`);

      await randomDelay(MIN_DELAY, MAX_DELAY);
      await autoScroll(page);

      const listingUrls = await extractListingUrls(page);

      if (listingUrls.length > 0) {
        logger.info(`  Found ${listingUrls.length} business listings on page ${pageNum}`);

        for (let i = 0; i < listingUrls.length; i++) {
          const url = listingUrls[i];
          logger.debug(`    [${i + 1}/${listingUrls.length}] ${url}`);
          try {
            const biz = await scrapeBusinessDetail(page, url, category, city);
            if (biz && biz.name) {
              businesses.push(biz);
              logger.info(`    ✓ ${biz.name} | ${biz.phone || 'no phone'}`);
            }
            await randomDelay(MIN_DELAY, MAX_DELAY);
          } catch (err) {
            logger.error(`    ✗ ${url}: ${err.message}`);
          }
        }
      } else {
        const inline = await extractInlineBusinesses(page, category, city);
        if (inline.length > 0) {
          logger.info(`  Extracted ${inline.length} businesses inline`);
          businesses.push(...inline);
        }
      }

      currentUrl = await getNextPageUrl(page, currentUrl);
      pageNum++;
      if (currentUrl) await randomDelay(MIN_DELAY + 1000, MAX_DELAY + 2000);

    } catch (err) {
      logger.error(`Page ${pageNum} error for "${category.name}": ${err.message}`);
      break;
    }
  }

  logger.info(`"${category.name}" done: ${businesses.length} businesses`);
  return businesses;
}

async function extractListingUrls(page) {
  return await page.evaluate((baseUrl) => {
    const urls = [];
    const seen = new Set();

    const allLinks = document.querySelectorAll('a[href]');
    allLinks.forEach(el => {
      let href = el.getAttribute('href') || '';
      if (!href.startsWith('http')) {
        href = href.startsWith('/') ? `${baseUrl}${href}` : '';
      }
      if (!href || !href.startsWith(baseUrl)) return;

      if (/\/\d{5,}\//.test(href) && !seen.has(href)) {
        seen.add(href);
        urls.push(href);
      }
    });
    return urls;
  }, BASE_URL);
}

async function scrapeBusinessDetail(page, url, category, city) {
  return withRetry(async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await randomDelay(1500, 3000);

    const phone = await revealAndExtractPhone(page);

    const data = await page.evaluate(() => {
      const get = (selectors) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (t) return t;
          }
        }
        return '';
      };

      const name = get([
        'h1.listing-title', 'h1.business-name', 'h1.entry-title',
        '.business-name h1', '.listing-name', 'h1', '.biz-name',
        '[itemprop="name"]', '.company-name'
      ]);

      const address = get([
        '[itemprop="streetAddress"]', '.address', '.listing-address',
        '.full-address', '.business-address', '[class*="address"]',
        '.street', '.location-text'
      ]);

      const state = get([
        '[itemprop="addressRegion"]', '.state', '[class*="state"]'
      ]) || 'Karnataka';

      const telLink = document.querySelector('a[href^="tel:"]');
      const telPhone = telLink ? telLink.getAttribute('href').replace('tel:', '').trim() : '';

      return { name, address, state, telPhone };
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
  }, 3, 2000, `scrapeDetail(${url})`);
}

async function revealAndExtractPhone(page) {
  const buttonSelectors = [
    'button:has-text("Show Number")',
    'a:has-text("Show Number")',
    'button:has-text("Show Phone")',
    'a:has-text("Show Phone")',
    'button:has-text("Click to Call")',
    'a:has-text("Click to Call")',
    '[class*="show-number"]',
    '[class*="show-phone"]',
    '[class*="reveal"]',
    '[data-action*="phone"]',
    '.phone-reveal',
    '.show-contact',
    'button.contact-number',
    'a.show-number'
  ];

  for (const sel of buttonSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.scrollIntoViewIfNeeded();
        await randomDelay(400, 800);
        await btn.click();
        logger.debug(`Clicked: ${sel}`);
        await randomDelay(1500, 2500);
        break;
      }
    } catch {}
  }

  try {
    await page.evaluate(() => {
      document.querySelectorAll('button, a, span, div').forEach(el => {
        const t = (el.textContent || '').toLowerCase().trim();
        if (t.includes('show number') || t.includes('show phone') ||
            t.includes('reveal') || t.includes('click to call')) {
          el.click();
        }
      });
    });
    await randomDelay(1000, 2000);
  } catch {}

  const phone = await page.evaluate(() => {
    const telLinks = document.querySelectorAll('a[href^="tel:"]');
    for (const el of telLinks) {
      const num = el.getAttribute('href').replace('tel:', '').trim();
      if (num && /\d{6,}/.test(num)) return num;
    }

    const phoneSelectors = [
      '[itemprop="telephone"]', '.phone', '.phone-number',
      '.contact-number', '.mobile', '.telephone',
      '[class*="phone"]', '[class*="mobile"]', '[class*="contact"]'
    ];
    for (const sel of phoneSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const t = (el.textContent || '').replace(/\s+/g, '').trim();
        if (/\d{7,}/.test(t)) return t;
      }
    }

    const text = document.body.innerText || '';
    const match = text.match(/(?:\+91[\s-]?)?[6-9]\d{9}|0\d{10}|\d{3,4}[\s-]\d{6,8}/);
    return match ? match[0].trim() : '';
  });

  return phone;
}

async function extractInlineBusinesses(page, category, city) {
  return await page.evaluate((baseUrl, cat, cityName) => {
    const businesses = [];
    const cards = document.querySelectorAll(
      '.listing-item, .business-card, .result-item, article, .entry, .list-item, .biz-item'
    );

    cards.forEach(card => {
      const nameEl = card.querySelector('h1,h2,h3,.title,.name,.business-name,.listing-title');
      const name = nameEl ? (nameEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (!name) return;

      const addrEl = card.querySelector('.address,[itemprop="streetAddress"],.location');
      const address = addrEl ? (addrEl.textContent || '').replace(/\s+/g, ' ').trim() : '';

      const telEl = card.querySelector('a[href^="tel:"]');
      const phone = telEl ? telEl.getAttribute('href').replace('tel:', '') : '';

      const linkEl = card.querySelector('a[href]');
      let url = linkEl ? linkEl.getAttribute('href') : '';
      if (url && !url.startsWith('http')) {
        url = url.startsWith('/') ? `${baseUrl}${url}` : `${baseUrl}/${url}`;
      }
      url = url || window.location.href;

      businesses.push({
        name, category: cat.name, address, phone,
        city: cityName, state: 'Karnataka', source_url: url
      });
    });

    return businesses;
  }, BASE_URL, category, city);
}

async function getNextPageUrl(page, currentUrl) {
  return await page.evaluate((current) => {
    const selectors = [
      'a[rel="next"]', 'a.next', '.pagination .next a',
      'a.page-numbers.next', '.wp-pagenavi a.nextpostslink',
      'li.next a', '[aria-label="Next page"] a', '[aria-label="Next"] a'
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
