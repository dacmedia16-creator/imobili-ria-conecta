import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleVendasReais } from "./core.ts";

// Servidor-para-servidor (Worker do Estudo de Mercado -> esta função). Sem CORS de propósito:
// navegador nenhum deve chamar esta rota. Chave por imobiliária no header x-estudo-vendas-key.
const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function getPresentedToken(req: Request): string {
  const direct = req.headers.get("x-estudo-vendas-key");
  if (direct) return direct.trim();
  const authorization = req.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return response({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceRoleKey) return response({ error: "function_not_configured" }, 503);

  const body = await req.json().catch(() => ({}));
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await handleVendasReais(admin, getPresentedToken(req), body);
  return response(result.body, result.status);
});
