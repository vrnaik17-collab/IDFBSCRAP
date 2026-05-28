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
      waitUntil: "networkidle",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    console.log("Collecting business links...");

    // Get all links from page
    const links = await page.$$eval("a", (elements) =>
      elements
        .map((el) => el.href)
        .filter(
          (href) =>
            href &&
            href.includes("bangalore.idbf.in") &&
            !href.includes("/ac-dealers")
        )
    );

    // Remove duplicates
    const uniqueLinks = [...new Set(links)];

    console.log(`Found ${uniqueLinks.length} business links`);

    // Visit each business page
    for (const link of uniqueLinks.slice(0, 50)) {
      try {
        console.log(`Opening: ${link}`);

        await page.goto(link, {
          waitUntil: "domcontentloaded",
          timeout: 60000
        });

        await page.waitForTimeout(2000);

        const business = await page.evaluate(() => {
          const bodyText = document.body.innerText;

          // Extract phone number
          const phoneMatch = bodyText.match(
            /(\+91[\s-]?)?[6-9]\d{9}/
          );

          // Business name
          const name =
            document.querySelector("h1")?.innerText?.trim() ||
            document.title ||
            "";

          // Try extracting address
          const address =
            bodyText
              .split("\n")
              .find(
                (line) =>
                  line.includes("Bangalore") ||
                  line.includes("Bengaluru")
              ) || "";

          return {
            name,
            category: "AC Dealer",
            address,
            phone: phoneMatch ? phoneMatch[0] : "",
            city: "Bangalore",
            state: "Karnataka",
            source_url: window.location.href
          };
        });

        // Save only if phone or name exists
        if (business.name || business.phone) {
          businesses.push(business);

          console.log(
            `Saved: ${business.name} | ${business.phone}`
          );
        }
      } catch (err) {
        console.log(`Failed: ${link}`);
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
