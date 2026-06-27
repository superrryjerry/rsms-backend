# RSMS CRM Backend

基于 Node.js + Express 的 CRM 系统后端 API。

## 技术栈

- **运行时**: Node.js
- **框架**: Express.js
- **数据库**: SQLite (better-sqlite3)
- **认证**: JWT

## 主要功能

- 用户认证与授权
- 经销商管理（支持一/二级层级关系）
- 客户管理
- 车辆管理
- 合同管理
- 工单管理
- 销售活动管理
- 线索管理
- 数据导入/导出

## 项目结构

```
src/
├── config/          # 配置文件
├── middleware/      # 中间件
├── migrations/      # 数据库迁移
├── routes/          # API路由
│   ├── admin/       # 管理员接口
│   └── ...          # 其他业务接口
├── services/        # 业务服务
└── app.js           # 应用入口
```

## API 文档

### 认证相关
- POST /api/auth/login - 用户登录
- POST /api/auth/change-password - 修改密码

### 客户管理
- GET /api/customers/list - 客户列表
- GET /api/customers/detail/:name - 客户详情
- POST /api/customers/create - 创建客户
- PUT /api/customers/update - 更新客户

### 车辆管理
- GET /api/vehicles/list - 车辆列表
- POST /api/vehicles/apply - 申请成为服务经销商
- PUT /api/vehicles/update-service-dealer - 编辑服务经销商

### 销售活动
- GET /api/activities/list - 活动列表
- POST /api/activities/create - 创建活动

### 线索管理
- GET /api/leads/list - 线索列表
- PUT /api/leads/:id/status - 更新线索状态

## 数据隔离规则

- **一级经销商**: 可查看自己及所有子经销商的销售活动
- **二级经销商**: 仅可查看自己的销售活动
- **一级经销商之间**: 数据完全隔离，互不可见

## 部署说明

### 环境要求
- Node.js >= 14.x
- npm >= 6.x

### 安装依赖
```bash
npm install
```

### 启动服务
```bash
npm start
```

### 开发模式
```bash
npm run dev
```

## 安全说明

- 所有密码均使用 bcrypt 加密存储
- 敏感信息（数据库路径、JWT密钥等）通过环境变量配置
- 首次登录强制修改初始密码
- 支持 JWT Token 过期机制

## License

MIT
