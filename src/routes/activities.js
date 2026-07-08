const express = require('express');
const multer = require('multer');
const path = require('path');
const { getDb } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// 图片上传配置 - 安全加固
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => {
    // 文件名消毒：仅保留字母数字和短横线
    const safeExt = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').toLowerCase();
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`;
    cb(null, safeName);
  }
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('仅支持 JPG/PNG/GIF/WebP 图片格式'), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter
});

// GET /api/activities/list
router.get('/list', (req, res) => {
  const { page = 1, size = 20 } = req.query;
  const db = getDb();

  // 按经销商层级查询：一级经销商可看自己+子经销商的活动，二级只看自己的
  const userDealer = db.prepare('SELECT * FROM dealers WHERE dealer_code = ?').get(req.user.dealer_code);
  let userIds = [];

  if (userDealer && userDealer.level === 1) {
    // 一级经销商：查自己 + 所有子经销商的用户
    const subDealers = db.prepare('SELECT dealer_code FROM dealers WHERE parent_dealer_code = ?')
      .all(req.user.dealer_code);
    const allDealerCodes = [req.user.dealer_code, ...subDealers.map(d => d.dealer_code)];
    userIds = db.prepare(`SELECT id FROM users WHERE dealer_code IN (${allDealerCodes.map(() => '?').join(',')})`)
      .all(...allDealerCodes).map(u => u.id);
  }

  let where, params;
  if (userIds.length > 0) {
    where = `user_id IN (${userIds.map(() => '?').join(',')})`;
    params = [...userIds];
  } else {
    where = 'user_id = ?';
    params = [req.user.id];
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM sales_activities WHERE ${where}`).get(...params).c;
  const list = db.prepare(`SELECT * FROM sales_activities WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(size), (Number(page) - 1) * Number(size));
  res.json({ code: 0, data: { total, list, page: Number(page), size: Number(size) } });
});

// POST /api/activities/create
router.post('/create', (req, res) => {
  const { customer_name, visit_purpose, visit_method, visit_location, location_lat, location_lng, photos, visit_time, content, status } = req.body;
  if (!customer_name || !visit_method) return res.status(400).json({ code: 400, msg: '客户和拜访方式不能为空' });

  const db = getDb();
  const finalStatus = status === 'completed' && content ? 'completed' : 'draft';
  const completedAt = finalStatus === 'completed' ? new Date().toISOString() : null;

  const result = db.prepare(`INSERT INTO sales_activities (user_id, customer_name, visit_purpose, visit_method, visit_location, location_lat, location_lng, photos, visit_time, content, status, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.user.id, customer_name, visit_purpose || '', visit_method, visit_location || '', location_lat || null, location_lng || null, JSON.stringify(photos || []), visit_time || null, content || '', finalStatus, completedAt);

  res.json({ code: 0, data: { id: result.lastInsertRowid }, msg: '创建成功' });
});

// POST /api/activities/update/:id
router.post('/update/:id', (req, res) => {
  const { customer_name, visit_purpose, visit_method, visit_location, location_lat, location_lng, photos, visit_time, content } = req.body;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM sales_activities WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return res.json({ code: 404, msg: '活动不存在' });

  // 状态机：content 从空变非空 -> completed；从非空变空 -> draft
  let finalStatus, completedAt;
  if (content && !existing.content) {
    finalStatus = 'completed'; completedAt = new Date().toISOString();
  } else if (!content && existing.content) {
    finalStatus = 'draft'; completedAt = null;
  } else {
    finalStatus = content ? 'completed' : 'draft';
    completedAt = content ? (existing.completed_at || new Date().toISOString()) : null;
  }

  db.prepare(`UPDATE sales_activities SET customer_name=?, visit_purpose=?, visit_method=?, visit_location=?, location_lat=?, location_lng=?, photos=?, visit_time=?, content=?, status=?, completed_at=? WHERE id=?`)
    .run(customer_name || existing.customer_name, visit_purpose ?? existing.visit_purpose, visit_method || existing.visit_method, visit_location ?? existing.visit_location, location_lat ?? existing.location_lat, location_lng ?? existing.location_lng, JSON.stringify(photos || JSON.parse(existing.photos || '[]')), visit_time ?? existing.visit_time, content ?? existing.content, finalStatus, completedAt, req.params.id);

  res.json({ code: 0, msg: '更新成功' });
});

// POST /api/activities/upload
router.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? '文件大小不能超过5MB' : err.message;
        return res.status(400).json({ code: 400, msg });
      }
      return res.status(400).json({ code: 400, msg: err.message });
    }
    if (!req.file) return res.status(400).json({ code: 400, msg: '请选择文件' });
    const url = `/api/uploads/${req.file.filename}`;
    res.json({ code: 0, data: { url } });
  });
});

module.exports = router;
