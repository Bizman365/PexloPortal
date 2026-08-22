# 02 — Billing System

## What

The Pexlo Portal billing system converts tracked client work into auditable invoice records by grouping projects under billing clients, freezing hourly rates on time entries, flagging billed time through invoice line items, and exposing owner/admin and client-facing invoice surfaces.

## Why

Chris invoices externally in Digits, but the portal needs to be the operational source of truth for:

- **Client time → invoice:** billable time is captured against projects/tasks, rolled up by billing client and date range, then attached to a draft or recorded invoice so it cannot be double-billed.
- **R&D / delivery substantiation:** each billed dollar should be traceable back to a project, user, task, date, duration, and completion note where available. `time_entry.invoiceLineItemId` is the billed/not-billed ledger flag.
- **Pattern B from the May 30 design:** use a per-client rate model, flexible date ranges, existing `TimeEntry` / `Invoice` / `InvoiceLineItem` infrastructure, and a copy-or-record workflow for Digits rather than attempting a full accounting integration.
- **Digits compatibility:** the shipped system supports both generated Pexlo draft invoices and externally created Digits invoices recorded back into Pexlo by reference number and optional PDF upload.

## Considered & Rejected

### Original three-page billing plan

The pre-implementation plan (`docs/build/09-billing-system-PLAN.md`) proposed:

1. `/dashboard/billing` client index.
2. `/dashboard/billing/[clientId]` workspace with grouped unbilled time.
3. `/dashboard/billing/invoices/[id]` copy-friendly draft viewer.

**Shipped instead:** a single `/dashboard/billing` page that combines billing-client selection, date range presets, not-invoiced/invoiced time reports, draft generation, external invoice recording, and an invoice list/detail modal. This kept the first production workflow smaller and avoided routing churn.

### Full Digits API integration

**Rejected.** The design intentionally keeps Digits as the accounting system and Pexlo as the time/substantiation system. Recording a Digits invoice number and optional PDF is lower-risk than building and maintaining a deep integration.

### Reusing `ProjectClient` as the billable client model

**Rejected.** `ProjectClient` is a user-to-project access relation for the client portal. It answers “which client user can see this project?” It is not the billable business entity. The billing system uses `BillingClient` for that concept.

### Per-client rate only, with no snapshots

**Rejected.** Rate changes must not rewrite billing history. The system resolves rates when entries are created/resolved, stores the value on `TimeEntry.hourlyRateCents`, and only backfills missing historical rates during invoice generation when an entry has no positive rate.

### Invoice-only status as the payment source of truth

**Rejected / split.** Manual status transitions are still supported (`draft -> sent -> paid|overdue|cancelled`), but online payments are owned by the payment subsystem. Stripe webhooks write `paidAt`, `paidAmount`, and `stripePaymentIntentId`; a manual `PUT /invoices/:id` to `paid` does not add payment metadata.

## What We Built

### Data model

Source of truth: `packages/database/prisma/schema.prisma`.

#### `BillingClient` (`billing_client`)

Represents an external billable entity such as CSP.

Key fields:

- `organizationId`
- `name`
- `slug`
- `defaultHourlyRateCents`
- `billingPeriod`
- `billingNotes`
- `externalReference`
- `archivedAt`
- relations to `Project[]`, `Invoice[]`, and `File[]`

Constraints / indexes:

- unique `[organizationId, slug]`
- unique `[organizationId, name]`
- index `[organizationId, archivedAt]`

#### `Project.billingClientId`

Projects can optionally point at a `BillingClient`:

- nullable FK
- `onDelete: SetNull`
- indexed by `billingClientId`

This lets one billable client contain multiple projects while internal projects remain unlinked.

#### `Invoice`

Invoice records support project-scoped, client-scoped, uploaded, and external invoice flows.

Key fields:

- `invoiceNumber` unique per organization (`INV-0001`, etc.)
- `status` string with code-supported values: `draft`, `sent`, `paid`, `overdue`, `cancelled`
- `type` string with observed values: `itemized`, `uploaded`, `external`
- `amount` for uploaded/external invoices
- `projectId` nullable
- `billingClientId` nullable
- `externalReference` for Digits/reference numbers
- `uploadedFileId` for uploaded PDFs
- Stripe payment tracking: `stripeCheckoutSessionId`, `stripePaymentIntentId`, `paidAt`, `paidAmount`

The admin list/detail API includes `lineItems`, `uploadedFile`, `project { id, name }`, and `billingClient { id, name }`.

#### `InvoiceLineItem`

Line items carry invoice math and own the billed-time linkage.

Key fields:

- `description`
- `quantity`
- `unitPrice` in cents
- `invoiceId`
- reverse relation to `TimeEntry[]`

Deleting line items cascades from the invoice, while time entries point to the line item via `invoiceLineItemId` with `onDelete: SetNull`.

#### `TimeEntry`

Time entries are the billable work ledger.

Billing-relevant fields:

- `projectId`, `taskId`, `userId`
- `startedAt`, `endedAt`, `durationSec`
- `billable` default `true`
- `hourlyRateCents` as the frozen/rate-snapshot value
- `invoiceLineItemId` as the “already billed” flag

Rate resolution order in `TimeEntriesService.resolveRate()`:

1. `Project.hourlyRateCents`
2. linked `BillingClient.defaultHourlyRateCents`
3. `Member.hourlyRateCents`
4. `null`

#### `PendingTimeCapture`

A pending capture is created when a task is marked done and there is no running timer to attach the completion note to.

Key fields:

- `projectId`, optional `taskId`
- `kind` default `task_done`
- `label`
- `completedByType`, `completedByName`, `completedAt`
- `resolvedAt`, `resolvedTimeEntryId`

Resolving a pending capture creates a real `TimeEntry`, creates a `TimeEntryLog`, resolves rates, and marks the capture resolved.

### API surface

#### Billing-client CRUD: `apps/api/src/billing-clients/*`

Controller base: `billing-clients`.

- `GET /billing-clients`
  - Owner/admin only.
  - Supports pagination and `archived=true`; by default excludes archived clients.
- `GET /billing-clients/:id`
  - Includes linked projects `{ id, name, archivedAt }`.
- `POST /billing-clients`
  - Creates org-scoped client; normalizes nullable string fields.
- `PATCH /billing-clients/:id`
  - Rejects archived clients.
- `DELETE /billing-clients/:id`
  - Soft-archives via `archivedAt`.

#### Invoices: `apps/api/src/invoices/*`

Controller base: `invoices`.

Admin/owner routes:

- `POST /invoices`
  - Creates a draft itemized invoice from explicit line items.
- `POST /invoices/upload`
  - Uploads a PDF/file and creates an uploaded draft invoice.
- `POST /invoices/record`
  - Records an external Digits/reference invoice against selected time entries.
  - Requires at least one of `projectId` or `billingClientId`.
  - Requires unique `timeEntryIds`.
  - Creates one line item: `Recorded Digits invoice <externalReference>`.
  - Links selected entries to that line item.
- `POST /invoices/record/upload`
  - Same as record, plus uploaded PDF/file attribution.
  - If scoped only to `billingClientId`, the file can be attributed to the billing client.
- `GET /invoices`
  - Supports `page`, `limit`, `projectId`, `billingClientId`, and `status`.
  - Includes line items, uploaded file, project, and billing client.
- `GET /invoices/stats`
  - Aggregate invoice stats.
- `GET /invoices/:id`
  - Admin detail with project and billing-client names.
- `GET /invoices/:id/pdf`
  - Streams generated/uploaded invoice PDF.
- `PUT /invoices/:id`
  - Updates status, due date, notes, and optionally replaces line items.
  - Enforces status transitions: `draft -> sent`, `sent -> paid|overdue|cancelled`, `overdue -> paid|cancelled`.
  - Notifies clients only on transition to `sent`.
- `DELETE /invoices/:id`
  - Existing delete route; use carefully because billed-time linkage semantics should be reviewed before any destructive invoice workflow extension.
- `GET /invoices/export`
  - CSV export path.

Client/user routes:

- `GET /invoices/mine`
  - Returns assigned project invoices only.
  - Excludes `draft` and `cancelled`.
- `GET /invoices/mine/:id`
  - Requires the current user to be assigned to the invoice project.
- `GET /invoices/mine/:id/pdf`
  - Same assignment guard before serving PDF.

Important current behavior: client-facing routes are project-assignment based. A client-level invoice with `billingClientId` and `projectId: null` is not currently visible/payable in the client portal.

#### Time entries and invoice generation: `apps/api/src/time-entries/*`

Controller base: `time-entries`.

Billing-relevant routes:

- `GET /time-entries`
  - Supports `projectId`, `billingClientId`, `userId`, `from`, `to`, `billable`, `invoiced`, pagination.
  - `billingClientId` filters through `project.billingClientId`.
  - Admin/owner can see rates; member-facing responses strip `hourlyRateCents`.
- `GET /time-entries/report`
  - Aggregates at the database by project/user/task/billable/rate.
  - Supports `invoiced=true` and `invoiced=false` without breaking the finished-entry filter.
  - Returns totals plus `byProject`, `byUser`, and `byTask`.
  - Hides monetary values from roles that cannot see rates.
- `GET /time-entries/report/export`
  - CSV export with the same filters.
- `POST /time-entries/start`, `POST /time-entries/stop`, `POST /time-entries`, `PATCH /time-entries/:id`, `DELETE /time-entries/:id`
  - Normal time-tracking lifecycle; billed entries are locked from edits/deletes where enforced.
- `GET /time-entries/pending-captures`
  - Lists unresolved task-done captures.
- `POST /time-entries/pending-captures/:id/resolve`
  - Converts a pending capture into a billable/non-billable time entry.
- `POST /time-entries/generate-invoice`
  - Requires exactly one of `projectId` or `billingClientId`.
  - Filters eligible entries to `invoiceLineItemId: null`, finished entries only (`endedAt` and `durationSec` set), date range if supplied, and billable-only unless `includeNonBillable` is true.
  - Backfills missing rates before invoicing.
  - Rejects if any included entry still has no positive rate.
  - Creates a draft invoice with `projectId` or `billingClientId` persisted.
  - Creates line items either per entry or merged by hourly rate, then writes `timeEntry.invoiceLineItemId`.

Task completion capture is wired from both user task updates and agent task updates. If a running timer exists for the org/project, completion is appended as a `TimeEntryLog`; otherwise a `PendingTimeCapture` is created for later resolution.

#### Platform subscription billing: `apps/api/src/billing/*`

Controller base: `billing`.

This is **not client invoicing**. It manages Pexlo Portal SaaS plans/subscriptions for the organization itself.

- `GET /billing/plans`
  - Public plan list plus lifetime-seat remaining count.
- `GET /billing/subscription`
  - Owner/admin current subscription and usage.
- `POST /billing/checkout`
  - Stripe checkout for an organization subscription plan.
- `POST /billing/portal`
  - Stripe customer portal session.
- `POST /billing/webhook`
  - Platform Stripe webhook for subscription lifecycle events.

Keep this separate from `invoices` and `payments`: `/billing` is “Pexlo charges the org,” while `/invoices` + `/payments` is “the org invoices/pays its clients.”

#### Client invoice payments: `apps/api/src/payments/*`

Controller base: `payments`.

- `GET /payments/status`, `GET /payments/available-methods`, `GET /payments/enabled`
  - Payment configuration and capability surfaces.
- `POST /payments/direct/save-key`, `POST /payments/direct/remove-key`
  - Direct Stripe key mode.
- `POST /payments/payment-methods`
  - Configures supported payment methods.
- `POST /payments/connect/authorize`, `GET /payments/connect/callback`, `POST /payments/connect/disconnect`
  - Stripe Connect onboarding/disconnect.
- `POST /payments/checkout/:invoiceId`
  - Creates or reuses a Stripe Checkout session for a sent/overdue invoice.
  - Requires the requesting client user to be assigned to the invoice project.
  - Rejects invoices with no associated project.
- `POST /payments/webhook`, `POST /payments/webhook/:orgId`
  - Connect/direct webhooks.
  - `checkout.session.completed` marks invoice `paid`, sets `paidAt`, `paidAmount`, `stripePaymentIntentId`, and sends paid notifications.
  - `checkout.session.expired` clears the stored checkout session id.
  - Connect deauthorization clears payment settings and notifies.

### Frontend surfaces

#### Owner/admin billing page: `apps/web/src/app/(dashboard)/dashboard/billing/page.tsx`

Route: `/dashboard/billing`.

Current behavior:

- Loads all billing clients from `GET /billing-clients`.
- Lets owner/admin select a billing client and date range.
- Fetches two reports for the selected client/date range:
  - not invoiced: `GET /time-entries/report?billingClientId=...&invoiced=false`
  - invoiced: `GET /time-entries/report?billingClientId=...&invoiced=true`
- Shows value/hour summary cards and project rollups merged from the two reports.
- Generates draft invoices with `POST /time-entries/generate-invoice` using `billingClientId`.
- Records external Digits invoices via `POST /invoices/record` or `POST /invoices/record/upload`, selecting billable unbilled entries from `GET /time-entries?billingClientId=...&invoiced=false&billable=true`.
- Warns when selectable entries are truncated by pagination.
- Refreshes reports and invoice list after draft generation or external invoice recording.

There is no billing-client create/edit UI on this page yet; it consumes existing billing clients.

#### Billing invoice list/detail: `apps/web/src/app/(dashboard)/dashboard/billing/billing-invoices-section.tsx`

Embedded on `/dashboard/billing`.

Current behavior:

- Defaults to status `draft`.
- Loads invoices from `GET /invoices` with status filter.
- Filters by selected billing client client-side.
- Shows invoice number, client/project, status, amount, created/due dates, and PDF link.
- Opens an inline detail modal with line items and PDF link.
- Exposes allowed status actions based on current status:
  - draft → mark sent
  - sent → mark paid, overdue, cancelled
  - overdue → mark paid, cancelled
- Calls `PUT /invoices/:id` for status actions.

#### Client portal invoices tab: `apps/web/src/app/(portal)/portal/projects/[id]/components/portal-invoices-section.tsx`

Shown inside the client project portal.

Current behavior:

- Calls `GET /invoices/mine?projectId=<projectId>`.
- Shows non-draft, non-cancelled invoices for projects the client user is assigned to.
- Opens PDFs through `GET /invoices/mine/:id/pdf`.
- Can start payment checkout for visible sent/overdue project invoices if online payments are enabled.

Current limitation: because it is project-scoped, it does not show client-level invoices generated with `billingClientId` and `projectId: null`.

#### Task-done capture prompt + Time tab

Relevant frontend files include the task modal and project time tab:

- `apps/web/src/components/task-detail-modal.tsx`
- `apps/web/src/app/(dashboard)/dashboard/projects/[id]/time-tab.tsx`

Behavior:

- Marking a task done triggers server-side capture.
- If a timer is already running, the completion becomes a `TimeEntryLog`.
- If no timer is running, an unresolved `PendingTimeCapture` appears in the Time tab.
- The Time tab lets the user resolve pending captures into real time entries with duration and billable state.
- Resolved entries enter the same billing flow as manually tracked time.

### End-to-end flow

1. **Configure billing client:** create/update `BillingClient`; link one or more projects through `Project.billingClientId`.
2. **Capture time:** timers, manual entries, or task-done pending captures create `TimeEntry` rows with `billable`, `durationSec`, and `hourlyRateCents` where resolvable.
3. **Review unbilled work:** `/dashboard/billing` fetches not-invoiced reports by `billingClientId`, date range, and `invoiceLineItemId: null`.
4. **Generate a Pexlo draft:** `POST /time-entries/generate-invoice` creates a draft `Invoice`, line items, and writes `invoiceLineItemId` to each included entry.
5. **Or record a Digits invoice:** `POST /invoices/record` / `record/upload` creates an external/uploaded invoice and links selected entries to one line item.
6. **Invoice appears in owner/admin list:** `/dashboard/billing` shows draft/sent/paid/overdue/cancelled invoices and detail/PDF/status actions.
7. **Mark sent:** `PUT /invoices/:id` transitions `draft -> sent` and triggers invoice-sent notifications where the invoice is project-scoped.
8. **Client portal:** assigned client users can see project-scoped sent/paid/overdue invoices; drafts and cancelled invoices are hidden.
9. **Optional Stripe payment:** for visible project-scoped sent/overdue invoices, `/payments/checkout/:invoiceId` creates Stripe Checkout, and webhooks mark the invoice paid.

## How to Extend

### Add billing-client management UI

Use the existing `billing-clients` API. Preserve soft-archive semantics; do not hard-delete clients because invoices/projects may retain historical links.

Recommended UI rules:

- Show active clients by default; add an archived toggle.
- Treat `defaultHourlyRateCents` as future-default only. Do not rewrite historical `TimeEntry.hourlyRateCents` unless a user explicitly requests a controlled backfill.
- Surface `billingNotes`, `billingPeriod`, and `externalReference` as optional metadata, not required invoice math inputs.

### Move invoice filtering server-side in the dashboard

`GET /invoices` now accepts `billingClientId` and returns nested `billingClient`. The current invoice list UI still fetches by status and filters by billing client in the browser. A small follow-up can pass `billingClientId` in the request to reduce payload and align with the post-#46 API.

### Make client-level invoices client-visible/payable

This is the biggest functional extension.

Current blockers:

- `GET /invoices/mine` only checks `ProjectClient` assignments and filters by `projectId`.
- `GET /invoices/mine/:id` rejects invoices with no `projectId`.
- `POST /payments/checkout/:invoiceId` rejects invoices with no `projectId`.
- Notifications on `draft -> sent` are project-based.

Safe extension path:

1. Define the access model: should any user assigned to any project under a billing client see all client-level invoices, or should there be an explicit `BillingClientContact`/membership table?
2. Add API tests for client-level visibility before changing the controller/service.
3. Update `findMine`, `findOneMine`, PDF access, and payment checkout together so visibility and payment authorization match.
4. Update the portal Invoices tab copy to distinguish project invoices from billing-client invoices.

### Add a dedicated copy-friendly Digits viewer

The original plan included `/dashboard/billing/invoices/[id]`. The shipped system uses an embedded invoice detail modal. A dedicated page can still be valuable for:

- day-grouped plaintext copy blocks,
- per-line copy buttons,
- “copy all for Digits” formatting,
- larger PDF/line item review,
- safer sent/cancelled workflows.

Build it on `GET /invoices/:id`; do not create a new invoice source of truth.

### Tighten destructive invoice workflows

Before changing delete/revert behavior, map the bidirectional link:

- invoice → line items
- line item → time entries through `invoiceLineItemId`
- invoice status and client notifications
- external Digits reference and uploaded PDFs

Any “revert draft” feature should atomically clear affected time entries, delete or cancel the draft, and refuse to act once an invoice is sent/paid/overdue/cancelled.

### Keep `/billing` and `/payments` separate

Do not mix platform subscription billing with client invoice payment code:

- `/billing/*` = Pexlo Portal subscription plans and Stripe customer portal for the organization.
- `/payments/*` = the organization collecting payment from its clients for `Invoice` rows.

### Add coverage before changing money paths

Current money-sensitive test files:

- `apps/api/src/billing-clients/billing-clients.service.spec.ts`
- `apps/api/src/time-entries/time-entries.service.spec.ts`
- `apps/api/src/time-entries/time-entries.dto.spec.ts`
- `apps/api/src/invoices/invoices.service.spec.ts`
- `apps/api/src/invoices/invoice-pdf.service.spec.ts`
- `apps/api/src/invoices/invoice-overdue.task.spec.ts`
- `apps/api/src/billing/billing.service.spec.ts`

Any new billing mutation should have isolated test-DB coverage and must not run against production data.

## Verification

This doc was written from direct code inspection of:

- `packages/database/prisma/schema.prisma`
- `apps/api/src/billing-clients/*`
- `apps/api/src/invoices/*`
- `apps/api/src/time-entries/*`
- `apps/api/src/billing/*`
- `apps/api/src/payments/*`
- `apps/web/src/app/(dashboard)/dashboard/billing/*`
- `apps/web/src/app/(portal)/portal/projects/[id]/components/portal-invoices-section.tsx`
- project Time tab and task-detail capture surfaces

Shipped PR verification history:

- [#21 — Billing System v1 PR 1: schema + CSP backfill](https://github.com/Bizman365/PexloPortal/pull/21)
  - Added `BillingClient`, `Project.billingClientId`, migration, and guarded CSP backfill.
  - Verified prod migration row and additive schema state.
- [#22 — Billing System v1 PR 2: BillingClient API + billing-client-scoped time queries](https://github.com/Bizman365/PexloPortal/pull/22)
  - `npx prisma generate` exit 0.
  - API typecheck clean.
  - Targeted isolated tests: 38 pass / 0 fail / 113 expects across billing-client + time-entry specs.
- [#23 — Fix billing report invoiced filter](https://github.com/Bizman365/PexloPortal/pull/23)
  - API typecheck exit 0.
  - Time-entry targeted test: 33 pass / 0 fail / 110 expects.
- [#24 — Standalone billing summary UI](https://github.com/Bizman365/PexloPortal/pull/24)
  - Web typecheck exit 0.
  - `next build` exit 0.
  - Render smoke screenshots for loading, data, and zero-not-invoiced states.
- [#25 — Billing-client default rates](https://github.com/Bizman365/PexloPortal/pull/25)
  - API typecheck.
  - Isolated time-entry service tests with preflight guard.
- [#26 — Record external invoice API](https://github.com/Bizman365/PexloPortal/pull/26)
  - API typecheck exit 0.
  - Isolated invoice service tests, including Digits invoice recording and already-billed protection.
- [#27 — Billing-client invoice uploads](https://github.com/Bizman365/PexloPortal/pull/27)
  - Test-only migration gate.
  - API typecheck exit 0.
  - Invoice upload tests: 18 pass / 0 fail.
- [#28 — Record external invoice UI](https://github.com/Bizman365/PexloPortal/pull/28)
  - Web-only.
  - Web typecheck and `next build` exit 0.
  - Production-render verification screenshots for modal, reconciled total, and error state.
- [#45 — Billing dashboard invoice list](https://github.com/Bizman365/PexloPortal/pull/45)
  - Web build passed.
  - Web tests: 46 pass / 0 fail / 79 expects.
  - API targeted tests: 60 pass / 0 fail / 172 expects.
- [#46 — Fix billing client linkage for generated invoices](https://github.com/Bizman365/PexloPortal/pull/46)
  - API tests: 57 pass / 0 fail / 170 expects.
  - API build exit 0.
  - API typecheck exit 0.
  - `git diff --check` exit 0.

Current doc-only PR verification:

- No application tests were rerun because this branch changes documentation only.
- Required gate: `git diff --check` clean.
- Required scope: changed files limited to `docs/build/billing/02-billing-system.md` and `docs/build/billing/README.md`.

## Known Gaps / Deferred

- **Client-level invoices are not client-portal visible/payable yet.** Admin-generated invoices using `billingClientId` and `projectId: null` appear in the owner/admin invoice list, but `GET /invoices/mine`, PDF access, notifications, and payment checkout are project-assignment based.
- **Dashboard invoice billing-client filter is still client-side.** #46 added API `billingClientId` filtering and nested `billingClient`, but `billing-invoices-section.tsx` currently only sends `status` and then filters rows in the browser.
- **No dedicated Digits copy viewer.** The shipped UI has a detail modal and PDF link, not the original `/dashboard/billing/invoices/[id]` copy-friendly page.
- **No billing-client create/edit UI on `/dashboard/billing`.** The API supports CRUD, but the page currently consumes existing billing clients.
- **Manual mark-paid lacks payment metadata.** `PUT /invoices/:id` can set status `paid`, but only Stripe webhooks populate `paidAt`, `paidAmount`, and `stripePaymentIntentId`.
- **Invoice deletion/reversal needs a safety design.** The current routes include `DELETE /invoices/:id`, but a safe user-facing “revert draft” flow should explicitly clear or preserve `invoiceLineItemId` links in a transaction and refuse sent/paid invoices.
- **UI page-test coverage is thin.** API money paths have targeted tests; frontend confidence currently comes mostly from typecheck/build/render smoke and a small web test suite referenced in shipped PRs.
- **The existing `01-invoice-dashboard-list.md` reflects pre-#46 backend gaps.** It is still useful for the invoice-list build history, but its “no billingClientId query/nested billingClient” gap has since been closed in the API by #46. This system overview records the current state.

## References

- Linear: [PXL-21](https://linear.app/mastermind365/issue/PXL-21)
- Linear: [PXL-23](https://linear.app/mastermind365/issue/PXL-23)
- Existing invoice-list build doc: [`docs/build/billing/01-invoice-dashboard-list.md`](./01-invoice-dashboard-list.md)
- Pre-implementation plan: [`docs/build/09-billing-system-PLAN.md`](../09-billing-system-PLAN.md)
- Core schema: `packages/database/prisma/schema.prisma`
- Billing clients API: `apps/api/src/billing-clients/`
- Invoices API: `apps/api/src/invoices/`
- Time entries API: `apps/api/src/time-entries/`
- Platform subscription billing: `apps/api/src/billing/`
- Invoice payments / Stripe Connect: `apps/api/src/payments/`
- Dashboard billing UI: `apps/web/src/app/(dashboard)/dashboard/billing/`
- Client portal invoice tab: `apps/web/src/app/(portal)/portal/projects/[id]/components/portal-invoices-section.tsx`
