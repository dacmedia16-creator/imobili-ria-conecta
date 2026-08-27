import { createClient } from "npm:@supabase/supabase-js@2";

const encoder = new TextEncoder();
const MAX_SKEW_SECONDS = 60;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  const secret = Deno.env.get("MAX_READ_HMAC_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!secret || !supabaseUrl || !serviceKey) return json(503, { error: "service_not_configured" });

  const timestamp = request.headers.get("x-max-timestamp") ?? "";
  const nonce = request.headers.get("x-max-nonce") ?? "";
  const provided = request.headers.get("x-max-signature") ?? "";
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
    return json(401, { error: "invalid_auth_headers" });
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > MAX_SKEW_SECONDS) {
    return json(401, { error: "expired_request" });
  }

  const rawBody = await request.text();
  const expected = await sign(secret, `${timestamp}.${nonce}.${rawBody}`);
  if (!safeEqual(provided.toLowerCase(), expected)) return json(401, { error: "invalid_signature" });

  let payload: { operation?: string; query?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const operation = payload.operation ?? "";
  if (!["count_active_corretores", "find_corretor"].includes(operation)) {
    return json(400, { error: "operation_not_allowed" });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: audit, error: auditError } = await supabase
    .from("max_read_bridge_audit")
    .insert({ nonce, operation })
    .select("id")
    .single();
  if (auditError) return json(409, { error: "replayed_or_rejected" });

  try {
    if (operation === "count_active_corretores") {
      const { data: roles, error } = await supabase
        .from("user_roles")
        .select("user_id, profiles!inner(ativo)")
        .eq("role", "corretor")
        .eq("profiles.ativo", true);
      if (error) throw error;
      const count = new Set((roles ?? []).map((row: any) => row.user_id)).size;
      await supabase.from("max_read_bridge_audit").update({ success: true, result_count: count }).eq("id", audit.id);
      return json(200, { active_corretores: count, checked_at: new Date().toISOString() });
    }

    const query = (payload.query ?? "").trim();
    if (query.length < 2 || query.length > 120) return json(400, { error: "invalid_query" });
    const { data, error } = await supabase
      .from("profiles")
      .select("id,nome,ativo,created_at,updated_at,user_roles!inner(role)")
      .eq("user_roles.role", "corretor")
      .ilike("nome", `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`)
      .limit(10);
    if (error) throw error;
    const corretores = (data ?? []).map((row: any) => ({
      id: row.id,
      nome: row.nome,
      ativo: row.ativo,
      cadastrado_em: row.created_at,
      atualizado_em: row.updated_at,
    }));
    await supabase.from("max_read_bridge_audit").update({ success: true, result_count: corretores.length }).eq("id", audit.id);
    return json(200, { corretores, checked_at: new Date().toISOString() });
  } catch {
    return json(500, { error: "query_failed" });
  }
});
