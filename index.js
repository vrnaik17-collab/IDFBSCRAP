require("dotenv").config();

const scraper = require("./scraper");
const supabase = require("./database/supabase");

async function saveBusinesses(businesses) {
  try {
    if (!businesses || businesses.length === 0) {
      console.log("No businesses found.");
      return;
    }

    const formattedBusinesses = businesses.map((business) => ({
      name: business.name || "",
      category: business.category || "",
      address: business.address || "",
      phone: business.phone || "",
      city: business.city || "",
      state: business.state || "",
      source_url: business.source_url || business.url || ""
    }));

    console.log(`Saving ${formattedBusinesses.length} businesses...`);

    const { data, error } = await supabase
      .from("businesses")
      .upsert(formattedBusinesses, {
        onConflict: "source_url"
      });

    if (error) {
      console.error("Supabase Error:");
      console.error(error);
      return;
    }

    console.log("Businesses saved successfully.");
    console.log(data);
  } catch (err) {
    console.error("Save Error:");
    console.error(err);
  }
}

async function run() {
  try {
    console.log("Starting scraper...");

    const businesses = await scraper();

    console.log(`Scraped ${businesses.length} businesses`);

    await saveBusinesses(businesses);

    console.log("Scraper completed.");
  } catch (err) {
    console.error("Scraper Failed:");
    console.error(err);
    process.exit(1);
  }
}

run();
