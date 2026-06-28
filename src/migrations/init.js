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

// 添加线索状态字段迁移（支持新状态枚举）
try {
  // 检查是否已有新状态，如果没有则添加
  const leadsInfo = db.prepare('PRAGMA table_info(leads)').all();
  const hasStatus = leadsInfo.some(col => col.name === 'status');
  if (hasStatus) {
    // 迁移旧状态到新状态
    db.prepare("UPDATE leads SET status = 'unfollowed' WHERE status = 'pending'").run();
    db.prepare("UPDATE leads SET status = 'following' WHERE status = 'read'").run();
    db.prepare("UPDATE leads SET status = 'completed' WHERE status = 'handled'").run();
    console.log('[Migration] 线索状态已迁移到新枚举');
  }
} catch (e) {
  console.log('[Migration] 线索状态迁移跳过:', e.message);
}

// 添加经销商层级字段
try {
  const dealerInfo = db.prepare('PRAGMA table_info(dealers)').all();
  if (!dealerInfo.some(col => col.name === 'parent_dealer_code')) {
    db.prepare('ALTER TABLE dealers ADD COLUMN parent_dealer_code VARCHAR(32) REFERENCES dealers(dealer_code)').run();
    console.log('[Migration] Added dealers.parent_dealer_code');
  }
  if (!dealerInfo.some(col => col.name === 'level')) {
    db.prepare('ALTER TABLE dealers ADD COLUMN level TINYINT DEFAULT 1').run();
    console.log('[Migration] Added dealers.level');
  }
} catch (e) {
  console.log('[Migration] 经销商层级字段已存在');
}

// 添加工单号索引（加速导入覆盖查询）
try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_work_orders_order_no ON work_orders(order_no)');
} catch (e) {
  console.log('[Migration] 工单号索引跳过:', e.message);
}

console.log('数据库初始化完成');
