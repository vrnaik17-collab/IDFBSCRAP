const { createObjectCsvWriter } = require('csv-writer');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

const outputDir = process.env.OUTPUT_DIR || './output';

async function exportToCSV(businesses, filename = 'businesses.csv') {
  if (!businesses || businesses.length === 0) {
    logger.warn('No businesses to export to CSV');
    return null;
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filePath = path.join(outputDir, filename);

  const csvWriter = createObjectCsvWriter({
    path: filePath,
    header: [
      { id: 'name',       title: 'Business Name' },
      { id: 'category',   title: 'Category'      },
      { id: 'address',    title: 'Address'        },
      { id: 'phone',      title: 'Phone'          },
      { id: 'city',       title: 'City'           },
      { id: 'state',      title: 'State'          },
      { id: 'source_url', title: 'Source URL'     }
    ]
  });

  await csvWriter.writeRecords(businesses);
  logger.info(`CSV exported: ${filePath} (${businesses.length} records)`);
  return filePath;
}

module.exports = { exportToCSV };
