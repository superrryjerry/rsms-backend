const express = require('express');
const { getDb } = require('../../config/db');

const router = express.Router();

// GET /api/admin/config
router.get('/', (req, res) => {
  const db = getDb();
  const list = db.prepare('SELECT * FROM sys_config').all();
  res.json({ code: 0, data: list });
});

// PUT /api/admin/config
router.put('/', (req, res) => {
  const { configs } = req.body;
  if (!Array.isArray(configs)) return res.status(400).json({ code: 400, msg: 'configs 必须为数组' });
  const db = getDb();
  const stmt = db.prepare('INSERT OR REPLACE INTO sys_config (config_key, config_value) VALUES (?, ?)');
  const tx = db.transaction(() => { configs.forEach(c => stmt.run(c.config_key, c.config_value)); });
  tx();
  res.json({ code: 0, msg: '配置已更新' });
});

module.exports = router;
