const express = require('express');
const { torobApiV3, torobSitemapXml, torobSitemapHtml, siteSitemapXml, robotsTxt } = require('../controllers/torobController');
const { torobAuth } = require('../middlewares/torobAuth');

const router = express.Router();

router.post(
  '/torob_api/v3/products',
  express.json({ limit: '1mb' }),
  express.urlencoded({ extended: true, limit: '1mb' }),
  torobAuth,
  torobApiV3
);
router.get('/sitemap.xml', siteSitemapXml);
router.get('/robots.txt', robotsTxt);
router.get('/torob-sitemap', torobSitemapXml);
router.get('/torob-sitemap.xml', torobSitemapXml);
router.get('/torob-sitemap-view', torobSitemapHtml);

module.exports = router;
