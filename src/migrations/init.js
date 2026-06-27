const fs = require('fs');
const path = require('path');
const { getDb } = require('../config/db');

// 执行基础表结构
const sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf-8');
const db = getDb();

// 禁用外键约束检查（允许导入时经销商代码不存在）
db.exec('PRAGMA foreign_keys = OFF');

db.exec(sql);

// V2 迁移：自动检测并添加新字段
function addColumnIfNotExists(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.find(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[Migration] Added ${table}.${column}`);
  }
}

// customers
addColumnIfNotExists('customers', 'tag', 'VARCHAR(32)');
addColumnIfNotExists('customers', 'city', 'VARCHAR(64)');
addColumnIfNotExists('customers', 'registration_info', 'TEXT');
addColumnIfNotExists('customers', 'sales_dealers_summary', 'TEXT');
addColumnIfNotExists('customers', 'service_dealers_summary', 'TEXT');
// vehicles
addColumnIfNotExists('vehicles', 'vin_full', 'VARCHAR(64)');
addColumnIfNotExists('vehicles', 'central_contract', 'VARCHAR(64)');
addColumnIfNotExists('vehicles', 'annual_income', 'DECIMAL(12,2)');
// public_pool
addColumnIfNotExists('public_pool', 'vin_full', 'VARCHAR(64)');
// contracts
addColumnIfNotExists('contracts', 'contract_start_date', 'DATE');
addColumnIfNotExists('contracts', 'contract_close_date', 'DATE');
addColumnIfNotExists('contracts', 'contract_type', 'VARCHAR(64)');
addColumnIfNotExists('contracts', 'headquarters_contract_no', 'VARCHAR(64)');
// work_orders
addColumnIfNotExists('work_orders', 'order_no', 'VARCHAR(64)');
addColumnIfNotExists('work_orders', 'dealer_code', 'VARCHAR(32)');

console.log('数据库初始化完成');
