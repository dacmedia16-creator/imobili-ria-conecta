-- Rollback da liberação da Nicole na ZZ (t_ccaa41c0). PASSO ÚNICO (só config, nada é apagado):
-- volta à lista de liberados, 1ª mensagem só pelo botão do gestor, apresentação com o nome da imobiliária,
-- rodízio normal, sem aviso por WhatsApp ao corretor, lembretes 24 h/72 h e limite 10.
UPDATE public.lead_config
   SET ia_envio_modo = 'lista', ia_envio_desde = NULL, ia_primeira_auto = false, ia_org_nome = NULL,
       ia_corretor_passagem_id = NULL, ia_aviso_corretor_whats = false, ia_reengajar_h0 = NULL,
       ia_reengajar_h2_sem_resposta = NULL, ia_envio_limite_dia = 10, updated_at = now()
 WHERE organization_id = 'eb0a260a-db2f-4cbf-b031-f0c2aebb407c';
-- Com o modo 'lista', o banco recusa qualquer envio a quem não está na lista (as mensagens pendentes não saem).
-- Opcional (limpeza visual): marcar como não enviadas as 1ªs mensagens pendentes de quem não está na lista.
-- UPDATE public.lead_mensagens m SET status = 'nao_enviada' FROM public.lead_conversas cv
--  WHERE cv.id = m.conversa_id AND cv.organization_id = 'eb0a260a-db2f-4cbf-b031-f0c2aebb407c'
--    AND m.status = 'pendente' AND public.lead_ia_status_saida(cv.id) <> 'pendente';
--
-- Rollback do CÓDIGO do banco (só se necessário): reaplicar as definições anteriores das funções
-- (supabase/migrations anteriores a 20261030220000). As colunas/tabela novas podem ficar: sem config, nada muda.
