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
// 按经销商隔离：只显示当前登录经销商的标签
router.get('/list', (req, res) => {
  try {
    const { page = 1, size = 20, keyword, tag, dealer_code } = req.query;
    const db = getDb();
    const currentDealerCode = req.user.dealer_code;
    
    // 优先使用传入的 dealer_code，否则使用当前用户的经销商
    const targetDealer = dealer_code || currentDealerCode;
    
    let where = 'ct.dealer_code = ?';
    const params = [targetDealer];

    if (keyword) {
      where += ' AND ct.customer_name LIKE ?';
      params.push(`%${keyword}%`);
    }
    if (tag) {
      where += ' AND ct.tag = ?';
      params.push(tag);
    }

    const total = db.prepare(`SELECT COUNT(*) as c FROM customer_tags ct WHERE ${where}`).get(...params).c;
    const list = db.prepare(`SELECT ct.id, ct.customer_name, ct.tag, ct.dealer_code, c.city, c.service_dealers_summary, ct.updated_at
      FROM customer_tags ct
      LEFT JOIN customers c ON ct.customer_name = c.customer_name
      WHERE ${where} ORDER BY ct.updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, Number(size), (Number(page) - 1) * Number(size));

    res.json({ code: 0, data: { total, list, page: Number(page), size: Number(size), dealer_code: targetDealer } });
  } catch (err) {
    console.error('[CustomerTags List Error]', err.message, err.stack);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// GET /api/admin/customer-tags/export - 导出客户标签
router.get('/export', (req, res) => {
  const { keyword, tag, dealer_code } = req.query;
  const db = getDb();
  const currentDealerCode = req.user.dealer_code;
  const targetDealer = dealer_code || currentDealerCode;
  
  let where = 'ct.dealer_code = ?';
  const params = [targetDealer];

  if (keyword) {
    where += ' AND ct.customer_name LIKE ?';
    params.push(`%${keyword}%`);
  }
  if (tag) {
    where += ' AND ct.tag = ?';
    params.push(tag);
  }

  const list = db.prepare(`SELECT ct.customer_name, ct.tag, ct.dealer_code, c.city, c.service_dealers_summary, ct.updated_at
    FROM customer_tags ct
    LEFT JOIN customers c ON ct.customer_name = c.customer_name
    WHERE ${where} ORDER BY ct.updated_at DESC`).all(...params);

  const tagMap = { core: '核心', focus: '焦点', oasis: '绿洲', desert: '沙漠' };
  const data = list.map(r => ({
    '客户名称': r.customer_name,
    '标签': tagMap[r.tag] || r.tag,
    '经销商代码': r.dealer_code,
    '所在市': r.city || '',
    '服务经销商': r.service_dealers_summary || '',
    '更新时间': r.updated_at || ''
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, '客户标签');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', `attachment; filename=customer_tags_${targetDealer}_${Date.now()}.xlsx`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// GET /api/admin/customer-tags/template - 下载导入模板
router.get('/template', (req, res) => {
  const data = [
    { '客户名称': '示例客户A', '标签': '核心' },
    { '客户名称': '示例客户B', '标签': '焦点' }
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, '客户标签模板');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename=customer_tags_template.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// POST /api/admin/customer-tags/import - 导入客户标签
// 导入的标签会关联到当前登录用户的经销商
router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ code: 400, msg: '请上传文件' });

  const db = getDb();
  const dealerCode = req.user.dealer_code;
  
  if (!dealerCode) {
    fs.unlinkSync(req.file.path);
    return res.json({ code: 400, msg: '用户未关联经销商' });
  }

  const tagMapReverse = { '核心': 'core', '焦点': 'focus', '绿洲': 'oasis', '沙漠': 'desert' };

  try {
    const workbook = XLSX.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    let success = 0, fail = 0;
    const insertStmt = db.prepare(`
      INSERT INTO customer_tags (customer_name, dealer_code, tag, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(customer_name, dealer_code) DO UPDATE SET
        tag = excluded.tag,
        updated_at = datetime('now')
    `);

    for (const row of rows) {
      const name = row['客户名称'] || row['customer_name'];
      const tagRaw = row['标签'] || row['tag'] || '';

      const tag = tagMapReverse[tagRaw] || tagRaw.toLowerCase();

      if (!name || !tag) { fail++; continue; }

      // 检查客户是否存在
      const customer = db.prepare('SELECT customer_name FROM customers WHERE customer_name = ?').get(name);
      if (!customer) { fail++; continue; }

      try {
        insertStmt.run(name, dealerCode, tag);
        success++;
      } catch (e) {
        fail++;
      }
    }

    // 清理临时文件
    fs.unlinkSync(req.file.path);

    res.json({ code: 0, data: { total: rows.length, success, fail, dealer_code: dealerCode }, msg: '导入完成' });
  } catch (e) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.json({ code: 500, msg: e.message });
  }
});

// POST /api/admin/customer-tags/set - 手动设置客户标签
router.post('/set', (req, res) => {
  const { customer_name, tag, dealer_code } = req.body;
  if (!customer_name) return res.json({ code: 400, msg: '客户名称不能为空' });
  
  const db = getDb();
  const targetDealer = dealer_code || req.user.dealer_code;
  
  if (!targetDealer) {
    return res.json({ code: 400, msg: '未指定经销商' });
  }

  try {
    // 检查客户是否存在
    const customer = db.prepare('SELECT customer_name FROM customers WHERE customer_name = ?').get(customer_name);
    if (!customer) {
      return res.json({ code: 404, msg: '客户不存在' });
    }

    if (tag) {
      // 设置标签
      db.prepare(`
        INSERT INTO customer_tags (customer_name, dealer_code, tag, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(customer_name, dealer_code) DO UPDATE SET
          tag = excluded.tag,
          updated_at = datetime('now')
      `).run(customer_name, targetDealer, tag);
    } else {
      // 清除标签
      db.prepare('DELETE FROM customer_tags WHERE customer_name = ? AND dealer_code = ?')
        .run(customer_name, targetDealer);
    }

    res.json({ code: 0, msg: '标签设置成功' });
  } catch (e) {
    console.error('[Set Customer Tag Error]', e.message);
    res.json({ code: 500, msg: e.message });
  }
});

// DELETE /api/admin/customer-tags/:id - 删除客户标签
router.delete('/:id', (req, res) => {
  const db = getDb();
  const currentDealerCode = req.user.dealer_code;
  
  // 查询标签记录
  const tagRecord = db.prepare('SELECT customer_name, dealer_code FROM customer_tags WHERE id = ?').get(req.params.id);
  if (!tagRecord) return res.json({ code: 404, msg: '标签记录不存在' });
  
  // 只能删除自己经销商的标签
  if (tagRecord.dealer_code !== currentDealerCode) {
    return res.json({ code: 403, msg: '无权删除其他经销商的标签' });
  }

  db.prepare('DELETE FROM customer_tags WHERE id = ?').run(req.params.id);
  res.json({ code: 0, msg: '删除成功' });
});

module.exports = router;