// Edge function clicksign-sale: Clicksign na VENDA (enviar, cancelar, status, reenviar aviso e editar
// signatário). Exige o JWT do usuário (verify_jwt padrão). As regras (gestor/jurídico/ADM, mesma org,
// status contrato_ok_corretor, liberação do jurídico, contrato vigente) ficam no banco.
// Logs: só ação, status e código HTTP — nunca token, segredo ou e-mail.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corretorIds, handleSale } from "./core.ts";

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

  const body = await req.json().catch(() => ({}));
  const result = await handleSale(
    {
      actorId: who.user.id,
      fetch: (u, init) => fetch(u, init),
      async authorizeSend(saleId) {
        const { data, error } = await user.rpc("clicksign_sale_authorize", { _id: saleId });
        if (error) throw new Error(error.message);
        const d = (data ?? {}) as { org?: string; contrato?: string };
        if (!d.org || !d.contrato) throw new Error("Venda não disponível");
        return { org: d.org, contrato: d.contrato };
      },
      async loadSendContext(org, saleId, contratoId) {
        const [sale, parties, corretores, settings, imob, token, doc] = await Promise.all([
          admin
            .from("sales")
            .select("imovel_id, codigo_interno")
            .eq("id", saleId)
            .eq("organization_id", org)
            .single(),
          admin
            .from("sale_parties")
            .select("papel, nome, email, tipo_pessoa")
            .eq("sale_id", saleId),
          // Função só do servidor (dona postgres, presa à org): sale_corretores depende do usuário
          // logado (RLS) e com a chave service_role devolvia lista vazia (t_bc726348).
          admin.rpc("clicksign_sale_corretores", { _org: org, _sale_id: saleId }),
          admin
            .from("clicksign_org_settings")
            .select("enabled, sale_enabled, test_mode, test_allowlist_sha256, deadline_days")
            .eq("organization_id", org)
            .single(),
          admin.rpc("clicksign_imobiliaria_signers", { _org: org }),
          admin.rpc("clicksign_org_secret", { _org: org, _kind: "access_token" }),
          admin
            .from("sale_documents")
            .select("id, file_name")
            .eq("id", contratoId)
            .eq("sale_id", saleId)
            .single(),
        ]);
        if (
          sale.error ||
          parties.error ||
          corretores.error ||
          settings.error ||
          imob.error ||
          token.error ||
          doc.error
        ) {
          throw new Error("context_unavailable");
        }
        const ids = corretorIds(corretores.data);
        const profs = ids.length
          ? await admin.from("profiles").select("id, nome, email").in("id", ids)
          : { data: [], error: null };
        if (profs.error) throw new Error("context_unavailable");
        return {
          parties: parties.data ?? [],
          corretores: (profs.data ?? []).map((p) => ({ nome: p.nome ?? "", email: p.email ?? "" })),
          imobiliaria: (imob.data ?? []) as Array<{ id: string; nome: string; email: string }>,
          saleEnabled: settings.data.enabled === true && settings.data.sale_enabled === true,
          testMode: settings.data.test_mode,
          allowlistSha256: settings.data.test_allowlist_sha256 ?? [],
          deadlineDays: settings.data.deadline_days,
          token: (token.data as string | null) ?? null,
          contrato: { id: doc.data.id, fileName: doc.data.file_name ?? "contrato.pdf" },
          imovel: sale.data.imovel_id ?? sale.data.codigo_interno ?? "",
        };
      },
      async resolveExtras(org, saleId, refs) {
        const { data, error } = await admin.rpc("clicksign_sale_resolve_extras", {
          _org: org,
          _sale: saleId,
          _refs: refs,
        });
        if (error) throw new Error("extras_unavailable");
        return (data ?? []) as Array<{ ref: string; nome: string; email: string }>;
      },
      async loadFile(contratoId) {
        const { data: d, error } = await admin
          .from("sale_documents")
          .select("storage_path")
          .eq("id", contratoId)
          .single();
        if (error || !d.storage_path) throw new Error("file_unavailable");
        const file = await admin.storage.from("sale-documents").download(d.storage_path);
        if (file.error || !file.data) throw new Error("file_unavailable");
        return new Uint8Array(await file.data.arrayBuffer());
      },
      async insertEnvelope(row) {
        const { data, error } = await admin
          .from("clicksign_envelopes")
          .insert(row)
          .select("id")
          .single();
        if (error?.code === "23505") throw new Error("duplicate");
        if (error) throw new Error("envelope_insert_failed");
        return data.id as string;
      },
      async updateEnvelope(id, patch) {
        const { error } = await admin.from("clicksign_envelopes").update(patch).eq("id", id);
        if (error) throw new Error("envelope_update_failed");
      },
      async markSent(id) {
        const { error } = await admin.rpc("clicksign_sale_mark_sent", { _envelope: id });
        if (error) throw new Error("mark_sent_failed");
      },
      async cancelReason(id) {
        const { data } = await admin
          .from("clicksign_envelopes")
          .select("cancel_reason")
          .eq("id", id)
          .single();
        const r = data?.cancel_reason;
        return r === "nova_versao" || r === "status_mudou" ? r : null;
      },
      async markCanceled(id, reason) {
        const { data, error } = await admin.rpc("clicksign_sale_canceled", {
          _envelope: id,
          _reason: reason,
          _actor: who.user.id,
        });
        if (error) throw new Error("cancel_record_failed");
        return data as string;
      },
      // ---- conferir envio sem confirmação (R5) ----
      async reconcileAuthorize(kind, id) {
        const { data, error } = await user.rpc("clicksign_reconcile_authorize", {
          _kind: kind,
          _id: id,
        });
        if (error) throw new Error(error.message);
        const d = (data ?? {}) as { org?: string; envelope?: string };
        if (!d.org || !d.envelope) throw new Error("Envelope não disponível");
        return { org: d.org, envelope: d.envelope };
      },
      async reconcileContext(org, envelopeRow) {
        const [env, token] = await Promise.all([
          admin
            .from("clicksign_envelopes")
            .select("envelope_key, error_code")
            .eq("id", envelopeRow)
            .eq("organization_id", org)
            .single(),
          admin.rpc("clicksign_org_secret", { _org: org, _kind: "access_token" }),
        ]);
        if (env.error || token.error) throw new Error("context_unavailable");
        return {
          envelopeKey: env.data.envelope_key ?? null,
          errorCode: env.data.error_code ?? null,
          token: (token.data as string | null) ?? null,
        };
      },
      async reconcileApply(envelopeRow, remote) {
        const { data, error } = await admin.rpc("clicksign_reconcile_apply", {
          _envelope: envelopeRow,
          _remote: remote,
          _actor: who.user.id,
        });
        if (error) throw new Error("reconcile_failed");
        return data as string;
      },
      // ---- gestão (mesma da captação) ----
      async authorize(saleId) {
        const { data, error } = await user.rpc("clicksign_sale_manage_authorize", { _id: saleId });
        if (error) throw new Error(error.message);
        const d = (data ?? {}) as { org?: string; envelope?: string };
        if (!d.org || !d.envelope) throw new Error("Envelope não disponível");
        return { org: d.org, envelope: d.envelope };
      },
      // Só a ação "status": quem já vê a venda acompanha (t_82e51349).
      async authorizeView(saleId) {
        const { data, error } = await user.rpc("clicksign_sale_view_authorize", { _id: saleId });
        if (error) throw new Error(error.message);
        const d = (data ?? {}) as { org?: string; envelope?: string; can_manage?: boolean };
        if (!d.org || !d.envelope) throw new Error("Envelope não disponível");
        return { org: d.org, envelope: d.envelope, canManage: d.can_manage === true };
      },
      async loadContext(org, envelopeRow) {
        const [env, settings, token] = await Promise.all([
          admin
            .from("clicksign_envelopes")
            .select("envelope_key, document_key, is_test, signers")
            .eq("id", envelopeRow)
            .eq("organization_id", org)
            .single(),
          admin
            .from("clicksign_org_settings")
            .select("test_mode, test_allowlist_sha256")
            .eq("organization_id", org)
            .single(),
          admin.rpc("clicksign_org_secret", { _org: org, _kind: "access_token" }),
        ]);
        if (env.error || settings.error || token.error || !env.data.envelope_key) {
          throw new Error("context_unavailable");
        }
        if (!env.data.document_key) throw new Error("context_unavailable");
        return {
          envelopeRow,
          envelopeKey: env.data.envelope_key,
          documentKey: env.data.document_key,
          isTest: env.data.is_test,
          signers: env.data.signers ?? [],
          testMode: settings.data.test_mode,
          allowlistSha256: settings.data.test_allowlist_sha256 ?? [],
          token: (token.data as string | null) ?? null,
        };
      },
      async lock(envelopeRow, kind) {
        const { data, error } = await admin.rpc("clicksign_manage_lock", {
          _envelope: envelopeRow,
          _kind: kind,
        });
        if (error) throw new Error("lock_failed");
        return data as "ok" | "busy" | "cooldown";
      },
      async done(envelopeRow, p) {
        const { error } = await admin.rpc("clicksign_manage_done", {
          _envelope: envelopeRow,
          _actor: who.user.id,
          _action: p.action,
          _detail: p.detail ?? null,
          _signers: p.signers ?? null,
          _notified: p.notified ?? false,
        });
        if (error) throw new Error("done_failed");
      },
    },
    body,
  ).catch((e) => {
    console.error("clicksign-sale internal", e instanceof Error ? e.message : "erro");
    return { status: 500, body: { error: "Falha interna. Atualize a página e confira o status." } };
  });
  console.log(
    "clicksign-sale",
    (body as { action?: string })?.action ?? "",
    result.status,
    (result.body as { code?: string }).code ?? "",
  );
  return json(result.body, result.status);
});
