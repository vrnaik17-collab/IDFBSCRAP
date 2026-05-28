require("dotenv").config();

const scraper = require("./scraper");

const {
  insertBusinesses,
  testConnection
} = require("./database/supabase");

async function run() {
  try {
    console.log("==================================");
    console.log("Starting scraper...");
    console.log("==================================");

    // Test DB connection
    const dbConnected = await testConnection();

    if (!dbConnected) {
      console.log("Database connection failed.");
      process.exit(1);
    }

    console.log("Database connected successfully.");

    // Run scraper
    const businesses = await scraper();

    console.log(`Scraped ${businesses.length} businesses`);

    if (!businesses || businesses.length === 0) {
      console.log("No businesses found.");
      process.exit(0);
    }

    // Insert into Supabase
    const result = await insertBusinesses(businesses);

    console.log("==================================");
    console.log("Insert Result:");
    console.log(result);
    console.log("==================================");

    console.log("Scraper completed successfully.");
  } catch (err) {
    console.error("==================================");
    console.error("Scraper Failed:");
    console.error(err);
    console.error("==================================");

    process.exit(1);
  }
}

run();
