"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch, type PaginatedResponse } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { Pagination } from "@/components/pagination";
import { Trash2, EyeOff } from "lucide-react";

interface NoteRecord {
  id: string;
  content: string;
  author: { id: string; name: string };
  createdAt: string;
}

export function NotesSection({
  projectId,
  isArchived,
}: {
  projectId: string;
  isArchived: boolean;
}) {
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [newContent, setNewContent] = useState("");

  const loadNotes = useCallback(() => {
    apiFetch<PaginatedResponse<NoteRecord>>(
      `/notes/project/${projectId}?page=${page}&limit=10`,
    )
      .then((res) => {
        setNotes(res.data);
        setTotalPages(res.meta.totalPages);
      })
      .catch(console.error);
  }, [projectId, page]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const handleAdd = async () => {
    if (!newContent.trim()) return;
    try {
      await apiFetch(`/notes?projectId=${projectId}`, {
        method: "POST",
        body: JSON.stringify({ content: newContent }),
      });
      setNewContent("");
      loadNotes();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to add note");
    }
  };

  const handleDelete = async (noteId: string) => {
    const ok = await confirm({
      title: "Delete Note",
      message: "Delete this note? This cannot be undone.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/notes/${noteId}`, { method: "DELETE" });
      loadNotes();
      success("Note deleted");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to delete note");
    }
  };

  return (
    <div>
      <p className="text-xs text-[var(--muted-foreground)] flex items-center gap-1.5 mb-4">
        <EyeOff size={12} />
        Team only — not visible to clients
      </p>

      {!isArchived && (
        <div className="mb-4 space-y-2">
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Write an internal note..."
            rows={3}
            className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm resize-none outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
          <button
            onClick={handleAdd}
            disabled={!newContent.trim()}
            className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
          >
            Add Note
          </button>
        </div>
      )}

      <div className="space-y-3">
        {notes.map((note) => (
          <div
            key={note.id}
            className="border border-[var(--border)] rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{note.author.name}</span>
                <span className="text-xs text-[var(--muted-foreground)]">
                  {formatRelativeTime(note.createdAt)}
                </span>
              </div>
              {!isArchived && (
                <button
                  onClick={() => handleDelete(note.id)}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:underline"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              )}
            </div>
            <p className="text-sm whitespace-pre-wrap">{note.content}</p>
          </div>
        ))}
        {notes.length === 0 && (
          <div className="text-center py-8">
            <EyeOff size={32} className="mx-auto text-[var(--muted-foreground)] mb-2" />
            <p className="text-sm text-[var(--muted-foreground)]">
              No internal notes yet.
            </p>
          </div>
        )}
      </div>
      <div className="mt-3">
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </div>
  );
}
