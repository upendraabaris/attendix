const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.HOST,
  port: process.env.PORT,
  user: process.env.USER1,
  password: process.env.PASSWORD,
  database: process.env.DATABASE,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: {
    rejectUnauthorized: false,
  },
});

module.exports = pool;
