const express = require('express');
const XLSX = require('xlsx');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../../config/db');
const { updateCustomerSummary } = require('../pool');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '../../../uploads/temp') });

// 通用 Excel 文件校验中间件
function validateExcelFile(req, res, next) {
  if (!req.file) return res.status(400).json({ code: 400, msg: '请上传文件' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!['.xlsx', '.xls'].includes(ext)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ code: 400, msg: '仅支持 xlsx/xls 格式' });
  }
  next();
}

// 辅助函数：清理VIN字段（处理数字格式问题）
function cleanVin(value) {
  if (value === null || value === undefined || value === '') return '';
  let vin = String(value).trim();
  // 去掉Excel数字格式产生的 .0 后缀
  if (vin.endsWith('.0')) vin = vin.slice(0, -2);
  // 去掉科学计数法（如 8.00032E+14）
  if (vin.includes('E+') || vin.includes('e+')) {
    const num = Number(value);
    if (!isNaN(num)) vin = String(Math.floor(num));
  }
  // 如果最终结果是纯数字字符串，确保没有小数点
  if (/^\d+\.\d+$/.test(vin)) vin = vin.split('.')[0];
  return vin;
}

// 辅助函数：格式化日期（处理Excel日期序列号或Date对象）
function formatDate(value) {
  if (value === null || value === undefined || value === '') return null;
  // 如果是Date对象
  if (value instanceof Date && !isNaN(value)) {
    return value.toISOString().split('T')[0];
  }
  // 如果是数字（Excel日期序列号）
  if (typeof value === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return date.toISOString().split('T')[0];
  }
  // 如果是字符串
  const str = String(value).trim();
  if (!str) return null;
  // 尝试解析为数字（Excel序列号可能是字符串格式）
  const num = Number(str);
  if (!isNaN(num) && num > 1 && num < 100000) {
    // 看起来像Excel日期序列号（1-100000范围）
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + num * 86400000);
    const iso = date.toISOString().split('T')[0];
    // 只接受合理日期范围（1990-2050）
    if (iso >= '1990-01-01' && iso <= '2050-12-31') return iso;
  }
  // 尝试解析为日期字符串
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return str;
}

// POST /api/admin/import/pool
router.post('/pool', upload.single('file'), validateExcelFile, (req, res) => {
  const wb = XLSX.readFile(req.file.path, { cellDates: true });
  fs.unlink(req.file.path, () => {});
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const db = getDb();
  
  // 禁用外键约束，允许导入时经销商代码不存在
  db.exec('PRAGMA foreign_keys = OFF');
  
  let success = 0, fail = 0;
  const errors = [];

  const tx = db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const vin = cleanVin(r['VIN'] || r['vin']);
      if (!vin) { fail++; errors.push(`第${i + 2}行: 缺少VIN`); continue; }
      const exists = db.prepare('SELECT vin FROM vehicles WHERE vin = ?').get(vin);
      if (exists) { fail++; errors.push(`第${i + 2}行: VIN已存在于车辆表`); continue; }
      try {
        const vinFull = cleanVin(r['VIN全称'] || r['VIN_FULL'] || r['vin_full']) || vin;
        const deliveryDate = formatDate(r['交付日期'] || r['delivery_date']);
        const productionDate = formatDate(r['生产日期'] || r['production_date']);
        db.prepare(`INSERT OR REPLACE INTO public_pool (vin, vin_full, license_plate, customer_name, vehicle_type, sales_dealer, model, delivery_date, production_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(vin, vinFull, r['车牌'] || r['license_plate'] || '', r['客户名称'] || r['customer_name'] || '',
            r['车辆类型'] || r['vehicle_type'] || '', r['销售经销商'] || r['sales_dealer'] || '', r['车型'] || r['model'] || '',
            deliveryDate, productionDate);
        success++;
      } catch (e) { fail++; errors.push(`第${i + 2}行: 数据异常`); }
    }
  });
  try { tx(); res.json({ code: 0, data: { total: rows.length, success, fail, errors: errors.slice(0, 20) } }); }
  catch (e) { console.error('[Import] 公海池导入失败:', e.message); res.status(500).json({ code: 500, msg: '导入失败' }); }
});

// POST /api/admin/import/vehicles
router.post('/vehicles', upload.single('file'), validateExcelFile, (req, res) => {
  const wb = XLSX.readFile(req.file.path, { cellDates: true });
  fs.unlink(req.file.path, () => {});
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const db = getDb();
  
  // 禁用外键约束
  db.exec('PRAGMA foreign_keys = OFF');
  
  let success = 0, fail = 0;
  const errors = [];

  const tx = db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      // 支持多种字段名映射
      const vin = cleanVin(r['VIN'] || r['vin']);
      if (!vin) { fail++; errors.push(`第${i + 2}行: 缺少VIN`); continue; }
      try {
        const vinFull = cleanVin(r['VIN全称'] || r['VIN_FULL'] || r['vin_full']) || vin;
        const deliveryDate = formatDate(r['交付日期'] || r['delivery_date']);
        const productionDate = formatDate(r['生产日期'] || r['production_date']);
        
        // 字段映射：是否有中央合同 -> central_contract, 总收入 -> annual_income
        const centralContract = r['是否有中央合同'] || r['中央合同'] || r['central_contract'] || null;
        const annualIncome = r['总收入'] || r['年总收入'] || r['annual_income'] || null;
        
        db.prepare('DELETE FROM public_pool WHERE vin = ?').run(vin);
        const now = new Date().toISOString();
        db.prepare(`INSERT OR REPLACE INTO vehicles (vin, vin_full, license_plate, customer_name, vehicle_type, sales_dealer, service_dealer, model, delivery_date, production_date, central_contract, annual_income, claimed_by, claimed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(vin, vinFull, r['车牌'] || r['license_plate'] || '', r['客户名称'] || r['customer_name'] || '', 
            r['车辆类型'] || r['vehicle_type'] || '', r['销售经销商'] || r['sales_dealer'] || '', 
            r['服务经销商'] || r['service_dealer'] || '', r['车型'] || r['model'] || '', 
            deliveryDate, productionDate, centralContract, annualIncome, req.user.id, now);
        const cn = r['客户名称'] || r['customer_name'] || '';
        if (cn && !db.prepare('SELECT id FROM customers WHERE customer_name = ?').get(cn)) {
          db.prepare('INSERT INTO customers (customer_name) VALUES (?)').run(cn);
        }
        if (cn) updateCustomerSummary(db, cn);
        success++;
      } catch (e) { fail++; errors.push(`第${i + 2}行: 数据异常 - ${e.message}`); }
    }
  });
  try { tx(); res.json({ code: 0, data: { total: rows.length, success, fail, errors: errors.slice(0, 20) } }); }
  catch (e) { console.error('[Import] 车辆导入失败:', e.message); res.status(500).json({ code: 500, msg: '导入失败' }); }
});

// POST /api/admin/import/contracts
router.post('/contracts', upload.single('file'), validateExcelFile, (req, res) => {
  const wb = XLSX.readFile(req.file.path, { cellDates: true });
  fs.unlink(req.file.path, () => {});
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const db = getDb();
  
  // 禁用外键约束
  db.exec('PRAGMA foreign_keys = OFF');
  
  let success = 0, fail = 0;

  const tx = db.transaction(() => {
    for (const r of rows) {
      const vin = cleanVin(r['VIN'] || r['vin']);
      if (!vin) { fail++; continue; }
      try {
        const startDate = formatDate(r['开始日期'] || r['contract_start_date']);
        const endDate = formatDate(r['结束日期'] || r['contract_end_date']);
        const closeDate = formatDate(r['关闭日期'] || r['contract_close_date']);
        const existing = db.prepare('SELECT id FROM contracts WHERE vin = ?').get(vin);
        if (existing) {
          const now = new Date().toISOString();
          db.prepare(`UPDATE contracts SET contract_start_date=?, contract_end_date=?, contract_close_date=?, contract_set_mileage=?, mileage_used=?, contract_total_count=?, contract_done_count=?, contract_type=?, headquarters_contract_no=?, status=?, updated_at=? WHERE vin=?`)
            .run(startDate, endDate, closeDate, r['设置里程'] || r['contract_set_mileage'] || 0, r['已用里程'] || r['mileage_used'] || 0, r['总次数'] || r['contract_total_count'] || 0, r['已完成次数'] || r['contract_done_count'] || 0, r['合同类型'] || r['contract_type'] || null, r['总部合同编号'] || r['headquarters_contract_no'] || null, r['状态'] || r['status'] || 'active', now, vin);
        } else {
          db.prepare(`INSERT INTO contracts (vin, contract_start_date, contract_end_date, contract_close_date, contract_set_mileage, mileage_used, contract_total_count, contract_done_count, contract_type, headquarters_contract_no, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
            .run(vin, startDate, endDate, closeDate, r['设置里程'] || 0, r['已用里程'] || 0, r['总次数'] || 0, r['已完成次数'] || 0, r['合同类型'] || null, r['总部合同编号'] || null, r['状态'] || 'active');
        }
        success++;
      } catch (e) { fail++; }
    }
  });
  try { tx(); res.json({ code: 0, data: { total: rows.length, success, fail } }); }
  catch (e) { console.error('[Import] 合同导入失败:', e.message); res.status(500).json({ code: 500, msg: '导入失败' }); }
});

// POST /api/admin/import/workorders - 批量导入工单（按order_no覆盖，无order_no则按vin+order_type覆盖）
router.post('/workorders', upload.single('file'), validateExcelFile, (req, res) => {
  const wb = XLSX.readFile(req.file.path, { cellDates: true });
  fs.unlink(req.file.path, () => {});
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const db = getDb();
  
  // 禁用外键约束
  db.exec('PRAGMA foreign_keys = OFF');
  
  let success = 0, fail = 0;
  const errors = [];

  const tx = db.transaction(() => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const vin = cleanVin(r['VIN'] || r['vin']);
      const orderNo = r['工单号'] || r['order_no'] || '';
      if (!vin) { fail++; errors.push(`第${i + 2}行: 缺少VIN`); continue; }
      try {
        const orderDate = formatDate(r['工单日期'] || r['order_date']);
        if (orderNo) {
          // 有工单号：按order_no匹配覆盖
          const existing = db.prepare('SELECT id FROM work_orders WHERE order_no = ?').get(orderNo);
          if (existing) {
            db.prepare(`UPDATE work_orders SET vin=?, order_date=?, order_type=?, order_content=?, service_dealer=?, dealer_code=?, amount=? WHERE order_no=?`)
              .run(vin, orderDate, r['工单类型'] || r['order_type'] || '', r['维修内容'] || r['order_content'] || '', r['服务经销商'] || r['service_dealer'] || '', r['经销商代码'] || r['dealer_code'] || '', r['金额'] || r['amount'] || 0, orderNo);
          } else {
            db.prepare(`INSERT INTO work_orders (vin, order_no, order_date, order_type, order_content, service_dealer, dealer_code, amount) VALUES (?,?,?,?,?,?,?,?)`)
              .run(vin, orderNo, orderDate, r['工单类型'] || r['order_type'] || '', r['维修内容'] || r['order_content'] || '', r['服务经销商'] || r['service_dealer'] || '', r['经销商代码'] || r['dealer_code'] || '', r['金额'] || r['amount'] || 0);
          }
        } else {
          // 无工单号：按vin+order_type匹配覆盖
          const orderType = r['工单类型'] || r['order_type'] || '';
          const existing = db.prepare('SELECT id FROM work_orders WHERE vin = ? AND order_type = ?').get(vin, orderType);
          if (existing) {
            db.prepare(`UPDATE work_orders SET order_date=?, order_content=?, service_dealer=?, dealer_code=?, amount=? WHERE id=?`)
              .run(orderDate, r['维修内容'] || r['order_content'] || '', r['服务经销商'] || r['service_dealer'] || '', r['经销商代码'] || r['dealer_code'] || '', r['金额'] || r['amount'] || 0, existing.id);
          } else {
            db.prepare(`INSERT INTO work_orders (vin, order_no, order_date, order_type, order_content, service_dealer, dealer_code, amount) VALUES (?,?,?,?,?,?,?,?)`)
              .run(vin, '', orderDate, orderType, r['维修内容'] || r['order_content'] || '', r['服务经销商'] || r['service_dealer'] || '', r['经销商代码'] || r['dealer_code'] || '', r['金额'] || r['amount'] || 0);
          }
        }
        success++;
      } catch (e) { fail++; errors.push(`第${i + 2}行: ${e.message}`); }
    }
  });
  try { tx(); res.json({ code: 0, data: { total: rows.length, success, fail, errors: errors.slice(0, 20) } }); }
  catch (e) { console.error('[Import] 工单导入失败:', e.message); res.status(500).json({ code: 500, msg: '导入失败' }); }
});

// POST /api/admin/import/customers
router.post('/customers', upload.single('file'), validateExcelFile, (req, res) => {
  const wb = XLSX.readFile(req.file.path);
  fs.unlink(req.file.path, () => {});
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const db = getDb();
  
  // 禁用外键约束
  db.exec('PRAGMA foreign_keys = OFF');
  
  let success = 0, fail = 0;

  const tx = db.transaction(() => {
    for (const r of rows) {
      const name = r['客户名称'] || r['customer_name'];
      if (!name) { fail++; continue; }
      try {
        const existing = db.prepare('SELECT id FROM customers WHERE customer_name = ?').get(name);
        if (existing) {
          const now = new Date().toISOString();
          db.prepare(`UPDATE customers SET tag=?, city=?, registration_info=?, updated_at=? WHERE customer_name=?`)
            .run(r['标签'] || r['tag'] || null, r['所在市'] || r['city'] || null, r['注册信息'] || r['registration_info'] || null, now, name);
        } else {
          db.prepare('INSERT INTO customers (customer_name, tag, city, registration_info) VALUES (?,?,?,?)')
            .run(name, r['标签'] || r['tag'] || null, r['所在市'] || r['city'] || null, r['注册信息'] || r['registration_info'] || null);
        }
        success++;
      } catch (e) { fail++; }
    }
  });
  try { tx(); res.json({ code: 0, data: { total: rows.length, success, fail } }); }
  catch (e) { console.error('[Import] 客户导入失败:', e.message); res.status(500).json({ code: 500, msg: '导入失败' }); }
});

module.exports = router;
