const express = require('express');
const { getDb } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/dashboard - 小程序看板数据
router.get('/', (req, res) => {
  const db = getDb();
  const userId = req.user.id;
  const dealerCode = req.user.dealer_code;

  // 获取经销商信息
  let dealerName = '';
  let dealerCodeStr = '';
  if (dealerCode) {
    const dealer = db.prepare('SELECT dealer_code, dealer_name FROM dealers WHERE dealer_code = ?').get(dealerCode);
    if (dealer) {
      dealerName = dealer.dealer_name;
      dealerCodeStr = dealer.dealer_code;
    }
  }

  // 我的车辆数（service_dealer = 我的经销商code）
  const vehicleCount = dealerCode
    ? db.prepare('SELECT COUNT(*) as c FROM vehicles WHERE service_dealer = ?').get(dealerCode).c
    : 0;

  // 我的客户数（service_dealers_summary 包含我的经销商code）
  const customerCount = dealerCode
    ? db.prepare("SELECT COUNT(*) as c FROM customers WHERE service_dealers_summary LIKE ?").get(`%${dealerCode}%`).c
    : 0;

  // 不活跃车辆数（我的车辆中，8个月内没有工单的）
  let inactiveVehicleCount = 0;
  if (dealerCode) {
    const myVins = db.prepare('SELECT vin FROM vehicles WHERE service_dealer = ?').all(dealerCode).map(v => v.vin);
    if (myVins.length > 0) {
      const placeholders = myVins.map(() => '?').join(',');
      const activeVins = db.prepare(
        `SELECT DISTINCT vin FROM work_orders WHERE vin IN (${placeholders}) AND order_date >= datetime('now', '-8 months')`
      ).all(...myVins).map(a => a.vin);
      inactiveVehicleCount = myVins.length - activeVins.length;
    }
  }

  // 不活跃客户数（我的客户中，8个月内所有名下车辆都没有工单的）
  let inactiveCustomerCount = 0;
  if (dealerCode) {
    const myCustomers = db.prepare("SELECT customer_name FROM customers WHERE service_dealers_summary LIKE ?").all(`%${dealerCode}%`).map(c => c.customer_name);
    if (myCustomers.length > 0) {
      const placeholders = myCustomers.map(() => '?').join(',');
      const activeCustomers = db.prepare(
        `SELECT DISTINCT v.customer_name FROM work_orders w JOIN vehicles v ON w.vin = v.vin WHERE v.customer_name IN (${placeholders}) AND w.order_date >= datetime('now', '-8 months')`
      ).all(...myCustomers).map(c => c.customer_name);
      inactiveCustomerCount = myCustomers.length - activeCustomers.length;
    }
  }

  res.json({
    code: 0,
    data: {
      dealer_name: dealerName,
      dealer_code: dealerCodeStr,
      vehicle_count: vehicleCount,
      customer_count: customerCount,
      inactive_vehicle_count: inactiveVehicleCount,
      inactive_customer_count: inactiveCustomerCount
    }
  });
});

module.exports = router;
