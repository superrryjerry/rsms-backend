const fs = require('fs');
const path = require('path');
const { getDb } = require('../config/db');

const sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf-8');

const db = getDb();
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
// vehicles
addColumnIfNotExists('vehicles', 'central_contract', 'VARCHAR(64)');
addColumnIfNotExists('vehicles', 'annual_income', 'DECIMAL(12,2)');
// contracts
addColumnIfNotExists('contracts', 'contract_start_date', 'DATE');
addColumnIfNotExists('contracts', 'contract_close_date', 'DATE');
addColumnIfNotExists('contracts', 'contract_type', 'VARCHAR(64)');
addColumnIfNotExists('contracts', 'headquarters_contract_no', 'VARCHAR(64)');
// work_orders
addColumnIfNotExists('work_orders', 'order_no', 'VARCHAR(64)');
addColumnIfNotExists('work_orders', 'dealer_code', 'VARCHAR(32)');

// 创建默认管理员 (phone: admin, password: admin123)
const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync('admin123', 10);
const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get('admin');
if (!existing) {
  db.prepare(`INSERT INTO users (phone, password_hash, name, role) VALUES (?, ?, ?, ?)`)
    .run('admin', hash, '系统管理员', 'admin');
  console.log('默认管理员已创建: phone=admin, password=admin123');
}

console.log('数据库初始化完成');
