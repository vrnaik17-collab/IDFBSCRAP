const logger = require('./logger');

/**
 * Random delay between min and max milliseconds
 */
async function randomDelay(min = 2000, max = 5000) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  logger.debug(`Waiting ${delay}ms`);
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Retry wrapper with exponential backoff
 */
async function withRetry(fn, retries = 3, baseDelay = 2000, label = 'operation') {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) {
        logger.error(`${label} failed after ${retries} attempts: ${err.message}`);
        throw err;
      }
      const backoff = baseDelay * Math.pow(2, attempt - 1);
      logger.warn(`${label} attempt ${attempt} failed. Retrying in ${backoff}ms...`, { error: err.message });
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
}

/**
 * Rotate through realistic user agents
 */
function getRandomUserAgent() {
  const agents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15'
  ];
  return agents[Math.floor(Math.random() * agents.length)];
}

/**
 * Clean and normalize text
 */
function cleanText(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').replace(/\n+/g, ' ').trim();
}

/**
 * Sanitize a string for use as a filename
 */
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Chunk array into smaller arrays
 */
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

module.exports = {
  randomDelay,
  withRetry,
  getRandomUserAgent,
  cleanText,
  sanitizeFilename,
  extractDomain,
  chunkArray
};
