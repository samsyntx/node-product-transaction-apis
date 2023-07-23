const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const axios = require('axios');

// Define Database
const databasePath = path.join(__dirname, "sqlite.db");

// Calling express
const app = express();
app.use(express.json());

// Initialization the Database and Server
let database = null;

const initializationDatabaseAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    // Create "products" table if it doesn't exist
    await database.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INT PRIMARY KEY,
        title TEXT,
        price REAL,
        description TEXT,
        category TEXT,
        image TEXT,
        sold BOOLEAN,
        dateOfSale TEXT
      )
    `);

    app.listen(3000, console.log("Server is Running on http://localhost:3000/"));
  } catch (error) {
    console.log(`Server Error: ${error.message}`);
    process.exit(1);
  }
};

initializationDatabaseAndServer();

// Function to insert all the seed data into the database
async function insertSeedData(seedData) {
  const insertQuery = `
    INSERT INTO products (id, title, price, description, category, image, sold, dateOfSale)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  // Using a transaction for better performance
  await database.run('BEGIN TRANSACTION');

  try {
    for (const data of seedData) {
      const { id, title, price, description, category, image, sold, dateOfSale } = data;
      const idInt = parseInt(id);

      // Check if the ID already exists in the database
      const existingProduct = await database.get('SELECT id FROM products WHERE id = ?', [idInt]);
      if (existingProduct) {
        // Send an error response if ID already exists
        await database.run('ROLLBACK');
        throw new Error(`Product with ID ${idInt} already exists in the database.`);
      }

      await database.run(insertQuery, [idInt, title, price, description, category, image, sold, dateOfSale]);
    }

    await database.run('COMMIT');
  } catch (error) {
    throw error;
  }
}

// Endpoint to initialize the database with seed data
app.get('/initialize-database', async (req, res) => {
  try {
    const axiosResponse = await axios.get('https://s3.amazonaws.com/roxiler.com/product_transaction.json');
    const seedData = axiosResponse.data;
    await insertSeedData(seedData);
    res.json({ message: 'Database initialized with seed data.' });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

// Middleware to validate the month input
const validMonths = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function validateMonth(req, res, next) {
  const { month } = req.query;
  if (!month || !validMonths.includes(month)) {
    res.status(400).json({ error: 'Invalid month. Please provide a valid month between January to December.' });
  } else {
    next();
  }
}

// API to get statistics for a selected month
app.get('/statistics', validateMonth, async (req, res) => {
  try {
    const { month } = req.query;

    // Convert the month name to num
    const monthNumber = (validMonths.indexOf(month) + 1).toString().padStart(2, '0');

    const queryTotalSaleAmount = `
      SELECT SUM(price) AS totalSaleAmount
      FROM products
      WHERE strftime('%m', dateOfSale) = ?
    `;
    const queryTotalSoldItems = `
      SELECT COUNT(*) AS totalSoldItems
      FROM products
      WHERE strftime('%m', dateOfSale) = ? AND sold = 1
    `;
    const queryTotalNotSoldItems = `
      SELECT COUNT(*) AS totalNotSoldItems
      FROM products
      WHERE strftime('%m', dateOfSale) = ? AND sold = 0
    `;

    const resultTotalSaleAmount = await database.get(queryTotalSaleAmount, [monthNumber]);
    const resultTotalSoldItems = await database.get(queryTotalSoldItems, [monthNumber]);
    const resultTotalNotSoldItems = await database.get(queryTotalNotSoldItems, [monthNumber]);

    const totalSaleAmount = resultTotalSaleAmount.totalSaleAmount || 0;
    const totalSoldItems = resultTotalSoldItems.totalSoldItems || 0;
    const totalNotSoldItems = resultTotalNotSoldItems.totalNotSoldItems || 0;

    res.json({ totalSaleAmount, totalSoldItems, totalNotSoldItems });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching statistics.' });
  }
});


// API to get bar chart data for a selected month
app.get('/bar-chart', validateMonth, async (req, res) => {
  try {
    const { month } = req.query;

    // Convert the month name to num
    const monthNumber = (validMonths.indexOf(month) + 1).toString().padStart(2, '0');

    const queryBarChart = `
      SELECT
        CASE
          WHEN price >= 0 AND price <= 100 THEN '0 - 100'
          WHEN price > 100 AND price <= 200 THEN '101 - 200'
          WHEN price > 200 AND price <= 300 THEN '201 - 300'
          WHEN price > 300 AND price <= 400 THEN '301 - 400'
          WHEN price > 400 AND price <= 500 THEN '401 - 500'
          WHEN price > 500 AND price <= 600 THEN '501 - 600'
          WHEN price > 600 AND price <= 700 THEN '601 - 700'
          WHEN price > 700 AND price <= 800 THEN '701 - 800'
          WHEN price > 800 AND price <= 900 THEN '801 - 900'
          WHEN price > 900 THEN '901-above'
        END AS priceRange,
        COUNT(*) AS itemCount
      FROM products
      WHERE strftime('%m', dateOfSale) = ?
      GROUP BY priceRange
    `;

    const result = await database.all(queryBarChart, [monthNumber]);

    const barChartData = result.map((row) => ({
      priceRange: row.priceRange,
      itemCount: row.itemCount
    }));

    res.json(barChartData);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching bar chart data.' });
  }
});

// API to get pie chart data for a selected month
app.get('/pie-chart', validateMonth, async (req, res) => {
  try {
    const { month } = req.query;

    // Convert the month name to num
    const monthNumber = (validMonths.indexOf(month) + 1).toString().padStart(2, '0');

    const queryPieChart = `
      SELECT category, COUNT(*) AS itemCount
      FROM products
      WHERE strftime('%m', dateOfSale) = ?
      GROUP BY category
    `;

    const result = await database.all(queryPieChart, [monthNumber]);

    const pieChartData = result.map((row) => ({
      category: row.category,
      itemCount: row.itemCount
    }));

    res.json(pieChartData);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching pie chart data.' });
  }
});

// API to fetch data from all the three APIs and combine the response
app.get('/combined-data', validateMonth, async (req, res) => {
  try {
    const { month } = req.query;

    // Convert the month name to its numeric representation (e.g., January -> 01, February -> 02, etc.)
    const monthNumber = (validMonths.indexOf(month) + 1).toString().padStart(2, '0');

    // URLs for the three APIs
    const statisticsURL = `http://localhost:3000/statistics?month=${month}`;
    const barChartURL = `http://localhost:3000/bar-chart?month=${month}`;
    const pieChartURL = `http://localhost:3000/pie-chart?month=${month}`;

    // Make concurrent requests to all three APIs
    const [statisticsResponse, barChartResponse, pieChartResponse] = await Promise.all([
      axios.get(statisticsURL),
      axios.get(barChartURL),
      axios.get(pieChartURL)
    ]);

    // Extract the data from the responses
    const statisticsData = statisticsResponse.data;
    const barChartData = barChartResponse.data;
    const pieChartData = pieChartResponse.data;

    // Combine the responses into a single JSON object
    const combinedData = {
      statistics: statisticsData,
      barChart: barChartData,
      pieChart: pieChartData
    };

    res.json(combinedData);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching combined data.' });
  }
});
