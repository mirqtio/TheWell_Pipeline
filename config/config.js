require('dotenv').config(); // Make sure to install dotenv: npm install dotenv

module.exports = {
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    dialect: 'postgres',
    dialectOptions: {
      ssl: process.env.DB_SSL === 'true' ? { require: true, rejectUnauthorized: false } : false,
    },
    logging: process.env.DB_LOGGING === 'true' ? console.log : false,
  },
  // You can add 'development' and 'test' configurations here if needed
  // development: { ... },
  // test: { ... }
};