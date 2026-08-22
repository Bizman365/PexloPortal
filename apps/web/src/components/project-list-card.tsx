import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ProjectProgress } from "./project-progress";

export type ProjectListCardProject = {
  id: string;
  name: string;
  status: string;
  description?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  lastUpdatedAt?: string | Date;
  taskCount?: number;
  completedTaskCount?: number;
  completionPercent?: number;
};

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(date?: string | Date | null) {
  if (!date) return "—";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

export function ProjectListCard({ project }: { project: ProjectListCardProject }) {
  const taskCount = project.taskCount ?? 0;
  const completedTaskCount = project.completedTaskCount ?? 0;
  const completionPercent = project.completionPercent ?? 0;
  const timestamp = project.lastUpdatedAt ?? project.updatedAt ?? project.createdAt;

  return (
    <Link
      href={`/portal/projects/${project.id}`}
      className="group block rounded-3xl border border-pexlo-hairline bg-pexlo-panel p-5 shadow-[0_20px_60px_rgba(26,22,18,0.06)] transition duration-200 hover:-translate-y-0.5 hover:border-pexlo-terracotta-subtle hover:shadow-[0_24px_70px_rgba(200,90,56,0.12)] focus:outline-none focus:ring-2 focus:ring-pexlo-terracotta focus:ring-offset-2 focus:ring-offset-pexlo-paper"
    >
      <article className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(220px,280px)] md:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-pexlo-terracotta-subtle px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-pexlo-terracotta-deep">
              {statusLabel(project.status)}
            </span>
            <span className="text-sm text-pexlo-ink-soft">
              Last updated {formatDate(timestamp)}
            </span>
          </div>

          <div className="mt-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-serif text-3xl leading-[1.02] tracking-[-0.04em] text-pexlo-ink sm:text-4xl">
                {project.name}
              </h2>
              {project.description ? (
                <p className="mt-4 max-w-2xl text-base leading-7 text-pexlo-ink-soft">
                  {project.description}
                </p>
              ) : null}
            </div>
            <span className="mt-1 hidden rounded-full border border-pexlo-hairline p-2 text-pexlo-terracotta transition group-hover:border-pexlo-terracotta-subtle group-hover:bg-pexlo-terracotta group-hover:text-pexlo-on-terracotta sm:inline-flex">
              <ArrowUpRight size={17} aria-hidden="true" />
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-pexlo-hairline-soft bg-pexlo-paper p-4">
          <ProjectProgress
            completed={completedTaskCount}
            total={taskCount}
            percent={completionPercent}
          />
        </div>
      </article>
    </Link>
  );
}

export function ProjectListCardSkeleton() {
  return (
    <div className="animate-pulse rounded-3xl border border-pexlo-hairline bg-pexlo-panel p-5 shadow-[0_20px_60px_rgba(26,22,18,0.06)]">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(220px,280px)] md:items-center">
        <div>
          <div className="flex gap-3">
            <div className="h-7 w-28 rounded-full bg-pexlo-hairline-soft" />
            <div className="h-5 w-40 rounded bg-pexlo-hairline-soft" />
          </div>
          <div className="mt-6 h-10 w-3/4 rounded bg-pexlo-hairline-soft" />
          <div className="mt-4 h-4 w-full max-w-xl rounded bg-pexlo-hairline-soft" />
          <div className="mt-2 h-4 w-2/3 rounded bg-pexlo-hairline-soft" />
        </div>
        <div className="rounded-2xl border border-pexlo-hairline-soft bg-pexlo-paper p-4">
          <div className="flex items-end justify-between">
            <div className="h-4 w-24 rounded bg-pexlo-hairline-soft" />
            <div className="h-8 w-14 rounded bg-pexlo-hairline-soft" />
          </div>
          <div className="mt-3 h-2 rounded-full bg-pexlo-hairline-soft" />
          <div className="mt-3 h-4 w-20 rounded bg-pexlo-hairline-soft" />
        </div>
      </div>
    </div>
  );
}
