"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { track } from "@/lib/track";

interface AcceptInvitationResponse {
  success: boolean;
  organizationId: string;
  organizationName: string;
  role: string;
  redirectTo?: string;
}

function AcceptInviteCompleteContent() {
  const searchParams = useSearchParams();
  const invitationId = searchParams.get("id");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!invitationId) {
      setError("This invitation link is missing or invalid.");
      return;
    }

    let cancelled = false;

    apiFetch<AcceptInvitationResponse>(
      `/clients/invitations/${invitationId}/accept`,
      { method: "POST" },
    )
      .then((data) => {
        if (cancelled) return;
        track("invite_accepted", {
          organizationId: data.organizationId,
          role: data.role,
        });
        window.location.assign(data.redirectTo || "/portal");
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to accept invitation. Please try again.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [invitationId]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <h1 className="text-2xl font-bold">Could not accept invitation</h1>
          <p className="text-[var(--muted-foreground)]">{error}</p>
          <Link
            href={
              invitationId
                ? `/accept-invite?id=${invitationId}`
                : "/accept-invite"
            }
            className="inline-flex justify-center rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Back to invitation
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center space-y-3">
        <div className="mx-auto h-8 w-8 rounded-full border-2 border-[var(--border)] border-t-[var(--primary)] animate-spin" />
        <h1 className="text-2xl font-bold">Accepting invitation...</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          We’re adding you to the invited organization.
        </p>
      </div>
    </div>
  );
}

export default function AcceptInviteCompletePage() {
  return (
    <Suspense>
      <AcceptInviteCompleteContent />
    </Suspense>
  );
}
