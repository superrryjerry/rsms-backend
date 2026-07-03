const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../../config/db');
const { authMiddleware, adminOnly } = require('../../middleware/auth');

const router = express.Router();
router.use(authMiddleware, adminOnly);

// 文件上传配置
const upload = multer({ dest: path.join(__dirname, '../../uploads/temp') });

// GET /api/admin/customer-tags/list - 客户标签列表
router.get('/list', (req, res) => {
  const { page = 1, size = 20, keyword, tag } = req.query;
  const db = getDb();
  let where = 'c.tag IS NOT NULL AND c.tag != ""';
  const params = [];

  if (keyword) {
    where += ' AND c.customer_name LIKE ?';
    params.push(`%${keyword}%`);
  }
  if (tag) {
    where += ' AND c.tag = ?';
    params.push(tag);
  }

  const total = db.prepare(`SELECT COUNT(*) as c FROM customers c WHERE ${where}`).get(...params).c;
  const list = db.prepare(`SELECT c.rowid as id, c.customer_name, c.tag, c.city, c.service_dealers_summary, c.updated_at
    FROM customers c WHERE ${where} ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(size), (Number(page) - 1) * Number(size));

  res.json({ code: 0, data: { total, list, page: Number(page), size: Number(size) } });
});

// GET /api/admin/customer-tags/export - 导出客户标签
router.get('/export', (req, res) => {
  const { keyword, tag } = req.query;
  const db = getDb();
  let where = 'c.tag IS NOT NULL AND c.tag != ""';
  const params = [];

  if (keyword) {
    where += ' AND c.customer_name LIKE ?';
    params.push(`%${keyword}%`);
  }
  if (tag) {
    where += ' AND c.tag = ?';
    params.push(tag);
  }

  const list = db.prepare(`SELECT c.customer_name, c.tag, c.city, c.service_dealers_summary, c.updated_at
    FROM customers c WHERE ${where} ORDER BY c.updated_at DESC`).all(...params);

  const tagMap = { core: '核心', focus: '焦点', oasis: '绿洲', desert: '沙漠' };
  const data = list.map(r => ({
    '客户名称': r.customer_name,
    '标签': tagMap[r.tag] || r.tag,
    '所在市': r.city || '',
    '服务经销商': r.service_dealers_summary || '',
    '更新时间': r.updated_at || ''
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, '客户标签');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', `attachment; filename=customer_tags_${Date.now()}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// GET /api/admin/customer-tags/template - 下载导入模板
router.get('/template', (req, res) => {
  const data = [
    { '客户名称': '示例客户A', '标签': '核心', '所在市': '杭州' },
    { '客户名称': '示例客户B', '标签': '焦点', '所在市': '上海' }
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, '客户标签模板');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', `attachment; filename=customer_tags_template.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// POST /api/admin/customer-tags/import - 导入客户标签
router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ code: 400, msg: '请上传文件' });

  const db = getDb();
  const tagMapReverse = { '核心': 'core', '焦点': 'focus', '绿洲': 'oasis', '沙漠': 'desert' };

  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    let success = 0, fail = 0;
    const stmt = db.prepare('UPDATE customers SET tag = ?, city = ?, updated_at = datetime("now") WHERE customer_name = ?');

    for (const row of rows) {
      const name = row['客户名称'] || row['customer_name'];
      const tagRaw = row['标签'] || row['tag'] || '';
      const city = row['所在市'] || row['city'] || '';

      const tag = tagMapReverse[tagRaw] || tagRaw.toLowerCase();

      if (!name) { fail++; continue; }

      const result = stmt.run(tag || null, city || null, name);
      if (result.changes > 0) success++;
      else fail++;
    }

    // 清理临时文件
    fs.unlinkSync(req.file.path);

    res.json({ code: 0, data: { total: rows.length, success, fail }, msg: '导入完成' });
  } catch (e) {
    res.json({ code: 500, msg: e.message });
  }
});

// DELETE /api/admin/customer-tags/:id - 删除客户标签
router.delete('/:id', (req, res) => {
  const db = getDb();
  const customer = db.prepare('SELECT customer_name FROM customers WHERE rowid = ?').get(req.params.id);
  if (!customer) return res.json({ code: 404, msg: '客户不存在' });

  db.prepare('UPDATE customers SET tag = NULL, updated_at = datetime("now") WHERE rowid = ?').run(req.params.id);
  res.json({ code: 0, msg: '删除成功' });
});

module.exports = router;
