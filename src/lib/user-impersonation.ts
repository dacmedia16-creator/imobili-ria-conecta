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
  actorAccessToken: string;
  actorRefreshToken: string;
};

export function readOperationalImpersonation(): OperationalImpersonation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(IMPERSONATION_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as OperationalImpersonation;
    if (!value.auditId || !value.actorUserId || !value.targetUserId || !value.actorRefreshToken) return null;
    return value;
  } catch {
    return null;
  }
}

export function writeOperationalImpersonation(value: OperationalImpersonation | null) {
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(IMPERSONATION_STORAGE_KEY, JSON.stringify(value));
  else window.localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(IMPERSONATION_EVENT));
}

export function impersonationMatchesSession(value: OperationalImpersonation | null, session: Session | null) {
  return !!value && !!session && session.user.id === value.targetUserId;
}

