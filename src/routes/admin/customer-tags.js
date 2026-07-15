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
// 按经销商隔离：普通用户只看自己的，admin 可以看全部或指定经销商
router.get('/list', (req, res) => {
  try {
    const { page = 1, size = 20, keyword, tag, dealer_code } = req.query;
    const db = getDb();
    const currentDealerCode = req.user.dealer_code;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'admin_test';
    
    // admin 可以指定经销商，或查看全部
    // 非admin 只能看自己经销商的
    let where = '1=1';
    const params = [];
    
    if (dealer_code) {
      // 指定了经销商
      where += ' AND ct.dealer_code = ?';
      params.push(dealer_code);
    } else if (!isAdmin && currentDealerCode) {
      // 非admin 且有经销商，只看自己的
      where += ' AND ct.dealer_code = ?';
      params.push(currentDealerCode);
    }
    // admin 且没指定经销商 = 看全部

    if (keyword) {
      where += ' AND ct.customer_name LIKE ?';
      params.push(`%${keyword}%`);
    }
    if (tag) {
      where += ' AND ct.tag = ?';
      params.push(tag);
    }

    const total = db.prepare(`SELECT COUNT(*) as c FROM customer_tags ct WHERE ${where}`).get(...params).c;
    const list = db.prepare(`SELECT ct.id, ct.customer_name, ct.tag, ct.dealer_code, d.dealer_name as tag_dealer_name, c.city, c.service_dealers_summary, ct.updated_at
      FROM customer_tags ct
      LEFT JOIN customers c ON ct.customer_name = c.customer_name
      LEFT JOIN dealers d ON ct.dealer_code = d.dealer_code
      WHERE ${where} ORDER BY ct.updated_at DESC LIMIT ? OFFSET ?`)
      .all(...params, Number(size), (Number(page) - 1) * Number(size));

    res.json({ code: 0, data: { total, list, page: Number(page), size: Number(size) } });
  } catch (err) {
    console.error('[CustomerTags List Error]', err.message, err.stack);
    res.status(500).json({ code: 500, msg: err.message });
  }
});

// GET /api/admin/customer-tags/export - 导出客户标签
// admin 可以导出全部或指定经销商，非admin只能导出自己的
router.get('/export', (req, res) => {
  const { keyword, tag, dealer_code } = req.query;
  const db = getDb();
  const currentDealerCode = req.user.dealer_code;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'admin_test';
  
  let where = '1=1';
  const params = [];
  
  if (dealer_code) {
    where += ' AND ct.dealer_code = ?';
    params.push(dealer_code);
  } else if (!isAdmin && currentDealerCode) {
    where += ' AND ct.dealer_code = ?';
    params.push(currentDealerCode);
  }

  if (keyword) {
    where += ' AND ct.customer_name LIKE ?';
    params.push(`%${keyword}%`);
  }
  if (tag) {
    where += ' AND ct.tag = ?';
    params.push(tag);
  }

  const list = db.prepare(`SELECT ct.customer_name, ct.tag, ct.dealer_code, d.dealer_name as tag_dealer_name, c.city, c.service_dealers_summary, ct.updated_at
    FROM customer_tags ct
    LEFT JOIN customers c ON ct.customer_name = c.customer_name
    LEFT JOIN dealers d ON ct.dealer_code = d.dealer_code
    WHERE ${where} ORDER BY ct.updated_at DESC`).all(...params);

  const tagMap = { core: '核心', focus: '焦点', oasis: '绿洲', desert: '沙漠' };
  const data = list.map(r => ({
    '客户名称': r.customer_name,
    '标签': tagMap[r.tag] || r.tag,
    '打标签经销商': r.tag_dealer_name || r.dealer_code,
    '所在市': r.city || '',
    '服务经销商': r.service_dealers_summary || '',
    '更新时间': r.updated_at || ''
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, '客户标签');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const filename = dealer_code ? `customer_tags_${dealer_code}_${Date.now()}` : `customer_tags_all_${Date.now()}`;
  res.setHeader('Content-Disposition', `attachment; filename=${filename}.xlsx`);
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
// admin 可以指定经销商，非admin只能导入到自己的经销商
router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ code: 400, msg: '请上传文件' });

  const db = getDb();
  const currentDealerCode = req.user.dealer_code;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'admin_test';
  
  // 从请求体获取目标经销商（admin可以指定）
  const targetDealer = req.body.dealer_code || currentDealerCode;
  
  if (!targetDealer) {
    fs.unlinkSync(req.file.path);
    return res.json({ code: 400, msg: '未指定经销商' });
  }
  
  // 非admin不能导入到其他经销商
  if (!isAdmin && req.body.dealer_code && req.body.dealer_code !== currentDealerCode) {
    fs.unlinkSync(req.file.path);
    return res.json({ code: 403, msg: '无权导入到其他经销商' });
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
        insertStmt.run(name, targetDealer, tag);
        success++;
      } catch (e) {
        fail++;
      }
    }

    // 清理临时文件
    fs.unlinkSync(req.file.path);

    res.json({ code: 0, data: { total: rows.length, success, fail, dealer_code: targetDealer }, msg: '导入完成' });
  } catch (e) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.json({ code: 500, msg: e.message });
  }
});

// POST /api/admin/customer-tags/set - 手动设置客户标签
// admin 可以为任何经销商设置，非admin只能给自己设置
router.post('/set', (req, res) => {
  const { customer_name, tag, dealer_code } = req.body;
  if (!customer_name) return res.json({ code: 400, msg: '客户名称不能为空' });
  
  const db = getDb();
  const currentDealerCode = req.user.dealer_code;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'admin_test';
  
  // admin 可以指定经销商，非admin只能给自己设置
  let targetDealer = dealer_code;
  if (!targetDealer && currentDealerCode) {
    targetDealer = currentDealerCode;
  }
  
  if (!targetDealer) {
    return res.json({ code: 400, msg: '未指定经销商' });
  }
  
  // 非admin不能给其他经销商设置标签
  if (!isAdmin && dealer_code && dealer_code !== currentDealerCode) {
    return res.json({ code: 403, msg: '无权为其他经销商设置标签' });
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

    res.json({ code: 0, msg: '标签设置成功', dealer_code: targetDealer });
  } catch (e) {
    console.error('[Set Customer Tag Error]', e.message);
    res.json({ code: 500, msg: e.message });
  }
});

// DELETE /api/admin/customer-tags/:id - 删除客户标签
// admin 可以删除任何标签，非admin只能删除自己经销商的
router.delete('/:id', (req, res) => {
  const db = getDb();
  const currentDealerCode = req.user.dealer_code;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'admin_test';
  
  // 查询标签记录
  const tagRecord = db.prepare('SELECT customer_name, dealer_code FROM customer_tags WHERE id = ?').get(req.params.id);
  if (!tagRecord) return res.json({ code: 404, msg: '标签记录不存在' });
  
  // 非admin只能删除自己经销商的标签
  if (!isAdmin && tagRecord.dealer_code !== currentDealerCode) {
    return res.json({ code: 403, msg: '无权删除其他经销商的标签' });
  }

  db.prepare('DELETE FROM customer_tags WHERE id = ?').run(req.params.id);
  res.json({ code: 0, msg: '删除成功' });
});

module.exports = router;