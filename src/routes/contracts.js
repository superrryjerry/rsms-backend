const express = require('express');
const { getDb } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/contracts/list
router.get('/list', (req, res) => {
  const { page = 1, size = 20, keyword } = req.query;
  const db = getDb();
  let where = '1=1';
  const params = [];
  if (keyword) {
    where += ' AND (c.vin LIKE ? OR v.customer_name LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const total = db.prepare(`SELECT COUNT(*) as c FROM contracts c LEFT JOIN vehicles v ON c.vin = v.vin WHERE ${where}`).get(...params).c;
  const list = db.prepare(`SELECT c.*, v.service_dealer, v.customer_name FROM contracts c LEFT JOIN vehicles v ON c.vin = v.vin WHERE ${where} ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(size), (Number(page) - 1) * Number(size));
  res.json({ code: 0, data: { total, list, page: Number(page), size: Number(size) } });
});

module.exports = router;
