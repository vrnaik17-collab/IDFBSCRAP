const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

let supabase = null;

function getClient() {
  if (supabase) return supabase;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    logger.warn('Supabase credentials not set. DB inserts will be skipped.');
    return null;
  }

  supabase = createClient(url, key);
  logger.info('Supabase client initialized');
  return supabase;
}

/**
 * Insert a batch of businesses, skipping duplicates by source_url
 */
async function insertBusinesses(businesses) {
  const client = getClient();
  if (!client) return { inserted: 0, skipped: businesses.length };

  if (!businesses || businesses.length === 0) return { inserted: 0, skipped: 0 };

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches of 50
  const batchSize = 50;
  for (let i = 0; i < businesses.length; i += batchSize) {
    const batch = businesses.slice(i, i + batchSize);

    try {
      // Use upsert with onConflict on source_url to prevent duplicates
      // If your table has a unique constraint on source_url, this will skip dupes
      const { data, error } = await client
        .from('businesses')
        .upsert(batch, {
          onConflict: 'source_url',
          ignoreDuplicates: true
        })
        .select();

      if (error) {
        // Fallback: insert one by one if batch upsert not supported
        logger.warn(`Batch upsert failed, falling back to individual inserts: ${error.message}`);
        for (const biz of batch) {
          const result = await insertSingle(client, biz);
          if (result === 'inserted') inserted++;
          else if (result === 'skipped') skipped++;
          else errors++;
        }
      } else {
        inserted += data ? data.length : batch.length;
        logger.debug(`Batch inserted ${data ? data.length : batch.length} records`);
      }
    } catch (err) {
      logger.error(`Batch insert error: ${err.message}`);
      errors++;
    }
  }

  return { inserted, skipped, errors };
}

async function insertSingle(client, business) {
  try {
    // Check for duplicate by source_url
    const { data: existing } = await client
      .from('businesses')
      .select('id')
      .eq('source_url', business.source_url)
      .single();

    if (existing) return 'skipped';

    const { error } = await client.from('businesses').insert(business);
    if (error) {
      logger.error(`Insert error for ${business.name}: ${error.message}`);
      return 'error';
    }
    return 'inserted';
  } catch (err) {
    logger.error(`Single insert exception: ${err.message}`);
    return 'error';
  }
}

/**
 * Test database connection
 */
async function testConnection() {
  const client = getClient();
  if (!client) return false;

  try {
    const { error } = await client.from('businesses').select('id').limit(1);
    if (error) {
      logger.error(`DB connection test failed: ${error.message}`);
      return false;
    }
    logger.info('Database connection successful');
    return true;
  } catch (err) {
    logger.error(`DB connection exception: ${err.message}`);
    return false;
  }
}

module.exports = { insertBusinesses, testConnection };
