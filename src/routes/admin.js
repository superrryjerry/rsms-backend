const express = require('express');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, adminOnly);

// 子路由模块
router.use('/requests', require('./admin/requests'));
router.use('/users', require('./admin/users'));
router.use('/config', require('./admin/config'));
router.use('/dealers', require('./admin/dealers'));
router.use('/import', require('./admin/import'));
router.use('/templates', require('./admin/templates'));
router.use('/activities', require('./admin/activities'));
router.use('/customer-tags', require('./admin/customer-tags'));

module.exports = router;
