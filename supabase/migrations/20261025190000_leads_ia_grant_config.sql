-- Leads — IA de atendimento: leitura da configuração da IA pela tela. Card t_5d8c0b63 (conferência pós-publicação).
-- A migration 20261025170000 (Grupo ZAP) trocou o SELECT de lead_config por GRANT POR COLUNA, só nas colunas que
-- existiam naquele momento. As colunas da IA (20261025180000) nasceram sem SELECT para authenticated, e o bloco
-- "IA de atendimento" sumia de Leads → Configurar.
-- Libera SÓ o que a tela lê. A lista de telefones liberados e as travas de envio continuam fechadas
-- (só o servidor, service_role, lê e altera).
-- ADITIVA. Rollback: docs/sql/rollback/20261025190000_leads_ia_grant_config.rollback.sql
BEGIN;
GRANT SELECT (ia_ativa, ia_nome, ia_boas_vindas, ia_canal) ON public.lead_config TO authenticated;
COMMIT;
