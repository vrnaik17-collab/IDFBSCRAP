const { chromium } = require("playwright");

async function runScraper() {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36"
  });

  const businesses = [];

  try {
    console.log("Opening IDBF homepage...");

    await page.goto("https://idbf.in/", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    // STEP 1 — Find Bangalore city page
    console.log("Finding Bangalore city page...");

    const cityLink = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));

      const city = links.find((link) =>
        link.innerText.toLowerCase().includes("bangalore")
      );

      return city ? city.href : null;
    });

    console.log("City Link:", cityLink);

    if (!cityLink) {
      throw new Error("Bangalore city page not found");
    }

    // STEP 2 — Open Bangalore page
    await page.goto(cityLink, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    // STEP 3 — Find AC Dealers category
    console.log("Finding AC Dealers category...");

    const categoryLink = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));

      const category = links.find((link) =>
        link.innerText.toLowerCase().includes("ac dealers")
      );

      return category ? category.href : null;
    });

    console.log("Category Link:", categoryLink);

    if (!categoryLink) {
      throw new Error("AC Dealers category not found");
    }

    // STEP 4 — Open AC Dealers page
    await page.goto(categoryLink, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    // STEP 5 — Collect business links
    console.log("Collecting business links...");

    const businessLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));

      return links
        .map((link) => link.href)
        .filter(
          (href) =>
            href &&
            href.includes("idbf.in") &&
            !href.includes("/ac-dealers")
        );
    });

    // Remove duplicates
    const uniqueLinks = [...new Set(businessLinks)];

    console.log(`Found ${uniqueLinks.length} business links`);

    // STEP 6 — Visit business pages
    for (const link of uniqueLinks.slice(0, 50)) {
      try {
        console.log(`Opening business: ${link}`);

        await page.goto(link, {
          waitUntil: "domcontentloaded",
          timeout: 60000
        });

        await page.waitForTimeout(3000);

        const business = await page.evaluate(() => {
          const text = document.body.innerText;

          // Extract phone number
          const phoneMatch = text.match(
            /(\+91[\s-]?)?[6-9]\d{9}/
          );

          // Extract address
          const address =
            text
              .split("\n")
              .find(
                (line) =>
                  line.includes("Bangalore") ||
                  line.includes("Bengaluru")
              ) || "";

          return {
            name:
              document.querySelector("h1")?.innerText?.trim() ||
              document.title ||
              "",

            category: "AC Dealer",

            address,

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
        console.log(`Failed business page: ${link}`);
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
