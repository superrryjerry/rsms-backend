const express = require('express');
const { getDb } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/workorders/list
router.get('/list', (req, res) => {
  const { page = 1, size = 20, keyword } = req.query;
  const db = getDb();
  let where = '1=1';
  const params = [];
  if (keyword) {
    where += ' AND (w.vin LIKE ? OR w.order_no LIKE ? OR w.order_type LIKE ? OR v.customer_name LIKE ?)';
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const total = db.prepare(`SELECT COUNT(*) as c FROM work_orders w LEFT JOIN vehicles v ON w.vin = v.vin WHERE ${where}`).get(...params).c;
  const list = db.prepare(`SELECT w.*, v.customer_name, v.service_dealer as dealer_code FROM work_orders w LEFT JOIN vehicles v ON w.vin = v.vin WHERE ${where} ORDER BY w.order_date DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(size), (Number(page) - 1) * Number(size));
  res.json({ code: 0, data: { total, list, page: Number(page), size: Number(size) } });
});

module.exports = router;
