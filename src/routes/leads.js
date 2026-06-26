const express = require('express');
const { getDb } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/leads/list
router.get('/list', (req, res) => {
  const { page = 1, size = 20, lead_type, status } = req.query;
  const db = getDb();
  let where = 'target_dealer = ?';
  const params = [req.user.dealer_code];

  if (lead_type) { where += ' AND lead_type = ?'; params.push(lead_type); }
  if (status) { where += ' AND status = ?'; params.push(status); }

  const total = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE ${where}`).get(...params).c;
  const list = db.prepare(`SELECT * FROM leads WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(size), (Number(page) - 1) * Number(size));
  res.json({ code: 0, data: { total, list, page: Number(page), size: Number(size) } });
});

// GET /api/leads/unread-count
router.get('/unread-count', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as c FROM leads WHERE target_dealer = ? AND status = ?')
    .get(req.user.dealer_code, 'pending');
  res.json({ code: 0, data: { count: row.c } });
});

// POST /api/leads/:id/read
router.post('/:id/read', (req, res) => {
  const db = getDb();
  db.prepare("UPDATE leads SET status = 'read', read_at = datetime('now') WHERE id = ? AND target_dealer = ?")
    .run(req.params.id, req.user.dealer_code);
  res.json({ code: 0, msg: '已标记为已读' });
});

// POST /api/leads/:id/handle
router.post('/:id/handle', (req, res) => {
  const db = getDb();
  db.prepare("UPDATE leads SET status = 'handled', read_at = datetime('now') WHERE id = ? AND target_dealer = ?")
    .run(req.params.id, req.user.dealer_code);
  res.json({ code: 0, msg: '已标记为已处理' });
});

module.exports = router;
