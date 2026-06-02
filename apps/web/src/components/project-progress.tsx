export function ProjectProgress({
  completed,
  total,
  percent,
}: {
  completed: number;
  total: number;
  percent: number;
}) {
  const safeTotal = Math.max(0, total);
  const safeCompleted = Math.min(Math.max(0, completed), safeTotal);
  const safePercent = Math.min(Math.max(0, Math.round(percent)), 100);

  return (
    <div className="space-y-2" aria-label={`${safePercent}% complete`}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-pexlo-ink-soft">
          Completion
        </span>
        <span className="font-serif text-2xl leading-none tracking-[-0.04em] text-pexlo-ink">
          {safePercent}%
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-pexlo-hairline-soft"
        role="progressbar"
        aria-valuenow={safePercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-pexlo-terracotta transition-[width] duration-500"
          style={{ width: `${safePercent}%` }}
        />
      </div>
      <p className="text-sm text-pexlo-ink-soft">
        {safeCompleted} / {safeTotal} tasks
      </p>
    </div>
  );
}
