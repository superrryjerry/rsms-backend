const cron = require('node-cron');
const dayjs = require('dayjs');
const { getDb } = require('../config/db');

function initCron() {
  // 每日 00:30 执行
  cron.schedule('30 0 * * *', () => {
    console.log('[Cron] 开始执行每日任务...', dayjs().format('YYYY-MM-DD HH:mm:ss'));
    try {
      refreshContractStatus();
      generateLeads();
      console.log('[Cron] 每日任务完成');
    } catch (e) {
      console.error('[Cron] 任务失败:', e.message);
    }
  });
}

function refreshContractStatus() {
  const db = getDb();
  const today = dayjs().format('YYYY-MM-DD');

  // 从 sys_config 读取阈值配置
  const configs = {};
  db.prepare('SELECT * FROM sys_config').all().forEach(c => { configs[c.config_key] = c.config_value; });
  const warnMonths = parseInt(configs['lead.time_months'] || '3');
  const leadMileageKm = parseInt(configs['lead.mileage_km'] || '80000');
  const leadCountRemain = parseInt(configs['lead.count_remain'] || '3');

  const warnDate = dayjs().add(warnMonths, 'month').format('YYYY-MM-DD');

  db.prepare("UPDATE contracts SET status='expired', updated_at=datetime('now') WHERE contract_end_date < ? AND status != 'expired'").run(today);
  db.prepare("UPDATE contracts SET status='expired', updated_at=datetime('now') WHERE (contract_set_mileage - mileage_used <= 0 OR contract_total_count - contract_done_count <= 0) AND status != 'expired'").run();
  db.prepare("UPDATE contracts SET status='warning', updated_at=datetime('now') WHERE contract_end_date <= ? AND contract_end_date >= ? AND status = 'active'").run(warnDate, today);
  db.prepare("UPDATE contracts SET status='warning', updated_at=datetime('now') WHERE (contract_set_mileage - mileage_used <= ? AND contract_set_mileage - mileage_used > 0) AND status = 'active'").run(leadMileageKm);
  db.prepare("UPDATE contracts SET status='warning', updated_at=datetime('now') WHERE (contract_total_count - contract_done_count <= ? AND contract_total_count - contract_done_count > 0) AND status = 'active'").run(leadCountRemain);
  console.log('[Cron] 合同状态刷新完成');
}

function generateLeads() {
  const db = getDb();
  const today = dayjs();
  const configs = {};
  db.prepare('SELECT * FROM sys_config').all().forEach(c => { configs[c.config_key] = c.config_value; });

  const warrantyMonths = parseInt(configs['warranty.months'] || '11');
  const leadTimeMonths = parseInt(configs['lead.time_months'] || '3');
  const leadMileageKm = parseInt(configs['lead.mileage_km'] || '80000');
  const leadCountRemain = parseInt(configs['lead.count_remain'] || '3');

  const vehicles = db.prepare('SELECT v.*, c.contract_end_date, c.contract_set_mileage, c.mileage_used, c.contract_total_count, c.contract_done_count FROM vehicles v LEFT JOIN contracts c ON v.vin = c.vin WHERE v.service_dealer IS NOT NULL').all();

  const insertLead = db.prepare("INSERT INTO leads (vin, lead_type, trigger_value, threshold_value, target_dealer) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM leads WHERE vin = ? AND lead_type = ? AND target_dealer = ? AND created_at >= datetime('now', '-7 days'))");

  let count = 0;
  for (const v of vehicles) {
    // 质保结束预警
    if (v.delivery_date) {
      const warrantyEnd = dayjs(v.delivery_date).add(warrantyMonths, 'month');
      if (warrantyEnd.isBefore(today) || warrantyEnd.isSame(today, 'day')) {
        const r = insertLead.run(v.vin, 'warranty_end', v.delivery_date, `${warrantyMonths}个月`, v.service_dealer, v.vin, 'warranty_end', v.service_dealer);
        if (r.changes) count++;
      }
    }
    if (!v.contract_end_date) continue;
    // 合同时间预警
    const warnDate = dayjs(v.contract_end_date).subtract(0, 'day');
    const threshold = today.add(leadTimeMonths, 'month');
    if (dayjs(v.contract_end_date).isBefore(threshold) || dayjs(v.contract_end_date).isSame(threshold, 'day')) {
      const r = insertLead.run(v.vin, 'contract_time', v.contract_end_date, `${leadTimeMonths}个月`, v.service_dealer, v.vin, 'contract_time', v.service_dealer);
      if (r.changes) count++;
    }
    // 合同里程预警
    const remainMileage = (v.contract_set_mileage || 0) - (v.mileage_used || 0);
    if (remainMileage <= leadMileageKm && remainMileage > 0) {
      const r = insertLead.run(v.vin, 'contract_mileage', String(remainMileage), `${leadMileageKm}km`, v.service_dealer, v.vin, 'contract_mileage', v.service_dealer);
      if (r.changes) count++;
    }
    // 合同次数预警
    const remainCount = (v.contract_total_count || 0) - (v.contract_done_count || 0);
    if (remainCount <= leadCountRemain && remainCount > 0) {
      const r = insertLead.run(v.vin, 'contract_count', String(remainCount), `${leadCountRemain}次`, v.service_dealer, v.vin, 'contract_count', v.service_dealer);
      if (r.changes) count++;
    }
  }
  console.log(`[Cron] 线索生成完成，新增 ${count} 条`);
}

module.exports = { initCron, refreshContractStatus, generateLeads };
