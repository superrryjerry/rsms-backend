-- V2 迁移脚本：新增字段
-- 客户表新增字段
ALTER TABLE customers ADD COLUMN tag VARCHAR(32);
ALTER TABLE customers ADD COLUMN city VARCHAR(64);
ALTER TABLE customers ADD COLUMN registration_info TEXT;

-- 车辆表新增字段
ALTER TABLE vehicles ADD COLUMN central_contract VARCHAR(64);
ALTER TABLE vehicles ADD COLUMN annual_income DECIMAL(12,2);

-- 合同表新增字段
ALTER TABLE contracts ADD COLUMN contract_start_date DATE;
ALTER TABLE contracts ADD COLUMN contract_close_date DATE;
ALTER TABLE contracts ADD COLUMN contract_type VARCHAR(64);
ALTER TABLE contracts ADD COLUMN headquarters_contract_no VARCHAR(64);

-- 工单表新增字段
ALTER TABLE work_orders ADD COLUMN order_no VARCHAR(64);
ALTER TABLE work_orders ADD COLUMN dealer_code VARCHAR(32);
