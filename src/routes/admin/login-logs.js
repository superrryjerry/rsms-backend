const express = require('express');
const { getDb } = require('../../config/db');

const router = express.Router();

// GET /api/admin/login-logs - 查询登录日志
router.get('/', (req, res) => {
  const db = getDb();
  const { phone, start_date, end_date, page = 1, page_size = 20 } = req.query;
  
  let where = '1=1';
  const params = [];
  
  if (phone) {
    where += ' AND l.phone LIKE ?';
    params.push('%' + phone + '%');
  }
  
  if (start_date) {
    where += ' AND l.login_time >= ?';
    params.push(start_date);
  }
  
  if (end_date) {
    where += ' AND l.login_time <= ?';
    params.push(end_date + ' 23:59:59');
  }
  
  // 总数
  const countRow = db.prepare('SELECT COUNT(*) as total FROM login_logs l WHERE ' + where).get(...params);
  const total = countRow ? countRow.total : 0;
  
  // 分页查询
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  const list = db.prepare(
    'SELECT l.id, l.user_id, l.phone, l.login_time, l.ip_address, l.user_agent, l.status, u.name as user_name, u.dealer_code ' +
    'FROM login_logs l LEFT JOIN users u ON l.user_id = u.id ' +
    'WHERE ' + where + ' ORDER BY l.login_time DESC LIMIT ? OFFSET ?'
  ).all(...params, parseInt(page_size), offset);
  
  res.json({
    code: 0,
    data: {
      list,
      total,
      page: parseInt(page),
      page_size: parseInt(page_size)
    }
  });
});

// GET /api/admin/login-logs/summary - 用户登录汇总（最近登录时间）
router.get('/summary', (req, res) => {
  const db = getDb();
  const { phone } = req.query;
  
  let where = '1=1';
  const params = [];
  
  if (phone) {
    where += ' AND l.phone LIKE ?';
    params.push('%' + phone + '%');
  }
  
  const list = db.prepare(
    'SELECT l.phone, u.name as user_name, u.dealer_code, ' +
    'MAX(l.login_time) as last_login_time, ' +
    'COUNT(*) as login_count ' +
    'FROM login_logs l LEFT JOIN users u ON l.user_id = u.id ' +
    'WHERE ' + where + ' GROUP BY l.phone ORDER BY last_login_time DESC'
  ).all(...params);
  
  res.json({ code: 0, data: list });
});

module.exports = router;
