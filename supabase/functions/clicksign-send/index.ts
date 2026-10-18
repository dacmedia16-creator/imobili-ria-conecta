// Edge function clicksign-send: envia a captação (contrato "gerado") para assinatura na Clicksign.
// Exige o JWT do usuário (verify_jwt padrão). A regra de quem pode enviar fica no banco
// (clicksign_capture_authorize). Chave da Clicksign: Vault da org, lida só aqui (service_role).
// Logs: só ids, status e código HTTP — nunca token, segredo ou e-mail.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleSend } from "./core.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

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
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: whoErr } = await user.auth.getUser();
  if (whoErr || !who?.user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const result = await handleSend(
    {
      actorId: who.user.id,
      fetch: (u, init) => fetch(u, init),
      async authorize(captureId) {
        const { data, error } = await user.rpc("clicksign_capture_authorize", { _id: captureId });
        if (error) throw new Error(error.message);
        return data as string;
      },
      async loadContext(org, captureId) {
        const [cap, settings, imob, token, gerado] = await Promise.all([
          admin.from("exclusive_captures").select("form_data, captor_id").eq("id", captureId)
            .eq("organization_id", org).single(),
          admin.from("clicksign_org_settings")
            .select("test_mode, test_allowlist_sha256, deadline_days").eq("organization_id", org).single(),
          admin.rpc("clicksign_imobiliaria_signers", { _org: org }),
          admin.rpc("clicksign_org_secret", { _org: org, _kind: "access_token" }),
          admin.from("exclusive_documents").select("id, file_name").eq("capture_id", captureId)
            .eq("kind", "gerado").single(),
        ]);
        if (cap.error || settings.error || imob.error || token.error || gerado.error) {
          throw new Error("context_unavailable");
        }
        const { data: captor } = await admin.from("profiles").select("nome, email")
          .eq("id", cap.data.captor_id).single();
        return {
          organizationId: org,
          form: (cap.data.form_data ?? {}) as Record<string, unknown>,
          corretor: { nome: captor?.nome ?? "", email: captor?.email ?? "" },
          imobiliaria: (imob.data ?? []) as Array<{ id: string; nome: string; email: string }>,
          testMode: settings.data.test_mode,
          allowlistSha256: settings.data.test_allowlist_sha256 ?? [],
          deadlineDays: settings.data.deadline_days,
          token: (token.data as string | null) ?? null,
          gerado: { id: gerado.data.id, fileName: gerado.data.file_name },
        };
      },
      async loadPdf(_captureId, documentId) {
        const { data: d, error } = await admin.from("exclusive_documents").select("storage_path")
          .eq("id", documentId).single();
        if (error) throw new Error("pdf_unavailable");
        const file = await admin.storage.from("exclusive-captures").download(d.storage_path);
        if (file.error || !file.data) throw new Error("pdf_unavailable");
        return new Uint8Array(await file.data.arrayBuffer());
      },
      async insertEnvelope(row) {
        const { data, error } = await admin.from("clicksign_envelopes").insert(row).select("id").single();
        if (error?.code === "23505") throw new Error("duplicate");
        if (error) throw new Error("envelope_insert_failed");
        return data.id as string;
      },
      async updateEnvelope(id, patch) {
        const { error } = await admin.from("clicksign_envelopes").update(patch).eq("id", id);
        if (error) throw new Error("envelope_update_failed");
      },
      async markSent(id) {
        const { error } = await admin.rpc("clicksign_mark_sent", { _envelope: id });
        if (error) throw new Error("mark_sent_failed");
      },
    },
    body,
  ).catch((e) => {
    console.error("clicksign-send internal", e instanceof Error ? e.message : "erro");
    return { status: 500, body: { error: "Falha interna no envio. Nada foi enviado aos signatários." } };
  });
  console.log("clicksign-send", result.status, (result.body as { code?: string }).code ?? "");
  return json(result.body, result.status);
});
