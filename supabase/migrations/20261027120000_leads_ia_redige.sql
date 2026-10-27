-- Nicole "conversando de verdade": o modelo escreve a resposta, com travas (card t_7b59589c, "caminho 2" de
-- Denis 27/10/2026, tópico 6238).
--
-- ADITIVA: só colunas novas com padrão. Não altera função, canal, allowlist, fila, opt-out nem a passagem ao
-- corretor (lead_ia_passar). Rollback: docs/sql/rollback/20261027120000_leads_ia_redige.rollback.sql
--
-- 1) lead_config.ia_redige: chave por imobiliária, padrão DESLIGADO (todas seguem com as frases fixas).
--    Ligar só na ZZ quando Denis aprovar a publicação:
--      UPDATE public.lead_config SET ia_redige = true WHERE organization_id = '<id da ZZ>';
--    Só o servidor (service_role) lê; a tela não muda.
-- 2) lead_ia_uso: para cada chamada, se foi para "entender" (como hoje) ou "redigir", e se a redação foi
--    bloqueada pelo validador, com o CÓDIGO do motivo (ex.: 'valor', 'link'). Nunca o conteúdo.
BEGIN;

ALTER TABLE public.lead_config
  ADD COLUMN IF NOT EXISTS ia_redige boolean NOT NULL DEFAULT false;

ALTER TABLE public.lead_ia_uso
  ADD COLUMN IF NOT EXISTS uso text NOT NULL DEFAULT 'entender'
    CONSTRAINT lead_ia_uso_uso_check CHECK (uso IN ('entender', 'redigir')),
  ADD COLUMN IF NOT EXISTS bloqueado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bloqueio text
    CONSTRAINT lead_ia_uso_bloqueio_check CHECK (bloqueio IS NULL OR bloqueio ~ '^[a-z_]{1,20}$');

COMMENT ON COLUMN public.lead_config.ia_redige IS
  'Nicole: o modelo escreve a resposta (com validador e texto fixo como plano B). Padrão desligado (t_7b59589c).';
COMMENT ON COLUMN public.lead_ia_uso.bloqueio IS
  'Código do motivo do bloqueio da redação pelo validador (sem conteúdo da conversa).';

-- Contador de bloqueios por imobiliária e dia (leitura: gestor da própria imobiliária, pela RLS de lead_ia_uso).
CREATE OR REPLACE VIEW public.lead_ia_redacao_resumo WITH (security_invoker = true) AS
SELECT organization_id, (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia,
       count(*) FILTER (WHERE uso = 'redigir') AS redigidas,
       count(*) FILTER (WHERE uso = 'redigir' AND bloqueado) AS bloqueadas,
       count(DISTINCT conversa_id) FILTER (WHERE uso = 'redigir') AS conversas,
       round(coalesce(sum(custo_usd), 0), 6) AS custo_usd
  FROM public.lead_ia_uso
 GROUP BY 1, 2;
REVOKE ALL ON public.lead_ia_redacao_resumo FROM PUBLIC, anon;
GRANT SELECT ON public.lead_ia_redacao_resumo TO authenticated, service_role;

COMMIT;
