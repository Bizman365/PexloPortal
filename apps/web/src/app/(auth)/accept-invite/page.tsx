"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

interface PublicInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  organizationName: string;
}

function InvalidInvitation() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        <h1 className="text-2xl font-bold mb-2">Invalid Invitation</h1>
        <p className="text-[var(--muted-foreground)]">
          This invitation link is missing or invalid.
        </p>
      </div>
    </div>
  );
}

function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const invitationId = searchParams.get("id");
  const [invitation, setInvitation] = useState<PublicInvitation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(invitationId));

  useEffect(() => {
    if (!invitationId) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    apiFetch<PublicInvitation>(`/clients/invitations/${invitationId}/public`)
      .then((data) => {
        if (!cancelled) setInvitation(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "This invitation link is missing or invalid.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [invitationId]);

  const signInHref = useMemo(() => {
    if (!invitation) return "#";
    const callbackUrl = `/accept-invite/complete?id=${encodeURIComponent(
      invitation.id,
    )}`;
    const params = new URLSearchParams({
      callbackUrl,
      loginHint: invitation.email,
    });
    return `/portal/sign-in?${params.toString()}`;
  }, [invitation]);

  if (!invitationId) return <InvalidInvitation />;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center space-y-3">
          <div className="mx-auto h-8 w-8 rounded-full border-2 border-[var(--border)] border-t-[var(--primary)] animate-spin" />
          <p className="text-sm text-[var(--muted-foreground)]">
            Loading invitation...
          </p>
        </div>
      </div>
    );
  }

  if (error || !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center space-y-3">
          <h1 className="text-2xl font-bold">Invalid Invitation</h1>
          <p className="text-[var(--muted-foreground)]">
            {error || "This invitation link is missing or invalid."}
          </p>
        </div>
      </div>
    );
  }

  if (invitation.status !== "pending") {
    const copy =
      invitation.status === "accepted"
        ? "This invitation has already been accepted. Sign in to continue."
        : "This invitation is no longer active. Ask your organization admin for a new invite.";

    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <h1 className="text-2xl font-bold">Invitation {invitation.status}</h1>
          <p className="text-[var(--muted-foreground)]">{copy}</p>
          <Link
            href="/portal/sign-in"
            className="inline-flex justify-center rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--background)] p-6 shadow-sm">
        <div className="text-center">
          <h1 className="text-2xl font-bold">
            Join {invitation.organizationName}
          </h1>
          <p className="text-[var(--muted-foreground)] mt-2">
            You were invited as {invitation.email}. Continue with WorkOS AuthKit
            to sign in or create your account securely.
          </p>
        </div>

        <div className="rounded-lg bg-[var(--muted)] p-4 text-sm space-y-1">
          <div className="flex justify-between gap-4">
            <span className="text-[var(--muted-foreground)]">Organization</span>
            <span className="font-medium text-right">
              {invitation.organizationName}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-[var(--muted-foreground)]">Email</span>
            <span className="font-medium text-right">{invitation.email}</span>
          </div>
        </div>

        <Link
          href={signInHref}
          className="block w-full rounded-lg bg-[var(--primary)] px-4 py-3 text-center font-medium text-white hover:opacity-90"
        >
          Continue with WorkOS
        </Link>

        <p className="text-center text-xs text-[var(--muted-foreground)]">
          Sessions are created only by WorkOS. After authentication we’ll add
          you to the invited organization and send you to the portal.
        </p>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<InvalidInvitation />}>
      <AcceptInviteContent />
    </Suspense>
  );
}
