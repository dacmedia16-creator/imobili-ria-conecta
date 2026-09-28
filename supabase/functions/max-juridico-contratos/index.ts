import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleJuridicoRequest } from "./core.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-max-juridico-token, x-request-id",
  "Content-Type": "application/json",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

function getPresentedToken(req: Request): string {
  const direct = req.headers.get("x-max-juridico-token");
  if (direct) return direct.trim();
  const authorization = req.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return response({ error: "method_not_allowed" }, 405);

  const expectedToken = Deno.env.get("MAX_JURIDICO_API_TOKEN") ?? "";
  const presentedToken = getPresentedToken(req);
  if (expectedToken.length < 32 || !constantTimeEqual(presentedToken, expectedToken)) {
    return response({ error: "unauthorized" }, 401);
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  // Multiempresa: o token do agente vale para uma única agência (falha fechada sem ela).
  const organizationId = Deno.env.get("MAX_JURIDICO_ORGANIZATION_ID") ?? "";
  if (!url || !serviceRoleKey || !organizationId)
    return response({ error: "function_not_configured" }, 503);

  const body = await req.json().catch(() => ({}));
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await handleJuridicoRequest(
    admin,
    organizationId,
    body,
    req.headers.get("x-request-id"),
  );
  return response(result.body, result.status);
});
