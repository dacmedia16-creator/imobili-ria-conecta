-- ROLLBACK da migration 20261223120000_revoke_anon_funcoes (t_44f96aed).
-- Gerado automaticamente (mk.py) a partir do inventário de permissões lido em PRODUÇÃO em 22/11/2026.
-- Devolve EXATAMENTE a lista de permissões (proacl) de cada função fechada, inclusive a ORDEM:
-- tira todas as entradas e concede de novo na ordem original. Não mexe em corpo, política nem dado.
-- Também devolve os default privileges do papel postgres ao estado anterior.
BEGIN;

-- public.archive_sale_document(uuid)  antes: {mt_1b_definer=X/mt_1b_definer,anon=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.archive_sale_document(uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.archive_sale_document(uuid) TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.archive_sale_document(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.archive_sale_document(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_sale_document(uuid) TO service_role;

-- public.audit_operational_impersonation_action()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.audit_operational_impersonation_action() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.audit_operational_impersonation_action() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_operational_impersonation_action() TO postgres;
GRANT EXECUTE ON FUNCTION public.audit_operational_impersonation_action() TO anon;
GRANT EXECUTE ON FUNCTION public.audit_operational_impersonation_action() TO authenticated;
GRANT EXECUTE ON FUNCTION public.audit_operational_impersonation_action() TO service_role;
GRANT EXECUTE ON FUNCTION public.audit_operational_impersonation_action() TO mt_1b_definer;

-- public.bloquear_avanco_com_previsao_incompleta()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.bloquear_avanco_com_previsao_incompleta() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.bloquear_avanco_com_previsao_incompleta() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.bloquear_avanco_com_previsao_incompleta() TO postgres;
GRANT EXECUTE ON FUNCTION public.bloquear_avanco_com_previsao_incompleta() TO anon;
GRANT EXECUTE ON FUNCTION public.bloquear_avanco_com_previsao_incompleta() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bloquear_avanco_com_previsao_incompleta() TO service_role;
GRANT EXECUTE ON FUNCTION public.bloquear_avanco_com_previsao_incompleta() TO mt_1b_definer;

-- public.bloquear_avanco_sem_endereco()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
REVOKE ALL ON FUNCTION public.bloquear_avanco_sem_endereco() FROM PUBLIC, anon, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.bloquear_avanco_sem_endereco() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.bloquear_avanco_sem_endereco() TO postgres;
GRANT EXECUTE ON FUNCTION public.bloquear_avanco_sem_endereco() TO anon;
GRANT EXECUTE ON FUNCTION public.bloquear_avanco_sem_endereco() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bloquear_avanco_sem_endereco() TO service_role;

-- public.bloquear_participacao_extra_vazia()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
REVOKE ALL ON FUNCTION public.bloquear_participacao_extra_vazia() FROM PUBLIC, anon, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.bloquear_participacao_extra_vazia() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.bloquear_participacao_extra_vazia() TO postgres;
GRANT EXECUTE ON FUNCTION public.bloquear_participacao_extra_vazia() TO anon;
GRANT EXECUTE ON FUNCTION public.bloquear_participacao_extra_vazia() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bloquear_participacao_extra_vazia() TO service_role;

-- public.can_edit_sale_stage(uuid,uuid)  antes: {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.can_edit_sale_stage(uuid,uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_sale_stage(uuid,uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.can_edit_sale_stage(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_sale_stage(uuid,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.can_edit_sale_stage(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_sale_stage(uuid,uuid) TO mt_1b_definer;

-- public.can_view_sale(uuid,uuid)  antes: {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.can_view_sale(uuid,uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.can_view_sale(uuid,uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.can_view_sale(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_view_sale(uuid,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.can_view_sale(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_sale(uuid,uuid) TO mt_1b_definer;

-- public.cancel_room_reservation(uuid)  antes: {mt_1b_definer=X/mt_1b_definer,anon=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.cancel_room_reservation(uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_room_reservation(uuid) TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.cancel_room_reservation(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.cancel_room_reservation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_room_reservation(uuid) TO service_role;

-- public.change_sale_status(uuid,text,text)  antes: {mt_1b_definer=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer,anon=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.change_sale_status(uuid,text,text) FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.change_sale_status(uuid,text,text) TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.change_sale_status(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_sale_status(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.change_sale_status(uuid,text,text) TO anon;

-- public.clicksign_data_br(timestamp with time zone)  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
REVOKE ALL ON FUNCTION public.clicksign_data_br(timestamp with time zone) FROM PUBLIC, anon, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.clicksign_data_br(timestamp with time zone) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.clicksign_data_br(timestamp with time zone) TO postgres;
GRANT EXECUTE ON FUNCTION public.clicksign_data_br(timestamp with time zone) TO anon;
GRANT EXECUTE ON FUNCTION public.clicksign_data_br(timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_data_br(timestamp with time zone) TO service_role;

-- public.cliente_historico(uuid,uuid)  antes: {mt_1b_definer=X/mt_1b_definer,anon=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.cliente_historico(uuid,uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.cliente_historico(uuid,uuid) TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.cliente_historico(uuid,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.cliente_historico(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_historico(uuid,uuid) TO service_role;

-- public.criar_ocorrencia_completa(uuid)  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.criar_ocorrencia_completa(uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.criar_ocorrencia_completa(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_ocorrencia_completa(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.criar_ocorrencia_completa(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.criar_ocorrencia_completa(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_ocorrencia_completa(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.criar_ocorrencia_completa(uuid) TO mt_1b_definer;

-- public.criar_ocorrencia_lancamento(uuid)  antes: {mt_1b_definer=X/mt_1b_definer,anon=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.criar_ocorrencia_lancamento(uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.criar_ocorrencia_lancamento(uuid) TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.criar_ocorrencia_lancamento(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.criar_ocorrencia_lancamento(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_ocorrencia_lancamento(uuid) TO service_role;

-- public.destravar_ocorrencia_ao_devolver_gestor()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.destravar_ocorrencia_ao_devolver_gestor() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.destravar_ocorrencia_ao_devolver_gestor() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.destravar_ocorrencia_ao_devolver_gestor() TO postgres;
GRANT EXECUTE ON FUNCTION public.destravar_ocorrencia_ao_devolver_gestor() TO anon;
GRANT EXECUTE ON FUNCTION public.destravar_ocorrencia_ao_devolver_gestor() TO authenticated;
GRANT EXECUTE ON FUNCTION public.destravar_ocorrencia_ao_devolver_gestor() TO service_role;
GRANT EXECUTE ON FUNCTION public.destravar_ocorrencia_ao_devolver_gestor() TO mt_1b_definer;

-- public.enforce_max_two_positioning_regions()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.enforce_max_two_positioning_regions() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_max_two_positioning_regions() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_max_two_positioning_regions() TO postgres;
GRANT EXECUTE ON FUNCTION public.enforce_max_two_positioning_regions() TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_max_two_positioning_regions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_max_two_positioning_regions() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_max_two_positioning_regions() TO mt_1b_definer;

-- public.enforce_occurrence_recebido_lock()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.enforce_occurrence_recebido_lock() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_occurrence_recebido_lock() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_occurrence_recebido_lock() TO postgres;
GRANT EXECUTE ON FUNCTION public.enforce_occurrence_recebido_lock() TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_occurrence_recebido_lock() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_occurrence_recebido_lock() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_occurrence_recebido_lock() TO mt_1b_definer;

-- public.enforce_profiles_ativo_lock()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.enforce_profiles_ativo_lock() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_profiles_ativo_lock() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_profiles_ativo_lock() TO postgres;
GRANT EXECUTE ON FUNCTION public.enforce_profiles_ativo_lock() TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_profiles_ativo_lock() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_profiles_ativo_lock() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_profiles_ativo_lock() TO mt_1b_definer;

-- public.enforce_room_reservation_booking_block()  antes: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.enforce_room_reservation_booking_block() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_room_reservation_booking_block() TO postgres;
GRANT EXECUTE ON FUNCTION public.enforce_room_reservation_booking_block() TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_room_reservation_booking_block() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_room_reservation_booking_block() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_room_reservation_booking_block() TO mt_1b_definer;

-- public.enforce_room_reservation_cancellation_deadline()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.enforce_room_reservation_cancellation_deadline() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_room_reservation_cancellation_deadline() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_room_reservation_cancellation_deadline() TO postgres;
GRANT EXECUTE ON FUNCTION public.enforce_room_reservation_cancellation_deadline() TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_room_reservation_cancellation_deadline() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_room_reservation_cancellation_deadline() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_room_reservation_cancellation_deadline() TO mt_1b_definer;

-- public.enforce_sale_comissao_lock()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.enforce_sale_comissao_lock() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_sale_comissao_lock() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_sale_comissao_lock() TO postgres;
GRANT EXECUTE ON FUNCTION public.enforce_sale_comissao_lock() TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_sale_comissao_lock() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_sale_comissao_lock() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_sale_comissao_lock() TO mt_1b_definer;

-- public.enforce_team_co_leader_role()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.enforce_team_co_leader_role() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_team_co_leader_role() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_team_co_leader_role() TO postgres;
GRANT EXECUTE ON FUNCTION public.enforce_team_co_leader_role() TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_team_co_leader_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_team_co_leader_role() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_team_co_leader_role() TO mt_1b_definer;

-- public.enforce_team_depth()  antes: {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.enforce_team_depth() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_team_depth() TO postgres;
GRANT EXECUTE ON FUNCTION public.enforce_team_depth() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_team_depth() TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_team_depth() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_team_depth() TO mt_1b_definer;

-- public.enforce_team_leader_role()  antes: {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.enforce_team_leader_role() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_team_leader_role() TO postgres;
GRANT EXECUTE ON FUNCTION public.enforce_team_leader_role() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_team_leader_role() TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_team_leader_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_team_leader_role() TO mt_1b_definer;

-- public.enforce_user_roles_self_update_lock()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.enforce_user_roles_self_update_lock() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_user_roles_self_update_lock() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_user_roles_self_update_lock() TO postgres;
GRANT EXECUTE ON FUNCTION public.enforce_user_roles_self_update_lock() TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_user_roles_self_update_lock() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_user_roles_self_update_lock() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_user_roles_self_update_lock() TO mt_1b_definer;

-- public.exclusive_actor_active(uuid)  antes: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.exclusive_actor_active(uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_actor_active(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.exclusive_actor_active(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.exclusive_actor_active(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_actor_active(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_actor_active(uuid) TO mt_1b_definer;

-- public.exclusive_can_view(uuid,uuid)  antes: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.exclusive_can_view(uuid,uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_can_view(uuid,uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.exclusive_can_view(uuid,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.exclusive_can_view(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_can_view(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_can_view(uuid,uuid) TO mt_1b_definer;

-- public.exclusive_capture_enabled()  antes: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.exclusive_capture_enabled() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_capture_enabled() TO postgres;
GRANT EXECUTE ON FUNCTION public.exclusive_capture_enabled() TO anon;
GRANT EXECUTE ON FUNCTION public.exclusive_capture_enabled() TO authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_capture_enabled() TO service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_capture_enabled() TO mt_1b_definer;

-- public.exclusive_is_editor(uuid,uuid)  antes: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.exclusive_is_editor(uuid,uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_is_editor(uuid,uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.exclusive_is_editor(uuid,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.exclusive_is_editor(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_is_editor(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_is_editor(uuid,uuid) TO mt_1b_definer;

-- public.exclusive_is_manager(uuid,uuid)  antes: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.exclusive_is_manager(uuid,uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_is_manager(uuid,uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.exclusive_is_manager(uuid,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.exclusive_is_manager(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_is_manager(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_is_manager(uuid,uuid) TO mt_1b_definer;

-- public.exclusive_norm_address(text)  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
REVOKE ALL ON FUNCTION public.exclusive_norm_address(text) FROM PUBLIC, anon, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_norm_address(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclusive_norm_address(text) TO postgres;
GRANT EXECUTE ON FUNCTION public.exclusive_norm_address(text) TO anon;
GRANT EXECUTE ON FUNCTION public.exclusive_norm_address(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_norm_address(text) TO service_role;

-- public.exclusive_plan_prazo_dias(text)  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
REVOKE ALL ON FUNCTION public.exclusive_plan_prazo_dias(text) FROM PUBLIC, anon, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_plan_prazo_dias(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclusive_plan_prazo_dias(text) TO postgres;
GRANT EXECUTE ON FUNCTION public.exclusive_plan_prazo_dias(text) TO anon;
GRANT EXECUTE ON FUNCTION public.exclusive_plan_prazo_dias(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_plan_prazo_dias(text) TO service_role;

-- public.exclusive_plan_semanas(jsonb,uuid)  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
REVOKE ALL ON FUNCTION public.exclusive_plan_semanas(jsonb,uuid) FROM PUBLIC, anon, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_plan_semanas(jsonb,uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclusive_plan_semanas(jsonb,uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.exclusive_plan_semanas(jsonb,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.exclusive_plan_semanas(jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_plan_semanas(jsonb,uuid) TO service_role;

-- public.exclusive_profile_registration()  antes: {mt_1b_definer=X/mt_1b_definer,anon=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.exclusive_profile_registration() FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_profile_registration() TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.exclusive_profile_registration() TO anon;
GRANT EXECUTE ON FUNCTION public.exclusive_profile_registration() TO authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_profile_registration() TO service_role;

-- public.exclusive_proxima_segunda()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
REVOKE ALL ON FUNCTION public.exclusive_proxima_segunda() FROM PUBLIC, anon, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_proxima_segunda() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclusive_proxima_segunda() TO postgres;
GRANT EXECUTE ON FUNCTION public.exclusive_proxima_segunda() TO anon;
GRANT EXECUTE ON FUNCTION public.exclusive_proxima_segunda() TO authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_proxima_segunda() TO service_role;

-- public.exclusive_register_document(uuid,text,integer,text,text)  antes: {mt_1b_definer=X/mt_1b_definer,anon=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.exclusive_register_document(uuid,text,integer,text,text) FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_register_document(uuid,text,integer,text,text) TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.exclusive_register_document(uuid,text,integer,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.exclusive_register_document(uuid,text,integer,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_register_document(uuid,text,integer,text,text) TO service_role;

-- public.exclusive_required_fields(jsonb,text,text)  antes: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.exclusive_required_fields(jsonb,text,text) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_required_fields(jsonb,text,text) TO postgres;
GRANT EXECUTE ON FUNCTION public.exclusive_required_fields(jsonb,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.exclusive_required_fields(jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_required_fields(jsonb,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_required_fields(jsonb,text,text) TO mt_1b_definer;

-- public.exclusive_save(uuid,jsonb,text,text)  antes: {mt_1b_definer=X/mt_1b_definer,anon=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.exclusive_save(uuid,jsonb,text,text) FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_save(uuid,jsonb,text,text) TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.exclusive_save(uuid,jsonb,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.exclusive_save(uuid,jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_save(uuid,jsonb,text,text) TO service_role;

-- public.exclusive_transition(uuid,text,text)  antes: {mt_1b_definer=X/mt_1b_definer,anon=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.exclusive_transition(uuid,text,text) FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_transition(uuid,text,text) TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.exclusive_transition(uuid,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.exclusive_transition(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_transition(uuid,text,text) TO service_role;

-- public.exclusive_valid_cpf(text)  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.exclusive_valid_cpf(text) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_valid_cpf(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.exclusive_valid_cpf(text) TO postgres;
GRANT EXECUTE ON FUNCTION public.exclusive_valid_cpf(text) TO anon;
GRANT EXECUTE ON FUNCTION public.exclusive_valid_cpf(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exclusive_valid_cpf(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_valid_cpf(text) TO mt_1b_definer;

-- public.get_room_reservation_cancellation_status(uuid)  antes: {mt_1b_definer=X/mt_1b_definer,anon=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.get_room_reservation_cancellation_status(uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.get_room_reservation_cancellation_status(uuid) TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.get_room_reservation_cancellation_status(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_room_reservation_cancellation_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_room_reservation_cancellation_status(uuid) TO service_role;

-- public.handle_new_user()  antes: {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO anon;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO mt_1b_definer;

-- public.has_any_role(uuid,public.app_role[])  antes: {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.has_any_role(uuid,public.app_role[]) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid,public.app_role[]) TO postgres;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid,public.app_role[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid,public.app_role[]) TO anon;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid,public.app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid,public.app_role[]) TO mt_1b_definer;

-- public.has_role(uuid,public.app_role)  antes: {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.has_role(uuid,public.app_role) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) TO postgres;
GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) TO anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) TO mt_1b_definer;

-- public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text)  antes: {mt_1b_definer=X/mt_1b_definer,anon=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text) FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text) TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text) TO anon;
GRANT EXECUTE ON FUNCTION public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text) TO service_role;

-- public.is_active_user(uuid)  antes: {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.is_active_user(uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_user(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.is_active_user(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_active_user(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_active_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_user(uuid) TO mt_1b_definer;

-- public.is_lead_of(uuid,uuid)  antes: {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.is_lead_of(uuid,uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.is_lead_of(uuid,uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.is_lead_of(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_lead_of(uuid,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_lead_of(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_lead_of(uuid,uuid) TO mt_1b_definer;

-- public.is_sale_locked(uuid)  antes: {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.is_sale_locked(uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.is_sale_locked(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.is_sale_locked(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_sale_locked(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_sale_locked(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_sale_locked(uuid) TO mt_1b_definer;

-- public.leads_team_or_parent(uuid,uuid)  antes: {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.leads_team_or_parent(uuid,uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.leads_team_or_parent(uuid,uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.leads_team_or_parent(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.leads_team_or_parent(uuid,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.leads_team_or_parent(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leads_team_or_parent(uuid,uuid) TO mt_1b_definer;

-- public.list_active_corretores()  antes: {mt_1b_definer=X/mt_1b_definer,anon=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.list_active_corretores() FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.list_active_corretores() TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.list_active_corretores() TO anon;
GRANT EXECUTE ON FUNCTION public.list_active_corretores() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_corretores() TO service_role;

-- public.list_active_gestores()  antes: {mt_1b_definer=X/mt_1b_definer,anon=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.list_active_gestores() FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.list_active_gestores() TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.list_active_gestores() TO anon;
GRANT EXECUTE ON FUNCTION public.list_active_gestores() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_gestores() TO service_role;

-- public.list_active_team_leaders()  antes: {mt_1b_definer=X/mt_1b_definer,anon=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.list_active_team_leaders() FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.list_active_team_leaders() TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.list_active_team_leaders() TO anon;
GRANT EXECUTE ON FUNCTION public.list_active_team_leaders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_team_leaders() TO service_role;

-- public.list_active_users()  antes: {mt_1b_definer=X/mt_1b_definer,anon=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.list_active_users() FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.list_active_users() TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.list_active_users() TO anon;
GRANT EXECUTE ON FUNCTION public.list_active_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_users() TO service_role;

-- public.log_role_change()  antes: {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.log_role_change() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.log_role_change() TO postgres;
GRANT EXECUTE ON FUNCTION public.log_role_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.log_role_change() TO anon;
GRANT EXECUTE ON FUNCTION public.log_role_change() TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_role_change() TO mt_1b_definer;

-- public.mt_1e_member_lock()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
REVOKE ALL ON FUNCTION public.mt_1e_member_lock() FROM PUBLIC, anon, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.mt_1e_member_lock() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.mt_1e_member_lock() TO postgres;
GRANT EXECUTE ON FUNCTION public.mt_1e_member_lock() TO anon;
GRANT EXECUTE ON FUNCTION public.mt_1e_member_lock() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mt_1e_member_lock() TO service_role;

-- public.mt_2c_public_org()  antes: {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
REVOKE ALL ON FUNCTION public.mt_2c_public_org() FROM PUBLIC, anon, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.mt_2c_public_org() TO postgres;
GRANT EXECUTE ON FUNCTION public.mt_2c_public_org() TO anon;
GRANT EXECUTE ON FUNCTION public.mt_2c_public_org() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mt_2c_public_org() TO service_role;

-- public.photo_voucher_vencimento(date)  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
REVOKE ALL ON FUNCTION public.photo_voucher_vencimento(date) FROM PUBLIC, anon, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.photo_voucher_vencimento(date) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.photo_voucher_vencimento(date) TO postgres;
GRANT EXECUTE ON FUNCTION public.photo_voucher_vencimento(date) TO anon;
GRANT EXECUTE ON FUNCTION public.photo_voucher_vencimento(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.photo_voucher_vencimento(date) TO service_role;

-- public.portal_code_key(text)  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
REVOKE ALL ON FUNCTION public.portal_code_key(text) FROM PUBLIC, anon, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.portal_code_key(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_code_key(text) TO postgres;
GRANT EXECUTE ON FUNCTION public.portal_code_key(text) TO anon;
GRANT EXECUTE ON FUNCTION public.portal_code_key(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_code_key(text) TO service_role;

-- public.record_user_preview_event(uuid,text)  antes: {mt_1b_definer=X/mt_1b_definer,anon=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.record_user_preview_event(uuid,text) FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.record_user_preview_event(uuid,text) TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.record_user_preview_event(uuid,text) TO anon;
GRANT EXECUTE ON FUNCTION public.record_user_preview_event(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_user_preview_event(uuid,text) TO service_role;

-- public.sees_own_team_leader(uuid,uuid)  antes: {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.sees_own_team_leader(uuid,uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.sees_own_team_leader(uuid,uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.sees_own_team_leader(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sees_own_team_leader(uuid,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.sees_own_team_leader(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sees_own_team_leader(uuid,uuid) TO mt_1b_definer;

-- public.sees_team(uuid,uuid)  antes: {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.sees_team(uuid,uuid) FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.sees_team(uuid,uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.sees_team(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sees_team(uuid,uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.sees_team(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sees_team(uuid,uuid) TO mt_1b_definer;

-- public.set_updated_at()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO postgres;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO mt_1b_definer;

-- public.trg_sale_commission_extras_sync_ocorrencia()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.trg_sale_commission_extras_sync_ocorrencia() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.trg_sale_commission_extras_sync_ocorrencia() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_sale_commission_extras_sync_ocorrencia() TO postgres;
GRANT EXECUTE ON FUNCTION public.trg_sale_commission_extras_sync_ocorrencia() TO anon;
GRANT EXECUTE ON FUNCTION public.trg_sale_commission_extras_sync_ocorrencia() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_sale_commission_extras_sync_ocorrencia() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_sale_commission_extras_sync_ocorrencia() TO mt_1b_definer;

-- public.trg_sale_payment_sync_ocorrencia()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.trg_sale_payment_sync_ocorrencia() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.trg_sale_payment_sync_ocorrencia() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_sale_payment_sync_ocorrencia() TO postgres;
GRANT EXECUTE ON FUNCTION public.trg_sale_payment_sync_ocorrencia() TO anon;
GRANT EXECUTE ON FUNCTION public.trg_sale_payment_sync_ocorrencia() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_sale_payment_sync_ocorrencia() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_sale_payment_sync_ocorrencia() TO mt_1b_definer;

-- public.trg_sales_sync_antes_financeiro()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.trg_sales_sync_antes_financeiro() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.trg_sales_sync_antes_financeiro() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_sales_sync_antes_financeiro() TO postgres;
GRANT EXECUTE ON FUNCTION public.trg_sales_sync_antes_financeiro() TO anon;
GRANT EXECUTE ON FUNCTION public.trg_sales_sync_antes_financeiro() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_sales_sync_antes_financeiro() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_sales_sync_antes_financeiro() TO mt_1b_definer;

-- public.trg_sincronizar_financeiro_ocorrencia_da_venda()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.trg_sincronizar_financeiro_ocorrencia_da_venda() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.trg_sincronizar_financeiro_ocorrencia_da_venda() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_sincronizar_financeiro_ocorrencia_da_venda() TO postgres;
GRANT EXECUTE ON FUNCTION public.trg_sincronizar_financeiro_ocorrencia_da_venda() TO anon;
GRANT EXECUTE ON FUNCTION public.trg_sincronizar_financeiro_ocorrencia_da_venda() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_sincronizar_financeiro_ocorrencia_da_venda() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_sincronizar_financeiro_ocorrencia_da_venda() TO mt_1b_definer;

-- public.trg_sincronizar_previsao_ocorrencia_pendente()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.trg_sincronizar_previsao_ocorrencia_pendente() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.trg_sincronizar_previsao_ocorrencia_pendente() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_sincronizar_previsao_ocorrencia_pendente() TO postgres;
GRANT EXECUTE ON FUNCTION public.trg_sincronizar_previsao_ocorrencia_pendente() TO anon;
GRANT EXECUTE ON FUNCTION public.trg_sincronizar_previsao_ocorrencia_pendente() TO authenticated;
GRANT EXECUTE ON FUNCTION public.trg_sincronizar_previsao_ocorrencia_pendente() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_sincronizar_previsao_ocorrencia_pendente() TO mt_1b_definer;

-- public.update_contrato_pendencia(uuid,text,boolean)  antes: {mt_1b_definer=X/mt_1b_definer,authenticated=X/mt_1b_definer,service_role=X/mt_1b_definer,anon=X/mt_1b_definer}
REVOKE ALL ON FUNCTION public.update_contrato_pendencia(uuid,text,boolean) FROM PUBLIC, anon, authenticated, mt_1b_definer, service_role;
GRANT EXECUTE ON FUNCTION public.update_contrato_pendencia(uuid,text,boolean) TO mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.update_contrato_pendencia(uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_contrato_pendencia(uuid,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_contrato_pendencia(uuid,text,boolean) TO anon;

-- public.validar_dados_financeiros_ocorrencia()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.validar_dados_financeiros_ocorrencia() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.validar_dados_financeiros_ocorrencia() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.validar_dados_financeiros_ocorrencia() TO postgres;
GRANT EXECUTE ON FUNCTION public.validar_dados_financeiros_ocorrencia() TO anon;
GRANT EXECUTE ON FUNCTION public.validar_dados_financeiros_ocorrencia() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validar_dados_financeiros_ocorrencia() TO service_role;
GRANT EXECUTE ON FUNCTION public.validar_dados_financeiros_ocorrencia() TO mt_1b_definer;

-- public.validar_data_venda_lancamento_mes_atual()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.validar_data_venda_lancamento_mes_atual() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.validar_data_venda_lancamento_mes_atual() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.validar_data_venda_lancamento_mes_atual() TO postgres;
GRANT EXECUTE ON FUNCTION public.validar_data_venda_lancamento_mes_atual() TO anon;
GRANT EXECUTE ON FUNCTION public.validar_data_venda_lancamento_mes_atual() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validar_data_venda_lancamento_mes_atual() TO service_role;
GRANT EXECUTE ON FUNCTION public.validar_data_venda_lancamento_mes_atual() TO mt_1b_definer;

-- public.validar_distribuicao_antes_aprovar_gestor()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.validar_distribuicao_antes_aprovar_gestor() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_aprovar_gestor() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_aprovar_gestor() TO postgres;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_aprovar_gestor() TO anon;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_aprovar_gestor() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_aprovar_gestor() TO service_role;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_aprovar_gestor() TO mt_1b_definer;

-- public.validar_distribuicao_antes_concluir_lancamento()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.validar_distribuicao_antes_concluir_lancamento() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_concluir_lancamento() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_concluir_lancamento() TO postgres;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_concluir_lancamento() TO anon;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_concluir_lancamento() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_concluir_lancamento() TO service_role;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_concluir_lancamento() TO mt_1b_definer;

-- public.validar_distribuicao_antes_transicao_critica_occ()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.validar_distribuicao_antes_transicao_critica_occ() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_transicao_critica_occ() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_transicao_critica_occ() TO postgres;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_transicao_critica_occ() TO anon;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_transicao_critica_occ() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_transicao_critica_occ() TO service_role;
GRANT EXECUTE ON FUNCTION public.validar_distribuicao_antes_transicao_critica_occ() TO mt_1b_definer;

-- public.validar_percentual_valor_comissao_lancamento()  antes: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.validar_percentual_valor_comissao_lancamento() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.validar_percentual_valor_comissao_lancamento() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.validar_percentual_valor_comissao_lancamento() TO postgres;
GRANT EXECUTE ON FUNCTION public.validar_percentual_valor_comissao_lancamento() TO anon;
GRANT EXECUTE ON FUNCTION public.validar_percentual_valor_comissao_lancamento() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validar_percentual_valor_comissao_lancamento() TO service_role;
GRANT EXECUTE ON FUNCTION public.validar_percentual_valor_comissao_lancamento() TO mt_1b_definer;

-- public.validate_sale_status_transition()  antes: {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,mt_1b_definer=X/postgres}
REVOKE ALL ON FUNCTION public.validate_sale_status_transition() FROM PUBLIC, anon, authenticated, mt_1b_definer, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.validate_sale_status_transition() TO postgres;
GRANT EXECUTE ON FUNCTION public.validate_sale_status_transition() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_sale_status_transition() TO anon;
GRANT EXECUTE ON FUNCTION public.validate_sale_status_transition() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_sale_status_transition() TO mt_1b_definer;

-- Default privileges (funções novas criadas pelo papel postgres)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA academia REVOKE EXECUTE ON FUNCTIONS FROM authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

COMMIT;
