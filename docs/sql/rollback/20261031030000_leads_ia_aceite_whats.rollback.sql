-- Rollback do aceite pelo WhatsApp (t_63c55cee).
-- PASSO ÚNICO para DESLIGAR na ZZ (o aviso volta a dizer "Aceite no ADM em Meus leads"; mensagens do telefone do
-- corretor deixam de ser interceptadas e seguem o fluxo de antes):
UPDATE public.lead_config SET ia_aceite_whats = false, updated_at = now()
 WHERE organization_id = 'eb0a260a-db2f-4cbf-b031-f0c2aebb407c';
-- O rollback da liberação (ia_aviso_corretor_whats = false, docs/sql/rollback/20261030220000_*) também desliga isto.
--
-- Voltar o código do banco ao anterior (opcional; com a chave desligada nada muda): reaplicar
-- public.lead_ia_retorno_receber da 20261030220000_leads_ia_vip7_liberacao.sql e
-- public.lead_aviso_corretor_texto(uuid, boolean) + public.lead_avisos_corretor_reservar(uuid) da
-- 20261031010000_leads_ia_aviso_corretor_telefone_historico.sql. As tabelas lead_aceite_codigos/lead_aceite_whats
-- e as funções lead_aceite_* podem ficar (sem chamada, nada acontece).
