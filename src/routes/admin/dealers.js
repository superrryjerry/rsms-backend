const express = require('express');
const { getDb } = require('../../config/db');

const router = express.Router();

// GET /api/admin/dealers
router.get('/', (req, res) => {
  const db = getDb();
  res.json({ code: 0, data: db.prepare('SELECT * FROM dealers ORDER BY dealer_code').all() });
});

// POST /api/admin/dealers
router.post('/', (req, res) => {
  const { dealer_code, dealer_name, dealer_type, parent_dealer_code, level } = req.body;
  if (!dealer_code || !dealer_name) return res.status(400).json({ code: 400, msg: '经销商代码和名称不能为空' });
  
  const db = getDb();
  
  // 如果有父经销商，验证其存在并自动设置level
  let finalLevel = level || 1;
  if (parent_dealer_code) {
    const parent = db.prepare('SELECT * FROM dealers WHERE dealer_code = ?').get(parent_dealer_code);
    if (!parent) return res.status(400).json({ code: 400, msg: '父经销商不存在' });
    finalLevel = (parent.level || 1) + 1;
  }
  
  try {
    db.prepare('INSERT INTO dealers (dealer_code, dealer_name, dealer_type, parent_dealer_code, level) VALUES (?,?,?,?,?)')
      .run(dealer_code, dealer_name, dealer_type || 'both', parent_dealer_code || null, finalLevel);
    res.json({ code: 0, msg: '创建成功' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ code: 400, msg: '经销商代码已存在' });
    console.error('[Admin] 创建经销商失败:', e.message);
    res.status(500).json({ code: 500, msg: '创建经销商失败' });
  }
});

// PUT /api/admin/dealers/:code - 更新经销商信息
router.put('/:code', (req, res) => {
  const { dealer_name, dealer_type, parent_dealer_code } = req.body;
  const db = getDb();
  
  try {
    let updateSql = 'UPDATE dealers SET dealer_name=?, dealer_type=?';
    const params = [dealer_name, dealer_type];
    
    if (parent_dealer_code !== undefined) {
      if (parent_dealer_code) {
        const parent = db.prepare('SELECT * FROM dealers WHERE dealer_code = ?').get(parent_dealer_code);
        if (!parent) return res.status(400).json({ code: 400, msg: '父经销商不存在' });
        updateSql += ', parent_dealer_code=?, level=?';
        params.push(parent_dealer_code, (parent.level || 1) + 1);
      } else {
        updateSql += ', parent_dealer_code=NULL, level=1';
      }
    }
    
    updateSql += ' WHERE dealer_code=?';
    params.push(req.params.code);
    
    db.prepare(updateSql).run(...params);
    res.json({ code: 0, msg: '更新成功' });
  } catch (e) {
    console.error('[Admin] 更新经销商失败:', e.message);
    res.status(500).json({ code: 500, msg: '更新失败' });
  }
});

// DELETE /api/admin/dealers/:code - 删除经销商
router.delete('/:code', (req, res) => {
  const db = getDb();
  const code = req.params.code;
  
  // 检查是否有子经销商
  const subCount = db.prepare('SELECT COUNT(*) as cnt FROM dealers WHERE parent_dealer_code = ?').get(code);
  if (subCount.cnt > 0) {
    return res.status(400).json({ code: 400, msg: '该经销商下有子经销商，无法删除' });
  }
  
  // 检查是否有用户关联
  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users WHERE dealer_code = ?').get(code);
  if (userCount.cnt > 0) {
    return res.status(400).json({ code: 400, msg: '该经销商下有用户，无法删除' });
  }
  
  // 检查是否有车辆关联
  const vehicleCount = db.prepare('SELECT COUNT(*) as cnt FROM vehicles WHERE sales_dealer = ? OR service_dealer = ?').get(code, code);
  if (vehicleCount.cnt > 0) {
    return res.status(400).json({ code: 400, msg: '该经销商有关联车辆，无法删除' });
  }
  
  try {
    db.prepare('DELETE FROM dealers WHERE dealer_code = ?').run(code);
    res.json({ code: 0, msg: '删除成功' });
  } catch (e) {
    console.error('[Admin] 删除经销商失败:', e.message);
    res.status(500).json({ code: 500, msg: '删除失败' });
  }
});

// GET /api/admin/dealers/:code/sub-dealers - 获取子经销商列表
router.get('/:code/sub-dealers', (req, res) => {
  const db = getDb();
  const list = db.prepare('SELECT * FROM dealers WHERE parent_dealer_code = ? ORDER BY dealer_code')
    .all(req.params.code);
  res.json({ code: 0, data: list });
});

module.exports = router;
