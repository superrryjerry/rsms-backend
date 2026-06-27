const express = require('express');
const XLSX = require('xlsx');
const { authMiddleware, adminOnly } = require('../../middleware/auth');

const router = express.Router();
router.use(authMiddleware, adminOnly);

// 模板定义
const templates = {
  pool: {
    name: '公海池导入模板',
    headers: ['VIN', 'VIN_FULL', '车牌', '客户名称', '车辆类型', '销售经销商', '车型', '交付日期', '生产日期'],
    sample: [['LSVAU2A3XN2012345', 'LSVAU2A3XN2012345', '沪A12345', '张三', '牵引车', 'D001', '车型A', '2024-01-15', '2023-12-01']]
  },
  vehicles: {
    name: '车辆导入模板',
    headers: ['VIN', 'VIN_FULL', '车牌', '客户名称', '车辆类型', '销售经销商', '服务经销商', '车型', '交付日期', '生产日期', '中央合同', '年总收入'],
    sample: [['LSVAU2A3XN2012345', 'LSVAU2A3XN2012345', '沪A12345', '张三', '牵引车', 'D001', 'D002', '车型A', '2024-01-15', '2023-12-01', '中央合同', 500000]]
  },
  contracts: {
    name: '合同导入模板',
    headers: ['VIN', '开始日期', '结束日期', '关闭日期', '设置里程', '已用里程', '总次数', '已完成次数', '合同类型', '总部合同编号', '状态'],
    sample: [['LSVAU2A3XN2012345', '2024-01-01', '2026-12-31', '', 500000, 120000, 10, 3, 'DLP', 'AM2024001', 'active']]
  },
  workorders: {
    name: '工单导入模板',
    headers: ['VIN', '工单号', '工单日期', '工单类型', '维修内容', '服务经销商', '经销商代码', '金额'],
    sample: [['LSVAU2A3XN2012345', 'S240920076', '2024-09-20', '保养', '常规保养', 'D002', 'D002', 2500]]
  },
  customers: {
    name: '客户导入模板',
    headers: ['客户名称', '标签', '所在市', '注册信息'],
    sample: [['张三', 'core', '上海', '法人：张三，注册地址：上海市浦东新区XX路XX号']]
  }
};

// GET /api/admin/import/templates
router.get('/templates', (req, res) => {
  const list = Object.entries(templates).map(([key, t]) => ({ key, name: t.name, headers: t.headers }));
  res.json({ code: 0, data: list });
});

// GET /api/admin/import/template/:type
router.get('/template/:type', (req, res) => {
  const tpl = templates[req.params.type];
  if (!tpl) return res.status(404).json({ code: 404, msg: '模板不存在' });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([tpl.headers, ...tpl.sample]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(tpl.name)}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

module.exports = router;
