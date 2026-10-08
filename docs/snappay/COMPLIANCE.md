# SnappPay integration — Crib Flag (branch `cribflag-snappay`)

This is the same SnappPay work done for Odour (`nima256/odour`, branch `odour-snappay`), rebuilt for Crib Flag's own architecture. Crib Flag had no SnappPay code before this branch.

Sources: SnappPay support messages (review items 1–8, test scenario), integration doc section 6 (screenshot), "Snapp!Pay PDP Guidelines.pdf", and `Gateway_Samples--New_Logo.rar` (official logo kit + gateway samples).

Legend: ✅ implemented and verified here · 🟡 implemented, needs staging / SnappPay confirmation · ⛔ needs you or SnappPay.

## Requirements → implementation

| Requirement (source) | Where | Verified | Status |
|---|---|---|---|
| `isTaxIncluded: true` [review #1] | `services/snappPayPricing.js` | `test/snappPay-unit.test.js` | ✅ |
| Never send `forcedPaymentMethodTypes` [review #2] | `services/snappPay.js` `paymentBody` (token + update) | exact request body asserted | ✅ |
| Formula `total = Σ count×amount (+shipping/tax if not included)`, `amount = total − (discount + external)` [MSG] | `buildSnappPayPayload` | scenario test asserts both equations | ✅ |
| Eligible called with the final amount, `?amount=` only, re-called whenever the amount changes [doc 6 #2, #6] | `POST /api/orders/snappay/eligibility` computes the amount on the **server** from the cart + coupon; checkout re-checks on step 2 and on every coupon apply/remove; server re-checks before creating the token | route test (server amount used, client price ignored) | ✅ |
| Show the gateway only when `eligible === true` [doc 6 #2, #4] | `app.js` `refreshSnappPayEligibility` hides it and switches the customer to ZarinPal if it becomes ineligible | route test | ✅ |
| Title + description dynamic from `title_message` / `description`, two lines beside the **new logo** [review #5, follow-ups] | `views/checkout.ejs` `#snappPayOption`, `app.js` | screenshots + measurements | ✅ (320 px: see limits) |
| PDP per guideline, **no eligible call** [review #4, PDP PDF] | `views/product.ejs` `#detailSnappPay`, `style.css`; live update per size/fabric in `updateDetailPrice` | screenshots + measurements | ✅ |
| verify / settle called by the system [MSG check #2] | `POST /api/orders/snappay/callback` | route tests | ✅ |
| Get Payment Status automatic [review #8, MSG] | `services/snappPayReconciler.js`, `reconcileSnappPayOrder` in `routes/orders.js`, started in `server.js` (`start()`); recovery in `verifyWithRecovery` / `settleWithStatusRecovery` | unit + route tests | 🟡 (doc pp. 19–21 not provided) |
| Transaction ID shown to the customer after payment [MSG check #3] | `routes/pages.js` + `views/success.ejs` "شناسه تراکنش اسنپ‌پی" | screenshot | ✅ |
| Transaction ID visible and searchable in admin orders; admin acts on the order from there [MSG check #3] | admin search also matches the SnappPay transaction ID and payment token; gateway filter "اسنپ‌پی"; order modal shows the SnappPay panel | code + JS syntax check | ✅ (admin UI not screenshotted) |
| Update repeatable; cancel allowed on an updated order [MSG check #4] | `POST /api/admin/orders/:no/snappay/update` and `/cancel` | route test: 2 updates, then cancel | ✅ |
| Confirmation popup before update/cancel [MSG] | `admin.js` `runSnappPayAction` (lists each change); server rejects requests without `confirmed: true` | route test | ✅ |
| With one item left, update disabled; only cancel [MSG final scenario] | UI disables the button with an explanation; server returns 400 | route test | ✅ |
| Paid SnappPay order can't be cancelled silently from the generic status dropdown or bulk action (would desync with SnappPay) | `assertNotSilentSnappPayCancel` in `routes/admin.js` | code | ✅ |
| Apply every site feature incl. discount codes [MSG] | coupon passes through quote → token; partial returns recalculate percent coupons and pro-rate fixed ones (variant-limited coupons count only eligible lines) | unit tests | ✅ |
| Inventory | applied between verify and settle; out of stock → **revert** + order cancelled; partial returns restock; cancel releases stock and coupon | route tests | ✅ |
| Untrusted callback | amount mismatch never settles (left for the reconciler); a FAILED callback is confirmed with status first; late payment on an expired order → verify + revert; atomic per-order lock (stale after 10 min) | route tests | ✅ |
| Secrets server-side only | `config/env.js` reads `.env`; nothing reaches the browser | code | ✅ |

## Measured UI (headless Chromium, real EJS views)

| Element | Guideline | 320 | 375 | 768 | 1440 |
|---|---|---|---|---|---|
| PDP logo (official asset) | ≥ 24 px | 32 | 32 | 40 | 40 |
| PDP title "هر قسط با اسنپ‌پی: ۱۲۳,۴۵۶ تومان" | > 12 px, Bold, #1A1C23 | 13/700 ✓ | 13 | 14 | 14 |
| PDP subtitle "۴ قسط ماهانه. بدون سود، چک و ضامن." | > 10 px, Regular, #616475 | 11/400 ✓ | 11 | 12 | 12 |
| Checkout title (`title_message`) | line 1 | wraps | 1 line | 1 line | 1 line |
| Checkout description | line 2 | wraps | 1 line | 1 line | 1 line |
| Horizontal overflow | — | 0 | 0 | 0 | 0 |

Raw numbers are in `docs/snappay/screenshots/measurements.json`.

## Tests

- `npm run test:unit`: 31/31 pass (10 existing + 21 new SnappPay tests: API contract, recovery, payload formula, discount recalculation, callback, reconciler, admin update/cancel, eligibility).
- `npm run check`: syntax OK.
- `npm run smoke` **already fails on `master`** before this branch (`expected 403, got 200` on the cross-site logout check; origin filtering is disabled in `server.js`). This branch did not cause it.

## Limits and open items

1. **No Crib Flag SnappPay credentials yet.** The staging file you sent is for the Odour merchant. Ask SnappPay to create a separate merchant for Crib Flag (or confirm that one is allowed) before testing.
2. Staging is not reachable from this sandbox, so no live SnappPay call was made. All tests ran against mocks of the documented contract.
3. On a 320 px screen the dynamic title wraps; making it fit would need a font below the PDF's 12 px minimum.
4. Shipping is paid on delivery (`shipping = 0`), so the cart sends `isShipmentIncluded: true, shippingAmount: 0`, like SnappPay's sample. If shipping is ever charged online, it goes out separately (tested).
5. Removed the product-page line "خرید قسطی برای سفارش‌های عمده و سازمانی با هماهنگی پشتیبانی امکان‌پذیر است." because it contradicts the SnappPay instalment offer shown right above it.
6. Existing inconsistency, not changed: TorobPay's VAT is 10 % in `app.js` but 15 % on the server. The server quote wins, but the preview before the quote is off.
7. Removing a custom-design item in a SnappPay update leaves that design request linked to the order number. Review it manually if that case happens.

## Steps to approval

1. Get Crib Flag SnappPay credentials. Put them in the server `.env` (see `.env.snappay.example`) with an HTTPS `SITE_URL`, then restart.
2. Send SnappPay the server IP and the tester's mobile number.
3. Record the scenario (cart under 100,000 toman):
   - a regular product ×2, a discounted product ×1, and a high-percentage coupon
   - pay, and show the transaction ID on the result page
   - in admin, search the ID and run an update (2 → 1), wait 30 s, then a second update (remove the discounted product); the update button is now disabled
   - cancel the whole order
4. Send the video plus the **payment token** (shown in the admin order modal), then do the live demo.
