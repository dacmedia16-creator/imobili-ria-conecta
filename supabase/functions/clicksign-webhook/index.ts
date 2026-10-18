// Edge function clicksign-webhook: endpoint PÚBLICO (verify_jwt = false), autenticado pelo HMAC da
// org. URL cadastrada na conta Clicksign de cada imobiliária: .../functions/v1/clicksign-webhook/<slug>.
// Logs: só status e resultado — nunca corpo, segredo ou e-mail.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleWebhook } from "./core.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !service) return json({ error: "function_not_configured" }, 503);
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const slug = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  const raw = new Uint8Array(await req.arrayBuffer());

  const result = await handleWebhook(
    {
      fetch: (u, init) => fetch(u, init),
      async findOrg(s) {
        const { data } = await admin
          .from("clicksign_org_settings")
          .select("organization_id")
          .eq("webhook_slug", s)
          .maybeSingle();
        if (!data) return null;
        const [secret, token] = await Promise.all([
          admin.rpc("clicksign_org_secret", { _org: data.organization_id, _kind: "webhook" }),
          admin.rpc("clicksign_org_secret", { _org: data.organization_id, _kind: "access_token" }),
        ]);
        return {
          organizationId: data.organization_id,
          secret: (secret.data as string | null) ?? null,
          token: (token.data as string | null) ?? null,
        };
      },
      async recordEvent(row) {
        const ins = await admin.from("clicksign_webhook_events").insert(row).select("id").single();
        if (!ins.error) return { id: ins.data.id, fresh: true };
        if (ins.error.code !== "23505") throw new Error("event_insert_failed");
        // Já recebido: reprocessa só se a tentativa anterior não terminou ou falhou.
        const { data } = await admin
          .from("clicksign_webhook_events")
          .select("id, result")
          .eq("organization_id", row.organization_id)
          .eq("body_sha256", row.body_sha256)
          .single();
        const retry = !data?.result || String(data.result).startsWith("error:");
        return { id: data!.id, fresh: retry };
      },
      async finishEvent(id, result) {
        await admin
          .from("clicksign_webhook_events")
          .update({ result, processed_at: new Date().toISOString() })
          .eq("id", id);
      },
      async findEnvelope(org, documentKey) {
        const { data } = await admin
          .from("clicksign_envelopes")
          .select("id, envelope_key, document_key, capture_id, organization_id")
          .eq("organization_id", org)
          .eq("document_key", documentKey)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return data ?? null;
      },
      async updateEnvelope(id, patch) {
        await admin.from("clicksign_envelopes").update(patch).eq("id", id);
      },
      async storePdf(env, pdf) {
        const path = `${env.organization_id}/${env.capture_id}/${crypto.randomUUID()}.pdf`;
        const { error } = await admin.storage
          .from("exclusive-captures")
          .upload(path, pdf, { contentType: "application/pdf", upsert: false });
        if (error) throw new Error("storage_upload_failed");
        return path;
      },
      async attachSigned(envelopeId, path, fileName) {
        const { data, error } = await admin.rpc("clicksign_attach_signed", {
          _envelope: envelopeId,
          _path: path,
          _file_name: fileName,
        });
        if (error) throw new Error("attach_failed");
        return data as string;
      },
      async removeObject(path) {
        await admin.storage.from("exclusive-captures").remove([path]);
      },
    },
    slug,
    raw,
    { hmac: req.headers.get("content-hmac"), event: req.headers.get("event") },
  ).catch((e) => {
    console.error("clicksign-webhook internal", e instanceof Error ? e.message : "erro");
    return { status: 500, body: { error: "internal" } };
  });
  console.log(
    "clicksign-webhook",
    result.status,
    (result.body as { result?: string }).result ?? "",
  );
  return json(result.body, result.status);
});
