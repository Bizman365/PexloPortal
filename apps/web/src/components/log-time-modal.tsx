"use client";

import { useState } from "react";
import { X } from "lucide-react";

export interface PendingCapture {
  id: string;
  projectId: string;
  taskId: string | null;
  label: string;
  completedByType: string;
  completedByName: string | null;
  completedAt: string;
  project: { id: string; name: string };
  task: { id: string; title: string } | null;
}

export function ResolvePendingCaptureModal({
  capture,
  title = "Log completed task",
  description,
  cancelLabel = "Cancel",
  onCancel,
  onResolve,
}: {
  capture: PendingCapture;
  title?: string;
  description?: string;
  cancelLabel?: string;
  onCancel: () => void;
  onResolve: (durationSec: number, billable: boolean) => Promise<void>;
}): React.ReactElement {
  const [durationSec, setDurationSec] = useState<number>(1800);
  const [customMinutes, setCustomMinutes] = useState<string>("");
  const [billable, setBillable] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const chips = [
    { label: "15m", value: 15 * 60 },
    { label: "30m", value: 30 * 60 },
    { label: "1h", value: 60 * 60 },
    { label: "2h", value: 2 * 60 * 60 },
  ];

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const custom = customMinutes.trim() ? Math.round(Number(customMinutes) * 60) : null;
    const seconds = custom && custom > 0 ? custom : durationSec;
    if (!seconds || seconds < 1) return;
    setBusy(true);
    try {
      await onResolve(seconds, billable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <form onSubmit={submit} className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{title}</h3>
            <p className="text-sm text-[var(--muted-foreground)] mt-1">{description ?? capture.label}</p>
          </div>
          <button type="button" onClick={onCancel} className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div>
          <label className="block text-xs text-[var(--muted-foreground)] mb-2">Duration</label>
          <div className="flex gap-2 flex-wrap">
            {chips.map((chip) => (
              <button
                key={chip.value}
                type="button"
                onClick={() => {
                  setDurationSec(chip.value);
                  setCustomMinutes("");
                }}
                className={`rounded-full px-3 py-1.5 text-sm border transition-colors ${durationSec === chip.value && !customMinutes ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--border)] hover:bg-[var(--muted)]"}`}
              >
                {chip.label}
              </button>
            ))}
            <input
              type="number"
              min="1"
              step="1"
              value={customMinutes}
              onChange={(e) => setCustomMinutes(e.target.value)}
              placeholder="Custom min"
              className="w-32 rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={billable}
            onChange={(e) => setBillable(e.target.checked)}
            className="rounded border-[var(--border)]"
          />
          Billable
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--muted)] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Create time entry"}
          </button>
        </div>
      </form>
    </div>
  );
}
