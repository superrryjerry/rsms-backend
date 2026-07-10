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
  const warnMonths = parseInt(configs['lead.time_months'] || '2');
  const leadMileageKm = parseInt(configs['lead.mileage_km'] || '30000');
  const leadCountRemain = parseInt(configs['lead.count_remain'] || '2');

  const warnDate = dayjs().add(warnMonths, 'month').format('YYYY-MM-DD');

  // 合同过期判断：contract_close_date有日期且早于今天=expired
  db.prepare("UPDATE contracts SET status='expired', updated_at=datetime('now') WHERE contract_close_date IS NOT NULL AND contract_close_date != 'ing' AND contract_close_date < ? AND status != 'expired'").run(today);
  // 里程或次数用完也=expired
  db.prepare("UPDATE contracts SET status='expired', updated_at=datetime('now') WHERE (contract_set_mileage - mileage_used <= 0 OR contract_total_count - contract_done_count <= 0) AND status != 'expired'").run();
  // 时间预警：contract_end_date在预警窗口内
  db.prepare("UPDATE contracts SET status='warning', updated_at=datetime('now') WHERE contract_end_date <= ? AND contract_end_date >= ? AND status = 'active'").run(warnDate, today);
  // 里程预警：剩余里程<=阈值且>0，且合同未过期（contract_close_date不是已过期日期）
  db.prepare("UPDATE contracts SET status='warning', updated_at=datetime('now') WHERE (contract_set_mileage - mileage_used <= ? AND contract_set_mileage - mileage_used > 0) AND status = 'active' AND (contract_close_date IS NULL OR contract_close_date = 'ing' OR contract_close_date >= ?)").run(leadMileageKm, today);
  // 次数预警：剩余次数<=阈值且>0，且合同未过期
  db.prepare("UPDATE contracts SET status='warning', updated_at=datetime('now') WHERE (contract_total_count - contract_done_count <= ? AND contract_total_count - contract_done_count > 0) AND status = 'active' AND (contract_close_date IS NULL OR contract_close_date = 'ing' OR contract_close_date >= ?)").run(leadCountRemain, today);
  console.log('[Cron] 合同状态刷新完成');
}

/**
 * 判断合同是否已结束
 * 合同结束条件（满足任一即可）：
 * 1. 状态为 "Closed and Settled Contract"
 * 2. contract_close_date（合同结束确定时间）有明确日期值（非空、非"ing"）
 * 3. 已跑里程 > 设置里程
 * 4. 已完成次数 > 总次数
 */
function isContractEnded(contract) {
  // 1. 状态为 Closed and Settled Contract
  if (contract.contract_status === 'Closed and Settled Contract') {
    return true;
  }
  
  // 2. contract_close_date（合同结束确定时间）有明确日期值
  if (contract.contract_close_date && contract.contract_close_date !== 'ing') {
    return true;
  }
  
  // 3. 已跑里程 > 设置里程
  const setMileage = contract.contract_set_mileage || 0;
  const usedMileage = contract.mileage_used || 0;
  if (setMileage > 0 && usedMileage > setMileage) {
    return true;
  }
  
  // 4. 已完成次数 > 总次数
  const totalCount = contract.contract_total_count || 0;
  const doneCount = contract.contract_done_count || 0;
  if (totalCount > 0 && doneCount > totalCount) {
    return true;
  }
  
  return false;
}

function generateLeads() {
  const db = getDb();
  const today = dayjs();
  const configs = {};
  db.prepare('SELECT * FROM sys_config').all().forEach(c => { configs[c.config_key] = c.config_value; });

  const warrantyMonths = parseInt(configs['warranty.months'] || '11');
  const leadTimeMonths = parseInt(configs['lead.time_months'] || '2');
  const leadMileageKm = parseInt(configs['lead.mileage_km'] || '30000');
  const leadCountRemain = parseInt(configs['lead.count_remain'] || '2');

  // 获取车辆及其合同信息（包含 status 和 contract_close_date 用于判断合同是否结束）
  const vehicles = db.prepare(`
    SELECT v.*, 
           c.contract_end_date, c.contract_set_mileage, c.mileage_used, 
           c.contract_total_count, c.contract_done_count, c.contract_type,
           c.status as contract_status, c.contract_close_date
    FROM vehicles v 
    LEFT JOIN contracts c ON v.vin = c.vin 
    INNER JOIN dealers d ON v.service_dealer = d.dealer_code
  `).all();

  // 查询每辆车的Extended Warranty合同（用于质保到期判断）
  const getExtendedWarranty = db.prepare("SELECT contract_end_date FROM contracts WHERE vin = ? AND contract_type LIKE '%Extended Warranty%' ORDER BY contract_end_date DESC LIMIT 1");

  const insertLead = db.prepare("INSERT INTO leads (vin, lead_type, trigger_value, threshold_value, target_dealer, status) SELECT ?, ?, ?, ?, ?, 'unfollowed' WHERE NOT EXISTS (SELECT 1 FROM leads WHERE vin = ? AND lead_type = ? AND target_dealer = ? AND created_at >= datetime('now', '-7 days'))");

  let count = 0;
  for (const v of vehicles) {
    // ========== 质保到期预警（不受合同结束影响）==========
    if (v.delivery_date) {
      const ewContract = getExtendedWarranty.get(v.vin);
      let warrantyEndDate;
      let triggerValue;
      
      if (ewContract) {
        // 有延保合同，用延保到期日期
        warrantyEndDate = dayjs(ewContract.contract_end_date);
        triggerValue = 'Extended Warranty';
      } else {
        // 无延保合同，用原厂质保（交付+11月）
        warrantyEndDate = dayjs(v.delivery_date).add(warrantyMonths, 'month');
        triggerValue = v.delivery_date;
      }
      
      const warnDeadline = today.add(leadTimeMonths, 'month');
      // 质保到期日 >= 今天 且 <= 今天+预警月数 → 即将到期，需要提醒
      if ((warrantyEndDate.isAfter(today) || warrantyEndDate.isSame(today, 'day')) && warrantyEndDate.isBefore(warnDeadline)) {
        const r = insertLead.run(v.vin, 'warranty_end', triggerValue, warrantyEndDate.format('YYYY-MM-DD'), v.service_dealer, v.vin, 'warranty_end', v.service_dealer);
        if (r.changes) count++;
      }
    }
    
    // ========== 以下线索类型：合同结束后不再生成 ==========
    
    // 先判断合同是否已结束
    if (isContractEnded(v)) {
      // 合同已结束，跳过 contract_time、contract_mileage、contract_count 线索生成
      continue;
    }
    
    // ========== 合同时间预警 ==========
    if (v.contract_end_date) {
      const contractEnd = dayjs(v.contract_end_date);
      const contractWarnDeadline = today.add(leadTimeMonths, 'month');
      // 合同结束日期 >= 今天 且 <= 今天+预警月数 → 即将到期，需要提醒
      if ((contractEnd.isAfter(today) || contractEnd.isSame(today, 'day')) && contractEnd.isBefore(contractWarnDeadline)) {
        const r = insertLead.run(v.vin, 'contract_time', v.contract_type || '', v.contract_end_date, v.service_dealer, v.vin, 'contract_time', v.service_dealer);
        if (r.changes) count++;
      }
    }
    
    // ========== 合同里程预警 ==========
    const remainMileage = (v.contract_set_mileage || 0) - (v.mileage_used || 0);
    if (remainMileage <= leadMileageKm && remainMileage > 0) {
      const r = insertLead.run(v.vin, 'contract_mileage', String(remainMileage), `${leadMileageKm}km`, v.service_dealer, v.vin, 'contract_mileage', v.service_dealer);
      if (r.changes) count++;
    }
    
    // ========== 合同次数预警 ==========
    const remainCount = (v.contract_total_count || 0) - (v.contract_done_count || 0);
    if (remainCount <= leadCountRemain && remainCount > 0) {
      const r = insertLead.run(v.vin, 'contract_count', String(remainCount), `${leadCountRemain}次`, v.service_dealer, v.vin, 'contract_count', v.service_dealer);
      if (r.changes) count++;
    }
  }
  console.log(`[Cron] 线索生成完成，新增 ${count} 条`);
}

module.exports = { initCron, refreshContractStatus, generateLeads };