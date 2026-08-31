import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const encoder = new TextEncoder();
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, x-client-info", "Content-Type": "application/json" };
function bytes(value: string) { const base64 = value.replaceAll("-", "+").replaceAll("_", "/"); const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4)); return Uint8Array.from(binary, c => c.charCodeAt(0)); }
async function verify(ticket: string, secret: string) {
  try {
    const [encoded, signature, extra] = ticket.split("."); if (!encoded || !signature || extra) return null;
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (!await crypto.subtle.verify("HMAC", key, bytes(signature), encoder.encode(encoded))) return null;
    const payload = JSON.parse(new TextDecoder().decode(bytes(encoded))); const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== "conta-max" || payload.aud !== "adm-max" || payload.app !== "adm-max") return null;
    if (!payload.sub || !payload.jti || !payload.email || payload.exp <= now || payload.iat > now + 5) return null;
    payload.email = String(payload.email).trim().toLowerCase(); return payload.email.includes("@") ? payload : null;
  } catch { return null; }
}
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: cors }); }
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("ADM_MAX_BRIDGE_SECRET") ?? ""; const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""; const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (secret.length < 32 || !url || !serviceKey || !anonKey) return response({ error: "bridge_not_configured" }, 503);
  const { ticket } = await req.json().catch(() => ({ ticket: "" })); const payload = await verify(String(ticket ?? ""), secret);
  if (!payload) return response({ error: "invalid_ticket" }, 401);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error: useError } = await admin.from("conta_max_ticket_uses").insert({ jti: payload.jti, expires_at: new Date(payload.exp * 1000).toISOString() });
  if (useError) return response({ error: "ticket_reused" }, 409);
  let { data: link } = await admin.from("conta_max_identity_links").select("adm_user_id").eq("workos_user_id", payload.sub).eq("active", true).maybeSingle();
  if (!link) { const { data: linkedId, error } = await admin.rpc("link_conta_max_identity_by_email", { p_workos_user_id: payload.sub, p_email: payload.email }); if (error || !linkedId) return response({ error: "identity_not_linked" }, 403); link = { adm_user_id: linkedId }; }
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(link.adm_user_id); if (userError || !userData.user?.email) return response({ error: "linked_user_unavailable" }, 403);
  const { data: generated, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: userData.user.email }); const tokenHash = generated?.properties?.hashed_token;
  if (linkError || !tokenHash) return response({ error: "session_generation_failed" }, 500);
  const client = createClient(url, anonKey, { auth: { persistSession: false } }); const { data: verified, error: verifyError } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (verifyError || !verified.session) return response({ error: "session_generation_failed" }, 500);
  return response({ access_token: verified.session.access_token, refresh_token: verified.session.refresh_token, expires_in: verified.session.expires_in });
});
