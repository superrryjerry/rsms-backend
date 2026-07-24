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
        `SELECT DISTINCT vin FROM work_orders WHERE vin IN (${placeholders}) AND order_date >= datetime('now', '-6 months')`
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
        `SELECT DISTINCT v.customer_name FROM work_orders w JOIN vehicles v ON w.vin = v.vin WHERE v.customer_name IN (${placeholders}) AND w.order_date >= datetime('now', '-6 months')`
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

// GET /api/dashboard/inactive-vehicles - 超6个月无工单车辆列表
router.get('/inactive-vehicles', (req, res) => {
  const db = getDb();
  const dealerCode = req.user.dealer_code;
  
  if (!dealerCode) {
    return res.json({ code: 0, data: [] });
  }
  
  // 获取我的车辆
  const myVins = db.prepare('SELECT vin FROM vehicles WHERE service_dealer = ?').all(dealerCode).map(v => v.vin);
  if (myVins.length === 0) {
    return res.json({ code: 0, data: [] });
  }
  
  const placeholders = myVins.map(() => '?').join(',');
  
  // 查询每辆车的最新工单日期
  const vehiclesWithLastOrder = db.prepare(`
    SELECT v.vin, v.license_plate, v.customer_name, 
           MAX(w.order_date) as last_order_date
    FROM vehicles v
    LEFT JOIN work_orders w ON v.vin = w.vin
    WHERE v.vin IN (${placeholders})
    GROUP BY v.vin
  `).all(...myVins);
  
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const cutoffDate = sixMonthsAgo.toISOString().split('T')[0];
  
  // 筛选超6个月无工单的车辆
  const inactiveVehicles = vehiclesWithLastOrder
    .filter(v => !v.last_order_date || v.last_order_date < cutoffDate)
    .map(v => {
      let daysSince = null;
      let lastOrderDisplay = '从未有工单';
      if (v.last_order_date) {
        const lastDate = new Date(v.last_order_date);
        const now = new Date();
        daysSince = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
        lastOrderDisplay = v.last_order_date;
      }
      return {
        vin: v.vin,
        license_plate: v.license_plate,
        customer_name: v.customer_name,
        last_order_date: v.last_order_date,
        last_order_display: lastOrderDisplay,
        days_since: daysSince
      };
    });
  
  res.json({ code: 0, data: inactiveVehicles });
});

// GET /api/dashboard/inactive-customers - 超6个月无工单客户列表
router.get('/inactive-customers', (req, res) => {
  const db = getDb();
  const dealerCode = req.user.dealer_code;
  
  if (!dealerCode) {
    return res.json({ code: 0, data: [] });
  }
  
  // 获取我的客户
  const myCustomers = db.prepare("SELECT customer_name FROM customers WHERE service_dealers_summary LIKE ?").all(`%${dealerCode}%`).map(c => c.customer_name);
  if (myCustomers.length === 0) {
    return res.json({ code: 0, data: [] });
  }
  
  const placeholders = myCustomers.map(() => '?').join(',');
  
  // 查询每个客户名下车辆的最新工单日期
  const customersWithLastOrder = db.prepare(`
    SELECT v.customer_name,
           MAX(w.order_date) as last_order_date
    FROM vehicles v
    LEFT JOIN work_orders w ON v.vin = w.vin
    WHERE v.customer_name IN (${placeholders})
    GROUP BY v.customer_name
  `).all(...myCustomers);
  
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const cutoffDate = sixMonthsAgo.toISOString().split('T')[0];
  
  // 筛选超6个月无工单的客户
  const inactiveCustomers = customersWithLastOrder
    .filter(c => !c.last_order_date || c.last_order_date < cutoffDate)
    .map(c => {
      let daysSince = null;
      let lastOrderDisplay = '从未有工单';
      if (c.last_order_date) {
        const lastDate = new Date(c.last_order_date);
        const now = new Date();
        daysSince = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
        lastOrderDisplay = c.last_order_date;
      }
      return {
        customer_name: c.customer_name,
        last_order_date: c.last_order_date,
        last_order_display: lastOrderDisplay,
        days_since: daysSince
      };
    });
  
  res.json({ code: 0, data: inactiveCustomers });
});

module.exports = router;
