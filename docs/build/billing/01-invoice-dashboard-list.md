# Billing Invoice Dashboard List

## What

Added an organization-level invoice list/detail surface to `/dashboard/billing` so generated draft invoices are visible and actionable after creation.

## Why

The billing dashboard could generate a draft invoice from billable time, but the only confirmation was a toast containing the invoice ID. Users had no UI path to see the draft, inspect line items, open the PDF, or advance the invoice status from the billing page.

## Considered & Rejected

- **Backend changes to add invoice list fields/filters** — rejected for this pass. The invoices API already exists and the task explicitly limited scope to UI wiring.
- **Reusing the project invoice component directly** — rejected because `projects/[id]/components/invoices-section.tsx` is tightly coupled to a single project, creation/upload modals, and project archive behavior. The billing page needed an org-level list and billing-client context.
- **Only refreshing the toast after generation** — rejected because it preserves the dead-end behavior. The list now refreshes immediately after invoice generation and after recording an external invoice.

## What We Built

- `apps/web/src/app/(dashboard)/dashboard/billing/billing-invoices-section.tsx`
  - Fetches org invoices with existing `GET /invoices` via `fetchAllPages`.
  - Server-applies the existing `status` query param.
  - Client-filters by `billingClientId` where the API response includes it.
  - Shows invoice number, client/project label, status badge, amount, created date, due date, and PDF link.
  - Provides loading, empty, error, refresh, and pagination states.
  - Opens a detail modal backed by `GET /invoices/:id` with invoice metadata and line items.
  - Exposes existing status transitions through `PUT /invoices/:id`: draft → sent; sent → paid/overdue/cancelled; overdue → paid/cancelled.
- `apps/web/src/app/(dashboard)/dashboard/billing/page.tsx`
  - Imports the invoice section.
  - Adds `invoiceRefreshKey` state.
  - Refreshes the invoice list after `POST /time-entries/generate-invoice` creates a draft.
  - Refreshes the invoice list after recording an external invoice.

## How to Extend

- If the API adds `billingClientId` as a supported `GET /invoices` query param, move the billing-client filter from client-side filtering into the request params.
- If the API includes `billingClient: { id, name }` in `findAll/findOne`, prefer that over mapping names from the loaded `/billing-clients` list.
- If a richer payment endpoint is added, replace the simple `PUT status: "paid"` action with the payment-aware route so `paidAt`/`paidAmount` can be captured.
- If the org invoice list grows very large, use server-side pagination for the unfiltered case and only fall back to `fetchAllPages` when a client-side-only filter is active.

## Verification

- `bun run --filter @atrium/web build`
  - Passed.
  - `/dashboard/billing` compiled successfully; route size reported as `12.4 kB`, first-load JS `188 kB`.
- Test DB isolation before tests:
  - `TEST_DATABASE_URL` set to masked Neon test branch target `postgresql://neondb_owner:****@ep-wispy-darkness-aqghbc0b-pooler.c-8.us-east-1.aws.neon.tech/neondb?...`.
  - `DATABASE_URL` unset in the shell preflight check.
  - `DB_EQUALS_TEST=false`, `TEST_DB_SET=true`.
- `bun run --filter @atrium/web test`
  - Passed: `46 pass`, `0 fail`, `79 expect() calls`, `2 files`.
- `bun run --filter @atrium/api test src/invoices/invoices.service.spec.ts src/time-entries/time-entries.service.spec.ts src/time-entries/time-entries.dto.spec.ts`
  - Passed: `60 pass`, `0 fail`, `172 expect() calls`, `3 files`.

## Known Gaps / Deferred

- `GET /invoices` accepts `page`, `limit`, `projectId`, and `status`; it does **not** accept `billingClientId`, so billing-client filtering is currently client-side.
- `GET /invoices`/`GET /invoices/:id` include `project` but not `billingClient`; the UI maps `billingClientId` to the billing client list when possible.
- `time-entries/generate-invoice` with `billingClientId` currently creates a draft with `projectId: null` and does not persist `billingClientId` on the invoice. Those rows are shown as “Client-level invoice” with a “No linked client on invoice record” hint until the backend stores the relation.
- Status actions use the existing generic `PUT /invoices/:id` status transitions. There is no payment-specific endpoint here, so marking paid does not collect extra payment metadata.

## References

- `apps/api/src/invoices/invoices.controller.ts`
- `apps/api/src/invoices/invoices.service.ts`
- `apps/api/src/invoices/invoices.dto.ts`
- `apps/api/src/time-entries/time-entries.service.ts`
- `apps/web/src/app/(dashboard)/dashboard/projects/[id]/components/invoices-section.tsx`
