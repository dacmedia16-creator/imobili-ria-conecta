import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  processarFila,
  processarProvisionamento,
  reconciliar,
  segredoInternoOk,
  type Satelite,
} from "./core.ts";

// Chamada só pelo pg_cron do próprio ADM (public.sync_disparar), com cabeçalho x-sync-internal.
// Secrets: SYNC_INTERNAL_SECRET (>=32), ESTUDO_SYNC_URL + ESTUDO_SYNC_SECRET, VISITA_SYNC_URL + VISITA_SYNC_SECRET.
// verify_jwt = false (config.toml): a autenticação é o segredo interno; sem CORS de propósito.
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const resp = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req) => {
  if (req.method !== "POST") return resp({ error: "method_not_allowed" }, 405);
  if (!segredoInternoOk(req.headers.get("x-sync-internal"), Deno.env.get("SYNC_INTERNAL_SECRET"))) {
    return resp({ error: "unauthorized" }, 401);
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return resp({ error: "function_not_configured" }, 503);
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const urls: Record<Satelite, string> = {
    estudo: Deno.env.get("ESTUDO_SYNC_URL") ?? "",
    visita: Deno.env.get("VISITA_SYNC_URL") ?? "",
  };
  const amb = {
    segredos: {
      estudo: Deno.env.get("ESTUDO_SYNC_SECRET"),
      visita: Deno.env.get("VISITA_SYNC_SECRET"),
    },
    enviar: async (sat: Satelite, corpo: string, assinatura: string) => {
      if (!urls[sat]) return { status: 503, json: { error: "url_nao_configurada" } };
      const r = await fetch(urls[sat], {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-adm-sync-signature": assinatura },
        body: corpo,
        signal: AbortSignal.timeout(25000),
      });
      return { status: r.status, json: await r.json().catch(() => null) };
    },
  };

  const body = await req.json().catch(() => ({}));
  try {
    if (body?.acao === "reconciliar") return resp(await reconciliar(admin, amb, body.adm_org_id));
    // Imobiliárias novas primeiro (t_c0844acb): ao concluir, as pessoas da org entram na fila e já seguem
    // nesta mesma rodada. Falha aqui não impede o sync de pessoas.
    let provisao: unknown = null;
    try {
      provisao = await processarProvisionamento(admin, amb);
    } catch (err) {
      console.error("[sync-satelites] provisao:", (err as Error).message);
      provisao = { error: "provision_failed" };
    }
    return resp({ provisao, ...(await processarFila(admin, amb)) });
  } catch (err) {
    console.error("[sync-satelites]", (err as Error).message);
    return resp({ error: "sync_failed" }, 500);
  }
});
