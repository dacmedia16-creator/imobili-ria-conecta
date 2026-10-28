// Edge function clicksign-manage: consulta quem já assinou, reenvia o aviso e edita signatário de um
// envelope em assinatura. Exige o JWT do usuário (verify_jwt padrão); a regra (gestor/jurídico/ADM,
// mesma org, envelope running) fica no banco (clicksign_manage_authorize).
// Logs: só ação, status e código HTTP — nunca token, segredo ou e-mail.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleManage } from "./core.ts";
import { handleReconcile } from "../_shared/clicksign-reconcile.ts";

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
  // "Conferir na Clicksign" (R5): envio da captação que ficou sem confirmação.
  if ((body as { action?: string })?.action === "reconcile") {
    const res = await handleReconcile(
      {
        fetch: (u, init) => fetch(u, init),
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
        async updateEnvelope(id, patch) {
          const { error } = await admin.from("clicksign_envelopes").update(patch).eq("id", id);
          if (error) throw new Error("envelope_update_failed");
        },
      },
      "captacao",
      typeof (body as { capture_id?: unknown }).capture_id === "string"
        ? (body as { capture_id: string }).capture_id
        : "",
    ).catch((e) => {
      console.error("clicksign-manage internal", e instanceof Error ? e.message : "erro");
      return {
        status: 500,
        body: { error: "Falha interna. Atualize a página e confira o status." },
      };
    });
    console.log(
      "clicksign-manage",
      "reconcile",
      res.status,
      (res.body as { result?: string }).result ?? "",
    );
    return json(res.body, res.status);
  }
  const result = await handleManage(
    {
      actorId: who.user.id,
      fetch: (u, init) => fetch(u, init),
      async authorize(captureId) {
        const { data, error } = await user.rpc("clicksign_manage_authorize", { _id: captureId });
        if (error) throw new Error(error.message);
        const d = (data ?? {}) as { org?: string; envelope?: string };
        if (!d.org || !d.envelope) throw new Error("Envelope não disponível");
        return { org: d.org, envelope: d.envelope };
      },
      // Só a ação "status": quem já vê a captação acompanha (t_82e51349).
      async authorizeView(captureId) {
        const { data, error } = await user.rpc("clicksign_capture_view_authorize", {
          _id: captureId,
        });
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
      async markCanceledPapel(envelopeRow) {
        const { data, error } = await admin.rpc("clicksign_capture_canceled_papel", {
          _envelope: envelopeRow,
          _actor: who.user.id,
        });
        if (error) throw new Error("cancel_record_failed");
        return data as string;
      },
    },
    body,
  ).catch((e) => {
    console.error("clicksign-manage internal", e instanceof Error ? e.message : "erro");
    return { status: 500, body: { error: "Falha interna. Atualize a página e tente de novo." } };
  });
  console.log(
    "clicksign-manage",
    (body as { action?: string })?.action ?? "",
    result.status,
    (result.body as { code?: string }).code ?? "",
  );
  return json(result.body, result.status);
});
