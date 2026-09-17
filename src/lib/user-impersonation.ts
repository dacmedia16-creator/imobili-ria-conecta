import type { Session } from "@supabase/supabase-js";

export const IMPERSONATION_STORAGE_KEY = "adm-max:operational-impersonation:v1";
export const IMPERSONATION_EVENT = "adm-max:operational-impersonation-changed";

export type OperationalImpersonation = {
  auditId: string;
  actorUserId: string;
  actorEmail: string;
  targetUserId: string;
  targetName: string;
  targetEmail: string;
  startedAt: string;
};

type LegacyOperationalImpersonation = OperationalImpersonation & {
  actorAccessToken: string;
  actorRefreshToken: string;
};

function parseState(raw: string | null): OperationalImpersonation | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OperationalImpersonation>;
    if (!value.auditId || !value.actorUserId || !value.targetUserId) return null;
    return value as OperationalImpersonation;
  } catch {
    return null;
  }
}

export function readOperationalImpersonation(): OperationalImpersonation | null {
  if (typeof window === "undefined") return null;
  return parseState(window.localStorage.getItem(IMPERSONATION_STORAGE_KEY));
}

/** Compatibility-only reader for sessions created before server-side restore. */
export function readLegacyOperationalImpersonation(): LegacyOperationalImpersonation | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(IMPERSONATION_STORAGE_KEY) || "null") as
      | Partial<LegacyOperationalImpersonation>
      | null;
    if (
      !value?.auditId ||
      !value.actorUserId ||
      !value.targetUserId ||
      !value.actorAccessToken ||
      !value.actorRefreshToken
    ) {
      return null;
    }
    return value as LegacyOperationalImpersonation;
  } catch {
    return null;
  }
}

export function writeOperationalImpersonation(value: OperationalImpersonation | null) {
  if (typeof window === "undefined") return;
  if (value) {
    // Explicit allowlist: legacy callers cannot reintroduce privileged tokens.
    window.localStorage.setItem(
      IMPERSONATION_STORAGE_KEY,
      JSON.stringify({
        auditId: value.auditId,
        actorUserId: value.actorUserId,
        actorEmail: value.actorEmail,
        targetUserId: value.targetUserId,
        targetName: value.targetName,
        targetEmail: value.targetEmail,
        startedAt: value.startedAt,
      } satisfies OperationalImpersonation),
    );
  }
  else window.localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(IMPERSONATION_EVENT));
}

export function impersonationMatchesSession(
  value: OperationalImpersonation | null,
  session: Session | null,
) {
  return !!value && !!session && session.user.id === value.targetUserId;
}
