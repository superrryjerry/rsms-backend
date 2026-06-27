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
    .get(req.user.dealer_code, 'unfollowed');
  res.json({ code: 0, data: { count: row.c } });
});

// POST /api/leads/:id/read
router.post('/:id/read', (req, res) => {
  const db = getDb();
  db.prepare("UPDATE leads SET status = 'following', read_at = datetime('now') WHERE id = ? AND target_dealer = ?")
    .run(req.params.id, req.user.dealer_code);
  res.json({ code: 0, msg: '已标记为跟进中' });
});

// PUT /api/leads/:id/status - 更新线索状态
router.put('/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['unfollowed', 'following', 'completed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ code: 400, msg: '无效的状态值' });
  }

  const db = getDb();
  const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND target_dealer = ?')
    .get(req.params.id, req.user.dealer_code);
  
  if (!lead) return res.status(404).json({ code: 404, msg: '线索不存在' });

  db.prepare("UPDATE leads SET status = ?, read_at = datetime('now') WHERE id = ?")
    .run(status, req.params.id);
  
  const statusMap = { unfollowed: '未跟进', following: '跟进中', completed: '已结束' };
  res.json({ code: 0, msg: `状态已更新为${statusMap[status]}` });
});

// POST /api/leads/:id/handle - 标记为已结束（兼容旧接口）
router.post('/:id/handle', (req, res) => {
  const db = getDb();
  db.prepare("UPDATE leads SET status = 'completed', read_at = datetime('now') WHERE id = ? AND target_dealer = ?")
    .run(req.params.id, req.user.dealer_code);
  res.json({ code: 0, msg: '已标记为已结束' });
});

module.exports = router;
