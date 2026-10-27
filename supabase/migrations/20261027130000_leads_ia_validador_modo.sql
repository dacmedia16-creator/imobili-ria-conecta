-- Nicole em MODO OBSERVAÇÃO (card t_3a4bf078, pedido de Denis 27/10/2026, tópico 6238:
-- "deixa ela responder sem mandar texto pronto, vamos ver como ela se sai").
--
-- ADITIVA: só colunas novas com padrão. Não altera função, canal, allowlist, fila, opt-out, passagem ao
-- corretor (lead_ia_passar) nem o limite "é robô?". Rollback:
-- docs/sql/rollback/20261027130000_leads_ia_validador_modo.rollback.sql
--
-- 1) lead_config.ia_validador_modo: 'bloquear' (padrão, como hoje: a mensagem barrada vira a frase pronta) ou
--    'observar' (a mensagem do modelo SEMPRE sai; o validador só registra o que teria barrado). Só o servidor
--    (service_role) lê; a tela não muda. Ligar só na ZZ:
--      UPDATE public.lead_config SET ia_validador_modo = 'observar' WHERE organization_id = '<id da ZZ>';
-- 2) lead_ia_uso: no modo observar, o TRECHO curto que teria barrado (o número, o link ou as palavras; até 60
--    caracteres, telefone/e-mail mascarados, nunca a mensagem inteira), se a trava só observou e qual tentativa.
BEGIN;

ALTER TABLE public.lead_config
  ADD COLUMN IF NOT EXISTS ia_validador_modo text NOT NULL DEFAULT 'bloquear'
    CONSTRAINT lead_config_ia_validador_modo_check CHECK (ia_validador_modo IN ('bloquear', 'observar'));

ALTER TABLE public.lead_ia_uso
  ADD COLUMN IF NOT EXISTS bloqueio_trecho text
    CONSTRAINT lead_ia_uso_bloqueio_trecho_check CHECK (char_length(bloqueio_trecho) <= 60),
  ADD COLUMN IF NOT EXISTS observado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tentativa smallint
    CONSTRAINT lead_ia_uso_tentativa_check CHECK (tentativa IS NULL OR tentativa BETWEEN 1 AND 2);

COMMENT ON COLUMN public.lead_config.ia_validador_modo IS
  'Validador da Nicole: bloquear (padrão, troca pela frase pronta) ou observar (envia sempre e só registra) (t_3a4bf078).';
COMMENT ON COLUMN public.lead_ia_uso.bloqueio_trecho IS
  'Modo observar: trecho curto que teria barrado (número/link/palavras, até 60 caracteres, contato mascarado).';
COMMENT ON COLUMN public.lead_ia_uso.observado IS
  'Modo observar: a mensagem do modelo saiu mesmo com o bloqueio (a trava só registrou).';

COMMIT;
