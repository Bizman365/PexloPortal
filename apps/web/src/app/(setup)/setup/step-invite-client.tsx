"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { UserPlus, Copy, Check } from "lucide-react";

interface StepInviteClientProps {
  onNext: () => void;
  onBack: () => void;
}

export function StepInviteClient({ onNext, onBack }: StepInviteClientProps) {
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [invited, setInvited] = useState(false);

  const handleInvite = async () => {
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const invitation = await apiFetch<{ inviteLink?: string }>(
        "/clients/invitations",
        {
          method: "POST",
          body: JSON.stringify({ email: email.trim(), role: "member" }),
        },
      );
      setInvited(true);
      if (invitation.inviteLink) {
        setInviteLink(invitation.inviteLink);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send invitation",
      );
    } finally {
      setSaving(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Invite a Client</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Send an invitation to your first client. They will get access to the
          client portal where they can view project progress and download files.
        </p>
      </div>

      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">
          {error}
        </div>
      )}

      {!invited ? (
        <div className="p-6 border border-[var(--border)] rounded-lg space-y-4">
          <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
            <UserPlus size={18} />
            <span className="text-sm font-medium">Client Invitation</span>
          </div>

          <div className="space-y-2">
            <label htmlFor="setup-client-email" className="text-sm font-medium">
              Client Email
            </label>
            <input
              id="setup-client-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@example.com"
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>

          <button
            onClick={handleInvite}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <UserPlus size={16} />
            {saving ? "Sending..." : "Send Invitation"}
          </button>
        </div>
      ) : (
        <div className="p-6 border border-green-200 bg-green-50/50 rounded-lg space-y-4">
          <div className="flex items-center gap-2 text-green-700">
            <Check size={18} />
            <span className="text-sm font-medium">
              Invitation sent to {email}
            </span>
          </div>

          {inviteLink && (
            <div className="space-y-2">
              <p className="text-sm text-[var(--muted-foreground)]">
                Share this invite link with your client:
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={inviteLink}
                  className="flex-1 px-2 py-1 text-sm bg-white border border-green-300 rounded font-mono"
                />
                <button
                  onClick={copyLink}
                  className="flex items-center gap-1 px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors"
        >
          Back
        </button>
        <div className="flex gap-3">
          {!invited && (
            <button
              onClick={onNext}
              className="px-6 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              Skip
            </button>
          )}
          <button
            onClick={onNext}
            className="px-6 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
