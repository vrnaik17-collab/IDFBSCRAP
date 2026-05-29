const { chromium } = require('playwright');
const { getRandomUserAgent } = require('../utils/helpers');
const logger = require('../utils/logger');

let browser = null;

async function launchBrowser() {
  const headless = process.env.HEADLESS !== 'false';
  logger.info(`Launching Chromium browser (headless: ${headless})`);

  browser = await chromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1366,768'
    ]
  });

  return browser;
}

async function createContext(browserInstance) {
  const userAgent = getRandomUserAgent();
  logger.debug(`Using user agent: ${userAgent.substring(0, 60)}...`);

  const context = await browserInstance.newContext({
    userAgent,
    viewport: { width: 1366, height: 768 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    extraHTTPHeaders: {
      'Accept-Language': 'en-IN,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      // Referer makes it look like navigation came from the idbf.in homepage
      'Referer': 'https://idbf.in/'
    }
  });

  // Stealth: override navigator properties to avoid bot detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-IN', 'en'] });
    window.chrome = { runtime: {} };
  });

  return context;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    logger.info('Browser closed');
  }
}

async function createPage(context) {
  const page = await context.newPage();

  // Block unnecessary resources to speed up scraping
  await page.route('**/*', (route) => {
    const resourceType = route.request().resourceType();
    const blockedTypes = ['image', 'font', 'media'];
    const url = route.request().url();
    const blockedDomains = ['google-analytics.com', 'googletagmanager.com', 'facebook.com', 'doubleclick.net'];

    if (blockedTypes.includes(resourceType)) {
      route.abort();
    } else if (blockedDomains.some(d => url.includes(d))) {
      route.abort();
    } else {
      route.continue();
    }
  });

  return page;
}

module.exports = { launchBrowser, createContext, createPage, closeBrowser };
