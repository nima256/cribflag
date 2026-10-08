// Automatic SnappPay "Get Payment Status" reconciliation (required by SnappPay so the
// merchant and SnappPay never disagree about a payment). Pure decision logic and a
// small scheduler; the order mutations live in routes/orders.js.
const MINUTE = 60 * 1000;
const minutes = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return (Number.isFinite(parsed) && parsed > 0 ? parsed : fallback) * MINUTE;
};

const reconcilerConfig = {
  intervalMs: minutes(process.env.SNAPPPAY_RECONCILE_INTERVAL_MINUTES, 5),
  // Leave fresh orders alone: the customer may still be on SnappPay's page.
  minAgeMs: minutes(process.env.SNAPPPAY_RECONCILE_MIN_AGE_MINUTES, 15),
  // After this an unpaid order is closed locally.
  pendingExpireMs: minutes(process.env.SNAPPPAY_PENDING_EXPIRE_MINUTES, 60),
  // A processing lock older than this is treated as abandoned (crash/restart).
  staleLockMs: minutes(process.env.SNAPPPAY_STALE_LOCK_MINUTES, 10),
  batchSize: 50
};

// Documented recovery: SETTLE ⇒ done, VERIFY ⇒ settle, PENDING ⇒ verify (customer may have
// paid without returning), CANCEL/REVERT ⇒ close the order.
function resolveSnappPayAction({ status, ageMs, pendingExpireMs = reconcilerConfig.pendingExpireMs }) {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'SETTLE') return 'settled';
  if (normalized === 'VERIFY') return 'settle';
  if (normalized === 'CANCEL' || normalized === 'REVERT') return 'cancelled';
  if (normalized === 'PENDING') return ageMs >= pendingExpireMs ? 'expire' : 'verify';
  return ageMs >= pendingExpireMs ? 'expire' : 'wait';
}

function startSnappPayReconciler({ runOnce, intervalMs = reconcilerConfig.intervalMs, logger = console }) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runOnce(); }
    catch (error) { logger.error('[SNAPPPAY RECONCILE]', error?.message || error); }
    finally { running = false; }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  const initial = setTimeout(tick, 30 * 1000);
  initial.unref?.();
  return () => { clearInterval(timer); clearTimeout(initial); };
}

module.exports = { reconcilerConfig, resolveSnappPayAction, startSnappPayReconciler };
