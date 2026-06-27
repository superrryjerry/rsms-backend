-- RSMS 数据库初始化脚本

-- 经销商字典表
CREATE TABLE IF NOT EXISTS dealers (
  dealer_code VARCHAR(32) PRIMARY KEY,
  dealer_name VARCHAR(128) NOT NULL,
  dealer_type VARCHAR(32) DEFAULT 'both',
  parent_dealer_code VARCHAR(32) REFERENCES dealers(dealer_code),
  level TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone VARCHAR(16) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(64) NOT NULL,
  dealer_code VARCHAR(32) REFERENCES dealers(dealer_code),
  role VARCHAR(32) DEFAULT 'dealer_staff',
  status TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 公海池表
CREATE TABLE IF NOT EXISTS public_pool (
  vin VARCHAR(32) PRIMARY KEY,
  vin_full VARCHAR(64) NOT NULL,
  license_plate VARCHAR(32),
  customer_name VARCHAR(128),
  vehicle_type VARCHAR(32),
  sales_dealer VARCHAR(32),
  service_dealer VARCHAR(32),
  model VARCHAR(128),
  delivery_date DATE,
  production_date DATE,
  claimed_by INTEGER,
  claimed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 车辆表
CREATE TABLE IF NOT EXISTS vehicles (
  vin VARCHAR(32) PRIMARY KEY,
  vin_full VARCHAR(64) NOT NULL,
  license_plate VARCHAR(32),
  customer_name VARCHAR(128),
  vehicle_type VARCHAR(32),
  sales_dealer VARCHAR(32),
  service_dealer VARCHAR(32),
  model VARCHAR(128),
  delivery_date DATE,
  production_date DATE,
  central_contract VARCHAR(64),
  annual_income DECIMAL(12,2),
  claimed_by INTEGER REFERENCES users(id),
  claimed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 客户表
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name VARCHAR(128) UNIQUE NOT NULL,
  sales_dealers_summary VARCHAR(512),
  service_dealers_summary VARCHAR(512),
  tag VARCHAR(32),
  city VARCHAR(64),
  registration_info TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 销售活动表
CREATE TABLE IF NOT EXISTS sales_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  customer_name VARCHAR(128) NOT NULL,
  visit_purpose VARCHAR(255),
  visit_method VARCHAR(32) NOT NULL,
  visit_location VARCHAR(255),
  location_lat DECIMAL(10,8),
  location_lng DECIMAL(11,8),
  photos TEXT DEFAULT '[]',
  visit_time DATETIME,
  content TEXT,
  status VARCHAR(32) DEFAULT 'draft',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);

-- 合同表
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vin VARCHAR(32) NOT NULL REFERENCES vehicles(vin),
  contract_start_date DATE,
  contract_end_date DATE,
  contract_close_date DATE,
  contract_set_mileage INTEGER DEFAULT 0,
  mileage_used INTEGER DEFAULT 0,
  contract_total_count INTEGER DEFAULT 0,
  contract_done_count INTEGER DEFAULT 0,
  contract_type VARCHAR(64),
  headquarters_contract_no VARCHAR(64),
  status VARCHAR(32) DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 工单表
CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vin VARCHAR(32) NOT NULL REFERENCES vehicles(vin),
  order_no VARCHAR(64),
  order_date DATE,
  order_type VARCHAR(64),
  order_content TEXT,
  service_dealer VARCHAR(32),
  dealer_code VARCHAR(32),
  amount DECIMAL(10,2),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 服务经销商变更申请表
CREATE TABLE IF NOT EXISTS service_dealer_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vin VARCHAR(32) NOT NULL REFERENCES vehicles(vin),
  current_dealer VARCHAR(32) REFERENCES dealers(dealer_code),
  request_dealer VARCHAR(32) NOT NULL REFERENCES dealers(dealer_code),
  request_user_id INTEGER NOT NULL REFERENCES users(id),
  request_type VARCHAR(32) NOT NULL,
  target_dealer VARCHAR(32),
  reason VARCHAR(255),
  status VARCHAR(32) DEFAULT 'pending',
  admin_remark VARCHAR(255),
  handled_by INTEGER REFERENCES users(id),
  handled_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 线索表
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vin VARCHAR(32) NOT NULL,
  lead_type VARCHAR(64) NOT NULL,
  trigger_value VARCHAR(128),
  threshold_value VARCHAR(128),
  target_dealer VARCHAR(32) REFERENCES dealers(dealer_code),
  status VARCHAR(32) DEFAULT 'unfollowed',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME
);

-- 系统配置表
CREATE TABLE IF NOT EXISTS sys_config (
  config_key VARCHAR(64) PRIMARY KEY,
  config_value VARCHAR(255) NOT NULL,
  description VARCHAR(255)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_vehicles_service_dealer ON vehicles(service_dealer);
CREATE INDEX IF NOT EXISTS idx_vehicles_customer_name ON vehicles(customer_name);
CREATE INDEX IF NOT EXISTS idx_public_pool_customer_name ON public_pool(customer_name);
CREATE INDEX IF NOT EXISTS idx_sales_activities_user_id ON sales_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_sales_activities_customer_name ON sales_activities(customer_name);
CREATE INDEX IF NOT EXISTS idx_contracts_vin ON contracts(vin);
CREATE INDEX IF NOT EXISTS idx_work_orders_vin ON work_orders(vin);
CREATE INDEX IF NOT EXISTS idx_leads_target_dealer ON leads(target_dealer);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_sdr_status ON service_dealer_requests(status);
CREATE INDEX IF NOT EXISTS idx_sdr_vin ON service_dealer_requests(vin);

-- 初始系统配置
INSERT OR IGNORE INTO sys_config (config_key, config_value, description) VALUES
  ('lead.time_months', '3', '合同时间提前预警月数'),
  ('lead.mileage_km', '80000', '合同里程提前预警公里数'),
  ('lead.count_remain', '3', '合同次数提前预警剩余次数'),
  ('warranty.months', '11', '质保结束预警月数');

-- 示例经销商数据
INSERT OR IGNORE INTO dealers (dealer_code, dealer_name, dealer_type) VALUES
  ('D001', '示例经销商A', 'both'),
  ('D002', '示例经销商B', 'both');
