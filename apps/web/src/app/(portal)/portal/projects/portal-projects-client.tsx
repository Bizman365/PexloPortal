"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch, type PaginatedResponse } from "@/lib/api";
import { useDebounce } from "@/hooks/use-debounce";
import { Pagination } from "@/components/pagination";
import {
  ProjectListCard,
  ProjectListCardSkeleton,
  type ProjectListCardProject,
} from "@/components/project-list-card";
import { Search, FolderOpen, AlertCircle } from "lucide-react";

type Project = ProjectListCardProject;

export function PortalProjectsClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalProjects, setTotalProjects] = useState(0);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await apiFetch<PaginatedResponse<Project>>(
        `/projects/mine?${params}`,
      );
      setProjects(res.data);
      setTotalPages(res.meta.totalPages || 1);
      setTotalProjects(res.meta.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  return (
    <div className="space-y-8 text-pexlo-ink">
      <section className="rounded-[2rem] border border-pexlo-hairline bg-pexlo-panel px-6 py-8 shadow-[0_24px_80px_rgba(26,22,18,0.06)] sm:px-8 sm:py-10">
        <div className="max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-pexlo-terracotta-deep">
            Client home
          </p>
          <h1 className="mt-4 font-serif text-5xl leading-[0.98] tracking-[-0.05em] text-pexlo-ink sm:text-6xl">
            Your projects, at a glance.
          </h1>
          <p className="mt-5 text-base leading-7 text-pexlo-ink-soft sm:text-lg">
            Track active work, completion, and the latest project movement from one read-only client surface.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-4 border-t border-pexlo-hairline pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-serif text-3xl tracking-[-0.04em] text-pexlo-ink">
              {totalProjects}
            </p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-pexlo-ink-soft">
              Visible projects
            </p>
          </div>
          <div className="relative w-full sm:max-w-sm">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-pexlo-ink-soft"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects..."
              maxLength={200}
              className="w-full rounded-full border border-pexlo-hairline bg-pexlo-paper py-3 pl-10 pr-4 text-sm text-pexlo-ink outline-none transition placeholder:text-pexlo-ink-soft focus:border-pexlo-terracotta focus:ring-2 focus:ring-pexlo-terracotta-subtle"
            />
          </div>
        </div>
      </section>

      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">We could not load your projects.</p>
            <p className="mt-1">{error}</p>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <ProjectListCardSkeleton />
          <ProjectListCardSkeleton />
          <ProjectListCardSkeleton />
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {projects.map((project) => (
              <ProjectListCard key={project.id} project={project} />
            ))}
            {projects.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-pexlo-hairline bg-pexlo-panel py-16 text-center">
                <FolderOpen size={42} className="mx-auto text-pexlo-ink-soft" aria-hidden="true" />
                <h2 className="mt-5 font-serif text-3xl tracking-[-0.04em] text-pexlo-ink">
                  {debouncedSearch ? "No matching projects" : "No projects yet"}
                </h2>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-pexlo-ink-soft">
                  {debouncedSearch
                    ? "Try a different search term to find a project in your client workspace."
                    : "When Pexlo shares a project with you, it will appear here with progress and recent activity."}
                </p>
              </div>
            ) : null}
          </div>
          <div className="pt-2">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  );
}
