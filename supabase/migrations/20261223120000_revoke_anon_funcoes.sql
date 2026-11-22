-- 20261223120000_revoke_anon_funcoes — t_44f96aed (autorizado por Denis em 22/11, tópico 6238; boletim t_9c02ccf5 itens 1 e 4).
-- Tira o acesso SEM LOGIN (papel anon e o grupo PUBLIC) das funções do banco que não são públicas.
--
-- Inventário de produção (22/11/2026): 80 funções de public executáveis por anon.
--   Fecha 74: 31 gatilhos, 15 auxiliares de permissão/RLS,
--   18 ações de tela logada, 10 utilitários internos.
--   Mantém 6 públicas (lista em supabase/tests/anon-funcoes-permitidas.txt, com o motivo de cada uma).
-- authenticated e service_role continuam EXATAMENTE como estão: todas as funções fechadas já têm GRANT
-- explícito para os dois (conferido no fim desta migration). Corpo de função, políticas e dados: intocados.
--
-- PUBLIC: 34 destas funções também tinham EXECUTE para PUBLIC (todo papel do banco). Tirar o PUBLIC só afeta
-- papéis internos da Supabase e o leitor somente-leitura das auditorias; o app usa anon/authenticated/service_role
-- e as funções SECURITY DEFINER rodam como o dono (postgres/mt_1b_definer, que mantêm acesso).
-- Gatilhos: o Postgres NÃO confere EXECUTE na hora de disparar um gatilho (só ao criá-lo), então fechar os
-- gatilhos não muda nenhuma gravação. Prova: handle_new_user já roda hoje para o supabase_auth_admin sem grant.
--
-- DEFAULT PRIVILEGES (funções NOVAS): hoje toda função criada pelo papel postgres no schema public nasce com
-- EXECUTE para anon (regra padrão da Supabase) e, pela regra do próprio Postgres, para PUBLIC. Por isso as
-- migrations precisavam lembrar de fazer REVOKE em cada função nova. A partir daqui:
--   1) ALTER DEFAULT PRIVILEGES ... IN SCHEMA public REVOKE ... FROM anon  -> função nova não abre para anon;
--   2) ALTER DEFAULT PRIVILEGES ... REVOKE ... FROM PUBLIC (sem IN SCHEMA)  -> vale para todos os schemas,
--      porque o PUBLIC vem de uma regra global do Postgres (um REVOKE limitado ao schema não teria efeito).
--   authenticated e service_role continuam ganhando EXECUTE por padrão em public e academia (nada muda
--   para o app logado). Em max_suporte as migrations já concedem explicitamente ao max_suporte_bot.
--   Função que PRECISA ser pública agora exige GRANT ... TO anon explícito + entrada na lista permitida
--   (o teste src/lib/anon-funcoes.test.ts reprova o build se aparecer GRANT para anon/PUBLIC fora da lista).
--   Funções criadas por supabase_admin (Studio/extensões) não são alcançadas: o papel postgres não altera
--   default privileges de outro papel. Por isso a varredura supabase/tests/run-anon-funcoes.sh confere o banco real.
--
-- Desfazer: supabase/rollback/20261223120000_revoke_anon_funcoes.sql (gerado do mesmo inventário; devolve a lista idêntica, na mesma ordem).
BEGIN;

-- gatilho (trigger): 31
REVOKE EXECUTE ON FUNCTION public.audit_operational_impersonation_action() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bloquear_avanco_com_previsao_incompleta() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bloquear_avanco_sem_endereco() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.bloquear_participacao_extra_vazia() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.destravar_ocorrencia_ao_devolver_gestor() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_max_two_positioning_regions() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_occurrence_recebido_lock() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_profiles_ativo_lock() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_room_reservation_booking_block() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_room_reservation_cancellation_deadline() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_sale_comissao_lock() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_team_co_leader_role() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_team_depth() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_team_leader_role() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_user_roles_self_update_lock() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.log_role_change() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mt_1e_member_lock() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_sale_commission_extras_sync_ocorrencia() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_sale_payment_sync_ocorrencia() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_sales_sync_antes_financeiro() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_sincronizar_financeiro_ocorrencia_da_venda() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_sincronizar_previsao_ocorrencia_pendente() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.validar_dados_financeiros_ocorrencia() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.validar_data_venda_lancamento_mes_atual() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.validar_distribuicao_antes_aprovar_gestor() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.validar_distribuicao_antes_concluir_lancamento() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.validar_distribuicao_antes_transicao_critica_occ() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.validar_percentual_valor_comissao_lancamento() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.validate_sale_status_transition() FROM PUBLIC, anon;

-- auxiliar: 15
REVOKE EXECUTE ON FUNCTION public.can_edit_sale_stage(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_sale(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exclusive_actor_active(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exclusive_can_view(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exclusive_capture_enabled() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exclusive_is_editor(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exclusive_is_manager(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid,public.app_role[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_active_user(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_lead_of(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_sale_locked(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.leads_team_or_parent(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sees_own_team_leader(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sees_team(uuid,uuid) FROM PUBLIC, anon;

-- ação de tela: 18
REVOKE EXECUTE ON FUNCTION public.archive_sale_document(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_room_reservation(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.change_sale_status(uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cliente_historico(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.criar_ocorrencia_completa(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.criar_ocorrencia_lancamento(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exclusive_profile_registration() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exclusive_register_document(uuid,text,integer,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exclusive_save(uuid,jsonb,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exclusive_transition(uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_room_reservation_cancellation_status(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_active_corretores() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_active_gestores() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_active_team_leaders() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_active_users() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_user_preview_event(uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_contrato_pendencia(uuid,text,boolean) FROM PUBLIC, anon;

-- utilitário: 10
REVOKE EXECUTE ON FUNCTION public.clicksign_data_br(timestamp with time zone) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exclusive_norm_address(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exclusive_plan_prazo_dias(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exclusive_plan_semanas(jsonb,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exclusive_proxima_segunda() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exclusive_required_fields(jsonb,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exclusive_valid_cpf(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mt_2c_public_org() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.photo_voucher_vencimento(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.portal_code_key(text) FROM PUBLIC, anon;

-- Funções novas não nascem abertas ao anon nem ao PUBLIC.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- academia: as funções novas desse schema só chegavam ao usuário logado pelo PUBLIC. Mantém o mesmo
-- comportamento para authenticated/service_role (anon nem tem USAGE no schema academia).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA academia GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- Conferência: só as públicas da lista continuam abertas; authenticated e service_role mantêm todas as fechadas.
DO $chk$
DECLARE _abertas text; _perdeu text; _sumiu text;
BEGIN
  SELECT string_agg(x, ', ') INTO _sumiu FROM unnest(ARRAY[
    'public.depoimentos_publicos()',
    'public.list_public_org_regions(text)',
    'public.list_public_org_specialists(text,text,bigint)',
    'public.list_public_positioning_regions()',
    'public.list_public_specialist_agencies()',
    'public.list_public_specialists(text,bigint)'
  ]) x WHERE to_regprocedure(x) IS NULL;
  IF _sumiu IS NOT NULL THEN
    RAISE EXCEPTION 'Função pública da lista não existe no banco: %', _sumiu;
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _abertas
    FROM pg_proc p
   WHERE p.pronamespace IN ('public'::regnamespace, 'academia'::regnamespace)
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
     AND p.oid NOT IN (SELECT to_regprocedure(x) FROM unnest(ARRAY[
    'public.depoimentos_publicos()',
    'public.list_public_org_regions(text)',
    'public.list_public_org_specialists(text,text,bigint)',
    'public.list_public_positioning_regions()',
    'public.list_public_specialist_agencies()',
    'public.list_public_specialists(text,bigint)'
     ]) x WHERE to_regprocedure(x) IS NOT NULL);
  IF _abertas IS NOT NULL THEN
    RAISE EXCEPTION 'Funções ainda executáveis sem login fora da lista permitida: %', _abertas;
  END IF;
  SELECT string_agg(x, ', ') INTO _perdeu FROM unnest(ARRAY[
    'public.archive_sale_document(uuid)',
    'public.audit_operational_impersonation_action()',
    'public.bloquear_avanco_com_previsao_incompleta()',
    'public.bloquear_avanco_sem_endereco()',
    'public.bloquear_participacao_extra_vazia()',
    'public.can_edit_sale_stage(uuid,uuid)',
    'public.can_view_sale(uuid,uuid)',
    'public.cancel_room_reservation(uuid)',
    'public.change_sale_status(uuid,text,text)',
    'public.clicksign_data_br(timestamp with time zone)',
    'public.cliente_historico(uuid,uuid)',
    'public.criar_ocorrencia_completa(uuid)',
    'public.criar_ocorrencia_lancamento(uuid)',
    'public.destravar_ocorrencia_ao_devolver_gestor()',
    'public.enforce_max_two_positioning_regions()',
    'public.enforce_occurrence_recebido_lock()',
    'public.enforce_profiles_ativo_lock()',
    'public.enforce_room_reservation_booking_block()',
    'public.enforce_room_reservation_cancellation_deadline()',
    'public.enforce_sale_comissao_lock()',
    'public.enforce_team_co_leader_role()',
    'public.enforce_team_depth()',
    'public.enforce_team_leader_role()',
    'public.enforce_user_roles_self_update_lock()',
    'public.exclusive_actor_active(uuid)',
    'public.exclusive_can_view(uuid,uuid)',
    'public.exclusive_capture_enabled()',
    'public.exclusive_is_editor(uuid,uuid)',
    'public.exclusive_is_manager(uuid,uuid)',
    'public.exclusive_norm_address(text)',
    'public.exclusive_plan_prazo_dias(text)',
    'public.exclusive_plan_semanas(jsonb,uuid)',
    'public.exclusive_profile_registration()',
    'public.exclusive_proxima_segunda()',
    'public.exclusive_register_document(uuid,text,integer,text,text)',
    'public.exclusive_required_fields(jsonb,text,text)',
    'public.exclusive_save(uuid,jsonb,text,text)',
    'public.exclusive_transition(uuid,text,text)',
    'public.exclusive_valid_cpf(text)',
    'public.get_room_reservation_cancellation_status(uuid)',
    'public.handle_new_user()',
    'public.has_any_role(uuid,public.app_role[])',
    'public.has_role(uuid,public.app_role)',
    'public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text)',
    'public.is_active_user(uuid)',
    'public.is_lead_of(uuid,uuid)',
    'public.is_sale_locked(uuid)',
    'public.leads_team_or_parent(uuid,uuid)',
    'public.list_active_corretores()',
    'public.list_active_gestores()',
    'public.list_active_team_leaders()',
    'public.list_active_users()',
    'public.log_role_change()',
    'public.mt_1e_member_lock()',
    'public.mt_2c_public_org()',
    'public.photo_voucher_vencimento(date)',
    'public.portal_code_key(text)',
    'public.record_user_preview_event(uuid,text)',
    'public.sees_own_team_leader(uuid,uuid)',
    'public.sees_team(uuid,uuid)',
    'public.set_updated_at()',
    'public.trg_sale_commission_extras_sync_ocorrencia()',
    'public.trg_sale_payment_sync_ocorrencia()',
    'public.trg_sales_sync_antes_financeiro()',
    'public.trg_sincronizar_financeiro_ocorrencia_da_venda()',
    'public.trg_sincronizar_previsao_ocorrencia_pendente()',
    'public.update_contrato_pendencia(uuid,text,boolean)',
    'public.validar_dados_financeiros_ocorrencia()',
    'public.validar_data_venda_lancamento_mes_atual()',
    'public.validar_distribuicao_antes_aprovar_gestor()',
    'public.validar_distribuicao_antes_concluir_lancamento()',
    'public.validar_distribuicao_antes_transicao_critica_occ()',
    'public.validar_percentual_valor_comissao_lancamento()',
    'public.validate_sale_status_transition()'
  ]) x
   WHERE NOT has_function_privilege('authenticated', to_regprocedure(x), 'EXECUTE')
      OR NOT has_function_privilege('service_role', to_regprocedure(x), 'EXECUTE');
  IF _perdeu IS NOT NULL THEN
    RAISE EXCEPTION 'authenticated/service_role perderiam acesso a: %', _perdeu;
  END IF;
END
$chk$;

COMMIT;
