const fs = require('fs');
const path = require('path');
const { getDb } = require('../config/db');

const sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf-8');

const db = getDb();
db.exec(sql);

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
