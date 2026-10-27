import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { argsBusca, argsParecidos, normalizarParecidos, proximaResposta, type ContextoIa, type Extrator, type ImovelEncontrado } from "./leads-ia";
import { chamarGemini, montarExtrator, type UsoModelo } from "./leads-ia-modelo";

/**
 * Tela de teste da IA (card t_8046ecb0): o gestor responde COMO SE FOSSE o cliente.
 * Fluxo: botão -> esta função (login do gestor) -> RPC lead_ia_cliente_simular (o BANCO confere gestor,
 * imobiliária, módulo, modo teste e trata o SAIR) -> roteiro de qualificação (leads-ia.ts, textos fixos)
 * -> RPC lead_ia_aplicar pelo servidor (service_role; idempotente pela versão da conversa).
 * Nada é enviado para fora do ADM. O modelo segue a escolha da imobiliária (card t_6f688b4b):
 * OpenRouter (se escolhido e com OPENROUTER_API_KEY) -> Gemini (LEADS_IA_MODELO=gemini) -> só regras.
 */
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

/** Extrator só com Gemini: só ENTENDE a resposta (JSON curto); nunca escreve a mensagem ao cliente. */
export function extratorGemini(apiKey: string, fetchFn: typeof fetch = fetch): Extrator {
  return async (passo, texto) => (await chamarGemini(apiKey, passo, texto, fetchFn)).dados;
}

const Input = z.object({
  leadId: z.string().uuid(),
  texto: z.string().trim().min(1).max(1000),
});

export const responderComoCliente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as SupabaseClient;
    const { data: ctx, error } = await user.rpc("lead_ia_cliente_simular", {
      _lead: data.leadId,
      _texto: data.texto,
    });
    if (error) return { ok: false as const, erro: error.message };
    const c = ctx as ContextoIa;
    if (c.estado !== "ativa") return { ok: true as const, estado: c.estado };
    const db = await admin();
    // Modelo escolhido pela própria imobiliária (a RLS do usuário entrega só a config dela).
    const { data: cfg } = await user
      .from("lead_config")
      .select("organization_id,ia_modelo_provedor,ia_modelo")
      .maybeSingle();
    const conf = (cfg ?? {}) as { organization_id?: string; ia_modelo_provedor?: string; ia_modelo?: string | null };
    const usos: UsoModelo[] = [];
    const extrator = montarExtrator(
      { provedor: conf.ia_modelo_provedor === "openrouter" ? "openrouter" : "gemini", modelo: conf.ia_modelo ?? null },
      process.env as Record<string, string | undefined>,
      (u) => usos.push(u),
    );
    const r = await proximaResposta({ ...c, dados: c.dados ?? {} }, data.texto, extrator, {
      buscarImovel: async (codigo) => {
        const { data: im, error: ei } = await db.rpc("lead_ia_imovel_por_codigo", { _conversa: c.conversa_id, _codigo: codigo });
        return ei ? null : ((im as ImovelEncontrado | null) ?? null);
      },
      // Imóvel parecido do XML da própria imobiliária (t_232e13cb). Erro = sem oferta.
      buscarParecidos: async (filtro) => {
        const { data: pr, error: ep } = await db.rpc("lead_ia_imoveis_parecidos", argsParecidos(c.conversa_id, filtro));
        return ep ? null : normalizarParecidos(pr);
      },
      // Busca nova no XML (t_5b493bc9). Erro (função ainda não aplicada) = sem oferta.
      buscarImoveis: async (filtro) => {
        const { data: pr, error: ep } = await db.rpc("lead_ia_imoveis_busca", argsBusca(c.conversa_id, filtro));
        return ep ? null : normalizarParecidos(pr);
      },
    });
    if (conf.organization_id && usos.length) {
      const { error: eu } = await db
        .from("lead_ia_uso")
        .insert(usos.map((u) => ({ organization_id: conf.organization_id, conversa_id: c.conversa_id, ...u })));
      if (eu) console.error("lead_ia_uso falhou:", eu.code);
    }
    const { data: ap, error: e2 } = await db.rpc("lead_ia_aplicar", {
      _conversa: c.conversa_id,
      _versao: c.versao,
      _passo: r.passo,
      _dados: r.dados,
      _resposta: r.resposta,
      _fim: r.fim,
      _resumo: r.resumo,
      // O banco só diz "encaminhei" se gravou o registro e o aviso; senão usa este texto (t_fc4d9b27).
      _resposta_falha: r.resposta_falha,
    });
    // Sem conteúdo da conversa no log.
    if (e2) {
      console.error("lead_ia_aplicar falhou:", e2.code);
      return { ok: false as const, erro: "falha" };
    }
    return { ok: true as const, estado: r.fim ? "passada" : "ativa", aplicado: (ap as { ok?: boolean })?.ok === true };
  });
