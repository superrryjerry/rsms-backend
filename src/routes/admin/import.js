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

// 辅助函数：计算车龄（基于生产日期）
function calcVehicleAge(productionDate) {
  if (!productionDate) return null;
  const prodDate = new Date(productionDate);
  const now = new Date();
  if (isNaN(prodDate.getTime())) return null;
  const years = Math.floor((now - prodDate) / (365.25 * 24 * 60 * 60 * 1000));
  const months = Math.floor(((now - prodDate) % (365.25 * 24 * 60 * 60 * 1000)) / (30.44 * 24 * 60 * 60 * 1000));
  return years > 0 ? `${years}年${months}个月` : `${months}个月`;
}

// POST /api/admin/import/pool - 公海池导入（先清零再导入）
router.post('/pool', upload.single('file'), validateExcelFile, (req, res) => {
  const wb = XLSX.readFile(req.file.path, { cellDates: true });
  fs.unlink(req.file.path, () => {});
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const db = getDb();
  
  // 禁用外键约束
  db.exec('PRAGMA foreign_keys = OFF');
  
  let success = 0, fail = 0;
  const errors = [];

  const tx = db.transaction(() => {
    // 先清零旧数据
    db.exec('DELETE FROM public_pool');
    
    for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const vin = cleanVin(r['VIN'] || r['vin']);
          if (!vin) { fail++; errors.push(`第${i + 2}行: 缺少VIN`); continue; }
          try {
            const vinFull = cleanVin(r['VIN全称'] || r['VIN_FULL'] || r['vin_full']) || vin;
            const deliveryDate = formatDate(r['交付日期'] || r['delivery_date']);
            const productionDate = formatDate(r['生产日期'] || r['production_date']);
            const vehicleAge = calcVehicleAge(productionDate);
            db.prepare(`INSERT INTO public_pool (vin, vin_full, license_plate, customer_name, vehicle_type, sales_dealer, model, delivery_date, production_date, vehicle_age)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
              .run(vin, vinFull, r['车牌'] || r['license_plate'] || '', r['客户名称'] || r['customer_name'] || '',
                r['车辆类型'] || r['vehicle_type'] || '', r['销售经销商'] || r['sales_dealer'] || '', r['车型'] || r['model'] || '',
                deliveryDate, productionDate, vehicleAge);
            success++;
          } catch (e) { fail++; errors.push(`第${i + 2}行: ${e.message}`); }
        }
  });
  try { tx(); res.json({ code: 0, data: { total: rows.length, success, fail, errors: errors.slice(0, 20) } }); }
  catch (e) { console.error('[Import] 公海池导入失败:', e.message); res.status(500).json({ code: 500, msg: '导入失败: ' + e.message }); }
});

// POST /api/admin/import/vehicles - 车辆导入（先清零再导入）
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
    // 先清零旧数据
    db.exec('DELETE FROM vehicles');
    
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const vin = cleanVin(r['VIN'] || r['vin']);
      if (!vin) { fail++; errors.push(`第${i + 2}行: 缺少VIN`); continue; }
      try {
        const vinFull = cleanVin(r['VIN全称'] || r['VIN_FULL'] || r['vin_full']) || vin;
        const deliveryDate = formatDate(r['交付日期'] || r['delivery_date']);
        const productionDate = formatDate(r['生产日期'] || r['production_date']);
        
        // 字段映射
        const centralContract = r['是否有中央合同'] || r['中央合同'] || r['central_contract'] || null;
        const annualIncome = r['总收入'] || r['年总收入'] || r['annual_income'] || null;
        
        const now = new Date().toISOString();
        db.prepare(`INSERT INTO vehicles (vin, vin_full, license_plate, customer_name, vehicle_type, sales_dealer, service_dealer, model, delivery_date, production_date, central_contract, annual_income, claimed_by, claimed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(vin, vinFull, r['车牌'] || r['license_plate'] || '', r['客户名称'] || r['customer_name'] || '', 
            r['车辆类型'] || r['vehicle_type'] || '', r['销售经销商'] || r['sales_dealer'] || '', 
            r['服务经销商'] || r['service_dealer'] || '', r['车型'] || r['model'] || '', 
            deliveryDate, productionDate, centralContract, annualIncome, req.user.id, now);
        
        // 自动创建客户
        const cn = r['客户名称'] || r['customer_name'] || '';
        if (cn && !db.prepare('SELECT id FROM customers WHERE customer_name = ?').get(cn)) {
          db.prepare('INSERT INTO customers (customer_name) VALUES (?)').run(cn);
        }
        if (cn) updateCustomerSummary(db, cn);
        success++;
      } catch (e) { fail++; errors.push(`第${i + 2}行: ${e.message}`); }
    }
  });
  try { tx(); res.json({ code: 0, data: { total: rows.length, success, fail, errors: errors.slice(0, 20) } }); }
  catch (e) { console.error('[Import] 车辆导入失败:', e.message); res.status(500).json({ code: 500, msg: '导入失败: ' + e.message }); }
});

// POST /api/admin/import/contracts - 合同导入（先清零再导入）
router.post('/contracts', upload.single('file'), validateExcelFile, (req, res) => {
  const wb = XLSX.readFile(req.file.path, { cellDates: true });
  fs.unlink(req.file.path, () => {});
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  const db = getDb();
  
  // 禁用外键约束
  db.exec('PRAGMA foreign_keys = OFF');
  
  let success = 0, fail = 0;
  const errors = [];

  const tx = db.transaction(() => {
    // 先清零旧数据
    db.exec('DELETE FROM contracts');
    
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const vin = cleanVin(r['VIN'] || r['vin']);
      if (!vin) { fail++; errors.push(`第${i + 2}行: 缺少VIN`); continue; }
      try {
        const startDate = formatDate(r['合同开始日期'] || r['开始日期'] || r['contract_start_date']);
        const endDate = formatDate(r['合同结束日期'] || r['结束日期'] || r['contract_end_date']);
        const closeDate = formatDate(r['合同结束确定时间'] || r['关闭日期'] || r['contract_close_date']);
        
        db.prepare(`INSERT INTO contracts (vin, contract_start_date, contract_end_date, contract_close_date, contract_set_mileage, mileage_used, contract_total_count, contract_done_count, contract_type, headquarters_contract_no, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(vin, startDate, endDate, closeDate, r['合同设置里程'] || r['设置里程'] || r['contract_set_mileage'] || 0, r['已跑完里程'] || r['已用里程'] || r['mileage_used'] || 0, r['合同包含次数'] || r['总次数'] || r['contract_total_count'] || 0, r['合同已完成次数'] || r['已完成次数'] || r['contract_done_count'] || 0, r['合同类型'] || r['contract_type'] || null, r['总部合同编号'] || r['headquarters_contract_no'] || null, r['合同状态'] || r['状态'] || r['status'] || 'active');
        success++;
      } catch (e) { fail++; errors.push(`第${i + 2}行: ${e.message}`); }
    }
  });
  try { tx(); res.json({ code: 0, data: { total: rows.length, success, fail, errors: errors.slice(0, 20) } }); }
  catch (e) { console.error('[Import] 合同导入失败:', e.message); res.status(500).json({ code: 500, msg: '导入失败: ' + e.message }); }
});

// POST /api/admin/import/workorders - 工单导入（先清零再导入）
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
    // 先清零旧数据
    db.exec('DELETE FROM work_orders');
    
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const vin = cleanVin(r['VIN'] || r['vin']);
      const orderNo = r['工单号'] || r['order_no'] || '';
      if (!vin) { fail++; errors.push(`第${i + 2}行: 缺少VIN`); continue; }
      try {
        const orderDate = formatDate(r['工单日期'] || r['order_date']);
        db.prepare(`INSERT INTO work_orders (vin, order_no, order_date, order_type, order_content, service_dealer, dealer_code, amount) VALUES (?,?,?,?,?,?,?,?)`)
          .run(vin, orderNo, orderDate, r['工单类型'] || r['order_type'] || '', r['维修内容'] || r['order_content'] || '', r['经销商名称'] || r['服务经销商'] || r['service_dealer'] || '', r['经销商代码'] || r['dealer_code'] || '', r['金额'] || r['amount'] || 0);
        success++;
      } catch (e) { fail++; errors.push(`第${i + 2}行: ${e.message}`); }
    }
  });
  try { tx(); res.json({ code: 0, data: { total: rows.length, success, fail, errors: errors.slice(0, 20) } }); }
  catch (e) { console.error('[Import] 工单导入失败:', e.message); res.status(500).json({ code: 500, msg: '导入失败: ' + e.message }); }
});

// POST /api/admin/import/customers - 客户导入（增量更新：更新现有客户，新增新客户）
router.post('/customers', upload.single('file'), validateExcelFile, (req, res) => {
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
      const name = r['客户名称'] || r['customer_name'];
      if (!name) { fail++; errors.push(`第${i + 2}行: 缺少客户名称`); continue; }
      try {
        const existing = db.prepare('SELECT id FROM customers WHERE customer_name = ?').get(name);
        const now = new Date().toISOString();
        if (existing) {
          // 更新现有客户
          db.prepare('UPDATE customers SET tag=?, city=?, registration_info=?, updated_at=? WHERE customer_name=?')
            .run(r['标签'] || r['tag'] || null, r['所在市'] || r['city'] || null, r['注册信息'] || r['registration_info'] || null, now, name);
        } else {
          // 新增客户
          db.prepare('INSERT INTO customers (customer_name, tag, city, registration_info, created_at, updated_at) VALUES (?,?,?,?,?,?)')
            .run(name, r['标签'] || r['tag'] || null, r['所在市'] || r['city'] || null, r['注册信息'] || r['registration_info'] || null, now, now);
        }
        success++;
      } catch (e) { fail++; errors.push(`第${i + 2}行: ${e.message}`); }
    }
  });
  try { tx(); res.json({ code: 0, data: { total: rows.length, success, fail, errors: errors.slice(0, 20) } }); }
  catch (e) { console.error('[Import] 客户导入失败:', e.message); res.status(500).json({ code: 500, msg: '导入失败: ' + e.message }); }
});

module.exports = router;
