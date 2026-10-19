// Edge function clicksign-config: tela "Assinatura digital" (só super admin da imobiliária).
// Exige o JWT do usuário (verify_jwt padrão). A regra de quem pode e de QUAL org fica no banco
// (clicksign_config_authorize, com o JWT); depois disso, gravações com service_role pelas funções
// clicksign_config_*. Logs: só ação e status — nunca chave, segredo ou e-mail.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleConfig } from "./core.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anon || !service) return json({ error: "function_not_configured" }, 503);
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const user = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who, error: whoErr } = await user.auth.getUser();
  if (whoErr || !who?.user) return json({ error: "unauthorized" }, 401);
  const actor = who.user.id;
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };

  const body = await req.json().catch(() => ({}));
  const result = await handleConfig(
    {
      actorId: actor,
      fetch: (u, init) => fetch(u, init),
      async authorize() {
        const { data, error } = await user.rpc("clicksign_config_authorize");
        if (error || typeof data !== "string") throw new Error("forbidden");
        return data;
      },
      view: async (org) =>
        (await rpc("clicksign_config_view", { _org: org })) as Record<string, unknown>,
      async storeSecret(org, kind, value) {
        await rpc("clicksign_config_store_secret", {
          _org: org,
          _actor: actor,
          _kind: kind,
          _value: value,
        });
      },
      async save(org, p) {
        await rpc("clicksign_config_save", {
          _org: org,
          _actor: actor,
          _test_mode: p.testMode ?? null,
          _signer_ids: p.signerIds ?? null,
          _allowlist: p.allowlist ?? null,
          _deadline_days: p.deadlineDays ?? null,
        });
      },
      async token(org) {
        return (
          ((await rpc("clicksign_org_secret", { _org: org, _kind: "access_token" })) as
            string | null) ?? null
        );
      },
      async recordTest(org, ok, code) {
        await rpc("clicksign_config_record_test", {
          _org: org,
          _actor: actor,
          _ok: ok,
          _code: code,
        });
      },
      async setEnabled(org, on) {
        await rpc("clicksign_config_set_enabled", { _org: org, _actor: actor, _on: on });
      },
      webhookUrl: (slug) => `${url.replace(/\/$/, "")}/functions/v1/clicksign-webhook/${slug}`,
    },
    body,
  ).catch(() => ({
    status: 500,
    body: { error: "Falha interna. Atualize a página e confira a configuração." },
  }));
  console.log("clicksign-config", (body as { action?: string })?.action ?? "", result.status);
  return json(result.body, result.status);
});
