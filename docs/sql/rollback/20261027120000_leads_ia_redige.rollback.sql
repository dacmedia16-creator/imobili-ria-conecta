-- Rollback de 20261027120000_leads_ia_redige.sql (card t_7b59589c).
-- Publicar ANTES o servidor sem a redação pelo modelo (senão o insert em lead_ia_uso com as colunas novas
-- falha e só o registro de uso se perde: a resposta ao cliente segue). Apaga só o contador de bloqueios e a
-- chave por imobiliária; conversas, mensagens e o uso antigo ficam.
BEGIN;
DROP VIEW IF EXISTS public.lead_ia_redacao_resumo;
ALTER TABLE public.lead_ia_uso
  DROP COLUMN IF EXISTS bloqueio,
  DROP COLUMN IF EXISTS bloqueado,
  DROP COLUMN IF EXISTS uso;
ALTER TABLE public.lead_config DROP COLUMN IF EXISTS ia_redige;
COMMIT;
