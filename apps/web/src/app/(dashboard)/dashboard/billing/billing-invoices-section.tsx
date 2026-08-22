"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Loader2, ReceiptText, RefreshCw, X } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { useToast } from "@/components/toast";
import { apiFetch, fetchAllPages } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

interface BillingClient {
  id: string;
  name: string;
  archivedAt: string | null;
}

interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

interface InvoiceProject {
  id: string;
  name: string;
}

interface InvoiceUploadedFile {
  id: string;
  filename: string;
  sizeBytes?: number;
}

interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  type: string;
  amount?: number | null;
  dueDate?: string | null;
  notes?: string | null;
  uploadedFileId?: string | null;
  uploadedFile?: InvoiceUploadedFile | null;
  projectId?: string | null;
  project?: InvoiceProject | null;
  externalReference?: string | null;
  billingClientId?: string | null;
  lineItems: InvoiceLineItem[];
  createdAt: string;
  paidAt?: string | null;
  paidAmount?: number | null;
}

type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled" | string;

const PAGE_SIZE = 10;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "cancelled", label: "Cancelled" },
] as const;

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/60 dark:text-slate-200 dark:border-slate-700",
  sent: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-200 dark:border-blue-900",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900",
  overdue: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-200 dark:border-red-900",
  cancelled: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-900/60 dark:text-zinc-300 dark:border-zinc-700",
};

const STATUS_TRANSITIONS: Record<string, { status: InvoiceStatus; label: string }[]> = {
  draft: [{ status: "sent", label: "Mark sent" }],
  sent: [
    { status: "paid", label: "Mark paid" },
    { status: "overdue", label: "Mark overdue" },
    { status: "cancelled", label: "Cancel" },
  ],
  overdue: [
    { status: "paid", label: "Mark paid" },
    { status: "cancelled", label: "Cancel" },
  ],
};

function invoiceAmountCents(invoice: Pick<InvoiceListItem, "amount" | "lineItems">): number {
  if (invoice.amount != null) return invoice.amount;
  return invoice.lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]"
      }`}
    >
      {statusLabel(status)}
    </span>
  );
}

function pdfHref(invoiceId: string): string {
  return `${process.env.NEXT_PUBLIC_API_URL || ""}/api/invoices/${invoiceId}/pdf`;
}

export function BillingInvoicesSection({
  clients,
  refreshKey,
}: {
  clients: BillingClient[];
  refreshKey: number;
}) {
  const { success, error: showError } = useToast();
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("draft");
  const [clientFilter, setClientFilter] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvoiceListItem | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<boolean>(false);

  const clientsById = useMemo(() => {
    return new Map(clients.map((client) => [client.id, client.name]));
  }, [clients]);

  const activeClients = useMemo(
    () => clients.filter((client) => client.archivedAt === null),
    [clients],
  );

  const loadInvoices = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const basePath = params.size ? `/invoices?${params.toString()}` : "/invoices";
      const rows = await fetchAllPages<InvoiceListItem>(basePath);
      const filteredRows = clientFilter
        ? rows.filter((invoice) => invoice.billingClientId === clientFilter)
        : rows;
      setInvoices(filteredRows);
      setPage((current) => {
        const nextTotalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
        return Math.min(current, nextTotalPages);
      });
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Failed to load invoices";
      setLoadError(message);
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  }, [clientFilter, statusFilter]);

  const loadDetail = useCallback(async (invoiceId: string): Promise<void> => {
    setDetailId(invoiceId);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const invoice = await apiFetch<InvoiceListItem>(`/invoices/${invoiceId}`);
      setDetail(invoice);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Failed to load invoice";
      setDetailError(message);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices, refreshKey]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, clientFilter]);

  const totalPages = Math.max(1, Math.ceil(invoices.length / PAGE_SIZE));
  const visibleInvoices = invoices.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const getPartyName = useCallback(
    (invoice: InvoiceListItem): string => {
      if (invoice.project?.name) return invoice.project.name;
      if (invoice.billingClientId) return clientsById.get(invoice.billingClientId) ?? "Billing client";
      return "Client-level invoice";
    },
    [clientsById],
  );

  async function handleStatusChange(invoice: InvoiceListItem, nextStatus: InvoiceStatus): Promise<void> {
    setUpdatingStatus(true);
    try {
      const updated = await apiFetch<InvoiceListItem>(`/invoices/${invoice.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: nextStatus }),
      });
      setDetail((current) => (current?.id === invoice.id ? { ...current, ...updated } : current));
      await loadInvoices();
      success(`Invoice marked ${nextStatus}`);
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to update invoice status");
    } finally {
      setUpdatingStatus(false);
    }
  }

  function closeDetail(): void {
    setDetailId(null);
    setDetail(null);
    setDetailError(null);
  }

  const selectedDetail = detailId ? detail : null;
  const detailActions = selectedDetail ? STATUS_TRANSITIONS[selectedDetail.status] ?? [] : [];

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--background)]">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <ReceiptText size={16} /> Invoice drafts & history
          </div>
          <h2 className="mt-1 font-semibold">Invoices</h2>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            Generated drafts, recorded external invoices, sent invoices, and payment statuses for this organization.
          </p>
        </div>
        <button
          type="button"
          onClick={loadInvoices}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={15} className={loading ? "animate-spin" : undefined} />
          Refresh
        </button>
      </div>

      <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
              Status
            </span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--primary)] sm:w-40"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-[var(--muted-foreground)]">
              Billing client
            </span>
            <select
              value={clientFilter}
              onChange={(event) => setClientFilter(event.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[var(--primary)] sm:w-64"
            >
              <option value="">All billing clients</option>
              {activeClients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="text-xs text-[var(--muted-foreground)]">
          {loading ? "Loading…" : `${invoices.length} invoice${invoices.length === 1 ? "" : "s"}`}
        </div>
      </div>

      {loadError && (
        <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
          <div>{loadError}</div>
          <button
            type="button"
            onClick={loadInvoices}
            className="mt-2 rounded-md border border-current px-2 py-1 text-xs font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-sm text-[var(--muted-foreground)]">
          <Loader2 className="mx-auto mb-3 animate-spin" size={20} />
          Loading invoices…
        </div>
      ) : visibleInvoices.length === 0 ? (
        <div className="p-8 text-center">
          <h3 className="font-semibold">No invoices found</h3>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            {statusFilter === "draft"
              ? "Generated drafts will appear here as soon as they are created."
              : "Try changing the filters to see more invoices."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  <th className="px-4 py-3 font-medium">Invoice</th>
                  <th className="px-4 py-3 font-medium">Client / project</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium">PDF</th>
                </tr>
              </thead>
              <tbody>
                {visibleInvoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    onClick={() => loadDetail(invoice.id)}
                    className="cursor-pointer border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/35"
                  >
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          loadDetail(invoice.id);
                        }}
                        className="font-medium text-[var(--primary)] hover:underline"
                      >
                        {invoice.invoiceNumber}
                      </button>
                      <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                        {invoice.type}
                        {invoice.externalReference ? ` • ${invoice.externalReference}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{getPartyName(invoice)}</div>
                      {!invoice.project?.name && !invoice.billingClientId && (
                        <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                          No linked client on invoice record
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={invoice.status} /></td>
                    <td className="px-4 py-3 font-medium">{formatCurrency(invoiceAmountCents(invoice))}</td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">{formatDate(invoice.createdAt)}</td>
                    <td className="px-4 py-3 text-[var(--muted-foreground)]">{formatDate(invoice.dueDate)}</td>
                    <td className="px-4 py-3">
                      <a
                        href={pdfHref(invoice.id)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-medium hover:bg-[var(--muted)]"
                      >
                        <Download size={13} /> PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[var(--border)] px-4 py-3">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </>
      )}

      {detailId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)] shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                  <ReceiptText size={16} /> Invoice detail
                </div>
                <h3 className="mt-1 text-xl font-semibold">
                  {selectedDetail?.invoiceNumber ?? "Loading invoice…"}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeDetail}
                className="rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                aria-label="Close invoice detail"
              >
                <X size={18} />
              </button>
            </div>

            {detailLoading ? (
              <div className="p-8 text-center text-sm text-[var(--muted-foreground)]">
                <Loader2 className="mx-auto mb-3 animate-spin" size={20} />
                Loading invoice…
              </div>
            ) : detailError ? (
              <div className="m-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">
                {detailError}
              </div>
            ) : selectedDetail ? (
              <div className="max-h-[calc(90vh-5rem)] overflow-y-auto p-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-[var(--border)] p-3">
                    <div className="text-xs text-[var(--muted-foreground)]">Status</div>
                    <div className="mt-1"><StatusBadge status={selectedDetail.status} /></div>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] p-3">
                    <div className="text-xs text-[var(--muted-foreground)]">Amount</div>
                    <div className="mt-1 font-semibold">{formatCurrency(invoiceAmountCents(selectedDetail))}</div>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] p-3">
                    <div className="text-xs text-[var(--muted-foreground)]">Created</div>
                    <div className="mt-1 font-semibold">{formatDate(selectedDetail.createdAt)}</div>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] p-3">
                    <div className="text-xs text-[var(--muted-foreground)]">Due</div>
                    <div className="mt-1 font-semibold">{formatDate(selectedDetail.dueDate)}</div>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-[var(--border)] p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                    Client / project
                  </div>
                  <div className="mt-1 font-semibold">{getPartyName(selectedDetail)}</div>
                  {selectedDetail.externalReference && (
                    <div className="mt-1 text-sm text-[var(--muted-foreground)]">
                      External reference: {selectedDetail.externalReference}
                    </div>
                  )}
                  {selectedDetail.uploadedFile?.filename && (
                    <div className="mt-1 text-sm text-[var(--muted-foreground)]">
                      Attachment: {selectedDetail.uploadedFile.filename}
                    </div>
                  )}
                  {selectedDetail.notes && (
                    <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--muted-foreground)]">
                      {selectedDetail.notes}
                    </p>
                  )}
                </div>

                <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
                  <div className="border-b border-[var(--border)] px-4 py-3">
                    <h4 className="font-semibold">Line items</h4>
                  </div>
                  {selectedDetail.lineItems.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-[var(--muted-foreground)]">
                      This invoice has no line items returned by the API.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                            <th className="px-4 py-3 font-medium">Description</th>
                            <th className="px-4 py-3 font-medium">Qty</th>
                            <th className="px-4 py-3 font-medium">Unit</th>
                            <th className="px-4 py-3 font-medium">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedDetail.lineItems.map((item) => (
                            <tr key={item.id} className="border-b border-[var(--border)] last:border-0">
                              <td className="px-4 py-3">{item.description}</td>
                              <td className="px-4 py-3 text-[var(--muted-foreground)]">{item.quantity}</td>
                              <td className="px-4 py-3 text-[var(--muted-foreground)]">{formatCurrency(item.unitPrice)}</td>
                              <td className="px-4 py-3 font-medium">{formatCurrency(item.quantity * item.unitPrice)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <a
                    href={pdfHref(selectedDetail.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--muted)]"
                  >
                    <ExternalLink size={15} />
                    Open PDF
                  </a>

                  {detailActions.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-2">
                      {detailActions.map((action) => (
                        <button
                          key={action.status}
                          type="button"
                          onClick={() => handleStatusChange(selectedDetail, action.status)}
                          disabled={updatingStatus}
                          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {updatingStatus && <Loader2 size={15} className="animate-spin" />}
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
