const { chromium } = require("playwright");

async function runScraper() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox"
    ]
  });

  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: {
      width: 1366,
      height: 768
    }
  });

  // Stealth fixes
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => false
    });
  });

  const businesses = [];

  try {
    console.log("Opening IDBF homepage...");

    // DO NOT wait for full load
    await page.goto("https://idbf.in/", {
      waitUntil: "commit",
      timeout: 120000
    });

    // Manual delay instead
    await page.waitForTimeout(15000);

    console.log("Page opened");

    // Screenshot debug
    await page.screenshot({
      path: "homepage.png"
    });

    // CLICK BANGALORE
    console.log("Clicking Bangalore city...");

    const bangalore = page.locator(
      'a.city-tag[href*="bangalore"]'
    );

    await bangalore.waitFor({
      timeout: 30000
    });

    await bangalore.click();

    await page.waitForTimeout(10000);

    console.log("Opened Bangalore page");

    // GET BUSINESS LINKS
    const businessLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));

      return links
        .map((link) => ({
          href: link.href,
          text: link.innerText?.trim()
        }))
        .filter(
          (item) =>
            item.href &&
            item.href.includes("bangalore.idbf.in")
        );
    });

    const uniqueLinks = [
      ...new Map(
        businessLinks.map((item) => [item.href, item])
      ).values()
    ];

    console.log(`Found ${uniqueLinks.length} links`);

    for (const item of uniqueLinks.slice(0, 50)) {
      try {
        console.log(`Opening ${item.href}`);

        await page.goto(item.href, {
          waitUntil: "commit",
          timeout: 120000
        });

        await page.waitForTimeout(5000);

        const business = await page.evaluate(() => {
          const text = document.body.innerText;

          const phoneMatch = text.match(
            /(\+91[\s-]?)?[6-9]\d{9}/
          );

          return {
            name:
              document.querySelector("h1")?.innerText?.trim() ||
              document.title ||
              "",

            category: "Business",

            address: "",

            phone: phoneMatch ? phoneMatch[0] : "",

            city: "Bangalore",

            state: "Karnataka",

            source_url: window.location.href
          };
        });

        if (business.name || business.phone) {
          businesses.push(business);

          console.log(
            `Saved: ${business.name} | ${business.phone}`
          );
        }
      } catch (err) {
        console.log(`Failed: ${item.href}`);
      }
    }

    console.log(`Total businesses scraped: ${businesses.length}`);

    await browser.close();

    return businesses;
  } catch (err) {
    console.error("Scraper Error:");
    console.error(err);

    await browser.close();

    return [];
  }
}

module.exports = runScraper;
