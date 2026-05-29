const { chromium } = require('playwright');
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
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security',
      '--disable-infobars',
      '--window-size=1366,768',
      '--ignore-certificate-errors',
      '--allow-running-insecure-content'
    ]
  });

  return browser;
}

async function createContext(browserInstance) {
  const context = await browserInstance.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    extraHTTPHeaders: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0'
    }
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' }
      ]
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-IN', 'en-GB', 'en-US', 'en']
    });
    window.chrome = {
      runtime: {
        onConnect: { addListener: () => {} },
        onMessage: { addListener: () => {} }
      },
      loadTimes: () => {},
      csi: () => {},
      app: {}
    };
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
  });

  return context;
}

async function createPage(context) {
  const page = await context.newPage();

  await page.route('**/*', (route) => {
    const url = route.request().url();
    const blocked = [
      'google-analytics.com', 'googletagmanager.com',
      'facebook.com', 'doubleclick.net', 'hotjar.com',
      'clarity.ms', 'analytics.js'
    ];
    if (blocked.some(d => url.includes(d))) {
      route.abort();
    } else {
      route.continue();
    }
  });

  return page;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    logger.info('Browser closed');
  }
}

module.exports = { launchBrowser, createContext, createPage, closeBrowser };
