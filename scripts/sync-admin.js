const mongoose = require('mongoose');
const env = require('../config/env');
const { ensureAdminFromEnv } = require('../services/adminAccount');

async function run() {
  await mongoose.connect(env.mongodbUri);
  const result = await ensureAdminFromEnv();
  console.log(`Admin synchronized: ${result.email}`);
  await mongoose.disconnect();
}

run().catch(async error => {
  console.error('Admin synchronization failed:', error.message);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
