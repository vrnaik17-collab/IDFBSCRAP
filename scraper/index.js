const { chromium } = require("playwright");

async function runScraper() {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  const businesses = [];

  try {
    console.log("Opening website...");

    await page.goto("https://bangalore.idbf.in/ac-dealers", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(3000);

    console.log("Extracting businesses...");

    const data = await page.evaluate(() => {
      const cards = document.querySelectorAll("a");

      const results = [];

      cards.forEach((card) => {
        const text = card.innerText || "";
        const href = card.href || "";

        if (
          text &&
          href &&
          text.length > 3 &&
          href.includes("bangalore.idbf.in")
        ) {
          results.push({
            name: text.trim(),
            category: "AC Dealer",
            address: "",
            phone: "",
            city: "Bangalore",
            state: "Karnataka",
            source_url: href
          });
        }
      });

      return results;
    });

    const uniqueMap = new Map();

    data.forEach((item) => {
      if (!uniqueMap.has(item.source_url)) {
        uniqueMap.set(item.source_url, item);
      }
    });

    businesses.push(...uniqueMap.values());

    console.log(`Found ${businesses.length} businesses`);

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
