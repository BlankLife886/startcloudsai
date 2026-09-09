# Order Workflow

## State And Authority

| State | User action | Display |
| --- | --- | --- |
| pending | Refresh or request cancellation; pay only with a valid, unexpired URL and a successful status check | Amount due |
| uncertain | Refresh or request staff verification; no new checkout or user cancellation | Provider result is not yet known |
| paid | Refresh; no repeat payment | Payment received, credit confirmation pending |
| completed | Inspect order and wallet | Amount paid and delivered credits |
| cancelled | Inspect or choose another plan | Cancelled, not expired |
| expired / failed | Inspect or choose another plan | Expired / creation failed; not an assertion of payment |

Client expiry stops QR/link display; it does not declare the transaction failed.
Validated provider confirmation is authoritative. A payment racing cancellation can
complete the order, and the client refreshes the wallet in this case.

Migration `00127_order_cancelled_status.sql` separates successful cancellation
(`cancelled`) from provider expiry (`expired`). A repeated cancellation preserves
the saved terminal state; ordinary reconciliation must not turn cancelled into
expired. Only verified payment evidence can promote cancelled to paid and complete
delivery. Summary and filters expose `cancelled` independently. Legacy expired
records have no reliable cause and are not guessed or backfilled as cancelled.
Deploy API and clients together. Downgrade refuses existing cancelled records
instead of discarding their meaning.

## Purchase Records

Migration `00123_order_plan_snapshot.sql` adds the purchased plan name, kind,
duration, daily credits, and the subscription end delivered by this order.
New orders capture these fields when inserted. Completion uses the saved terms,
not subsequent catalog changes. The amount and top-up credits remain on the
existing order fields.

Historical rows remain without a snapshot: the original terms cannot be recovered
from the current catalog. `planSnapshotAvailable: false` distinguishes the fallback.
Missing subscription end dates are not estimated from creation or payment time.

## User API

`GET /api/v1/orders` accepts `status`, `cursor`, `limit`, and `q` (up to 100
characters). Search matches the order ID, provider ID, or purchased plan name.
All queries are scoped to the authenticated user.

The response includes `items`, `nextCursor`, and `summary`. Summary counts are
account-wide and independent of the current page, status filter, or search.

`GET /api/v1/orders/{id}` includes saved plan metadata. If provider reconciliation
fails, the response preserves stored values and adds `syncError`; unvalidated
provider payment details are not exposed as a usable checkout.

## Client Behavior

- Currency retains two decimal places; integer credits are not currency.
- Detail requests are abortable and tied to the selected order and current user.
- Polling is sequential, pauses in hidden tabs, and never overlaps its own requests.
- Failed page navigation keeps the current page and cursor history intact.
- Completion, including completion discovered while cancelling, refreshes the wallet.
- Search, status filters, manual retry, keyboard focus, and copy feedback have separate states.

## Rollout And Boundaries

Deploy the server and client together. Server startup applies the migration.
Verification uses disposable test databases; it does not migrate the running
application database or change payment credentials/configuration.

Migration `00124_payment_recovery_and_subscription_periods.sql` adds the recovery
queue and subscription periods. Deploy API, Worker, web and admin together.
Pause the old Worker before migration and restart the upgraded Worker; mixing the
old daily-grant implementation with the new period model can issue the wrong rate.
Rollback refuses unresolved `uncertain` orders instead of silently marking them failed.

## Ambiguous Payment Creation

Before calling the provider, save the expected amount and payment method and move
the order to `uncertain`. A timeout returns HTTP 202 with the saved order ID.
Each user can have only one unsettled checkout across all plans. Pending,
uncertain and paid-but-not-delivered orders block purchasing another plan with
HTTP 409 `user_unsettled_order`; the user must first pay, cancel, or resolve it.
Requests for the same plan reuse the unresolved order, not a new provider request.
The insert transaction uses a user-level advisory lock and repeats the account-wide
check to cover concurrent requests across plans and API instances. Deploy API instances
together: older instances still use plan-level locks. Existing historical duplicates
are not deleted or blindly marked closed; they must be resolved against the provider.
A validated create response restores `pending`; an early verified callback
can complete it before that response without causing cancellation or duplicate credits.

Verified payment evidence can recover `uncertain` and historical `failed` orders.
Unverified manual completion cannot promote these states. The existing signature,
merchant ID, amount and payment-method validations still apply.

The current provider adapter does not have a documented merchant-ID lookup API.
Recovery without a provider ID therefore uses signed callbacks or the existing
admin-only audited `POST /api/v1/admin/payment-reconciliations/run` endpoint:

- `{orderId, providerOrderId}` queries the provider and validates the association
  before saving it and reconciling. It never creates a provider order.
- `{orderId, resolution: "not_created", note}` requires an unbound uncertain order
  and a 6-300-character investigation note. It records the operator and decision,
  marks the order failed and stops automatic retries. Staff must actually verify
  that no order/payment exists; a timeout is not evidence. A later valid payment
  callback can still recover the order.

The reconciliation listing advertises `recoverySupported: true`. The new admin
UI hides recovery actions on older backends to avoid their ignoring the request body.

## Subscription Periods And Catch-Up

The natural-day rules below apply to legacy `billing_version=1` records. New
subscriptions use anchored 24-hour periods, scoped credits and separate upgrade/refund
workflows. See [SUBSCRIPTIONS.md](SUBSCRIPTIONS.md).

Renewals preserve the old period's rate. Each new order creates a period starting
at the existing subscription's end, with its own daily credits and duration. The
current subscription rate is read from the currently effective period. Order
details expose both `subscriptionStartsAt` and `subscriptionEndsAt`.

Each new period delivers exactly `durationDays` daily grants beginning on its
Beijing activation date, never before its activation timestamp. Subscription
duration remains unchanged; the expiry date does not add a bonus 31st installment.

The Worker catches up up to 200 due periods per pass and 60 dates per period in a
transaction, including expired periods. Persisted `next_grant_on` resumes subsequent
passes. Ledger keys remain `subscription_id/YYYY-MM-DD`, so previously granted
dates and concurrent recovery do not double-credit. The last-granted marker never
moves backwards. Deleted accounts are excluded.

Legacy periods use the existing subscription record's rate and dates, not today's
catalog. Existing grants are preserved. Review this historical catch-up backlog
before production rollout: the Worker will replenish genuinely missing ledger dates.

## Reconciliation Queue

Production checks start after 30 seconds and run every minute without overlap.
Each pass processes at most 100 orders within a 45-second budget, in leased batches
of 20. Unsettled orders have priority and no 30-day cutoff; completed/expired audit
traffic is bounded to the recent 30 days. Due-time ordering covers records beyond
the former newest-500 window. Two-minute leases recover crashed workers, and lease
tokens prevent stale workers from overwriting newer schedules.

Pending matches recheck after five minutes; settled matches after 24 hours. Errors
back off from five minutes (15 for missing IDs), capped at six hours. The admin
screen shows each order's latest outcome; repaired issues are resolved in the risk
record. This uses the existing in-app risk/audit system, not an unconfigured external
email/SMS alert channel.

Subscription refund requests and same-series upgrades are covered in
[SUBSCRIPTIONS.md](SUBSCRIPTIONS.md). Actual channel refunds require manual provider
confirmation. Invoices and direct cross-series conversions remain out of scope.
