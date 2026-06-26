require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { getDb } = require('./config/db');
const { initCron } = require('./services/cron');

const app = express();
const PORT = process.env.PORT || 3000;

// 安全中间件
app.use(helmet());

// 频率限制：登录接口单独限制
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 20,
  message: { code: 429, msg: '请求过于频繁，请稍后再试' }
});

// 全局频率限制
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分钟
  max: 200,
  message: { code: 429, msg: '请求过于频繁，请稍后再试' }
});

app.use(globalLimiter);

// CORS 白名单
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : true; // 未配置则允许所有（开发环境）
app.use(cors({ origin: corsOrigins, credentials: true }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 上传目录：需要鉴权才能访问（不再直接静态暴露）
// 改为通过 /api/uploads 路由 + authMiddleware 来访问文件
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// 初始化数据库
const initSql = fs.readFileSync(path.join(__dirname, 'migrations/init.sql'), 'utf-8');
const db = getDb();
db.exec(initSql);

// 创建默认管理员（随机密码，首次登录需修改）
const bcrypt = require('bcryptjs');
const adminExists = db.prepare("SELECT id FROM users WHERE phone = 'admin'").get();
if (!adminExists) {
  const defaultPassword = crypto.randomBytes(8).toString('hex'); // 随机16位密码
  const hash = bcrypt.hashSync(defaultPassword, 10);
  db.prepare('INSERT INTO users (phone, password_hash, name, role, must_change_pwd) VALUES (?, ?, ?, ?, 1)')
    .run('admin', hash, '系统管理员', 'admin');
  console.log('========================================');
  console.log('默认管理员已创建:');
  console.log(`  手机号: admin`);
  console.log(`  密码: ${defaultPassword}`);
  console.log('  首次登录需修改密码，请妥善保存！');
  console.log('========================================');
}

// 确保 users 表有 must_change_pwd 字段（兼容旧数据库）
try {
  db.prepare('SELECT must_change_pwd FROM users LIMIT 1').get();
} catch {
  db.exec('ALTER TABLE users ADD COLUMN must_change_pwd INTEGER DEFAULT 0');
}

// 路由
app.use('/api/auth', loginLimiter, require('./routes/auth'));
app.use('/api/pool', require('./routes/pool'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/activities', require('./routes/activities'));
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api/workorders', require('./routes/workorders'));
app.use('/api/admin', require('./routes/admin'));

// 上传文件访问（需登录）
const { authMiddleware } = require('./middleware/auth');
app.get('/api/uploads/:filename', authMiddleware, (req, res) => {
  const filePath = path.join(uploadsDir, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ code: 404, msg: '文件不存在' });
  res.sendFile(filePath);
});

// 用户信息接口
app.get('/api/user/profile', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, phone, name, dealer_code, role, status, must_change_pwd FROM users WHERE id = ?').get(req.user.id);
  res.json({ code: 0, data: user });
});

// 健康检查
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ code: 500, msg: '服务器内部错误' });
});

// 启动
app.listen(PORT, () => {
  console.log(`RSMS Backend running at http://localhost:${PORT}`);
  initCron();
});
