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

    // CLICK BANGALORE CITY
    console.log("Clicking Bangalore city...");

    const bangalore = page.locator(
      'xpath=/html/body/div[5]/div[2]/div[16]/div[2]/div/a[2]'
    );

    await bangalore.click();

    await page.waitForTimeout(5000);

    console.log("Opened Bangalore page");

    // EXTRACT BUSINESS LINKS
    console.log("Collecting business links...");

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
            item.href.includes("idbf.in") &&
            item.text &&
            item.text.length > 2
        );
    });

    const uniqueLinks = [
      ...new Map(
        businessLinks.map((item) => [item.href, item])
      ).values()
    ];

    console.log(`Found ${uniqueLinks.length} links`);

    // OPEN BUSINESS PAGES
    for (const item of uniqueLinks.slice(0, 50)) {
      try {
        console.log(`Opening ${item.href}`);

        await page.goto(item.href, {
          waitUntil: "domcontentloaded",
          timeout: 60000
        });

        await page.waitForTimeout(3000);

        const business = await page.evaluate(() => {
          const text = document.body.innerText;

          // PHONE
          const phoneMatch = text.match(
            /(\+91[\s-]?)?[6-9]\d{9}/
          );

          // ADDRESS
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

            category: "Business",

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
