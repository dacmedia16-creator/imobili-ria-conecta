# ADM: funções SECURITY DEFINER executáveis por anon (t_8f7aa245, 11/10/2026)

Este documento traz só levantamento e recomendação. Nenhuma alteração foi aplicada.

Fonte:
- `pg_proc` com `has_function_privilege('anon', …)` no projeto xvvymgurpchhlmbpjbgc;
- `pg_policies`;
- busca do nome da RPC em `src/`, `server/` e `supabase/functions` no origin/main 4ab373f.

Resultado: 218 funções SECDEF em `public`. Destas, **52 podem ser executadas por anon**, porque a ACL padrão do Postgres concede EXECUTE a PUBLIC e o Supabase ainda dá grant explícito a anon.

As policies que valem para anon ou PUBLIC são só 2, ambas em `cron.job` e `cron.job_run_details` e sem relação com estas funções. As demais policies do ADM já são `TO authenticated`. Por isso, nenhuma checagem de RLS feita por anon depende destas funções.

## Classificação

| Grupo | Qtde | Funções | Recomendação |
|---|---|---|---|
| Página pública `/especialistas` | 2 | list_public_specialists, list_public_positioning_regions | **Manter anon.** Ambas devolvem dados públicos de propósito (nome, foto, telefone e links dos especialistas que ativaram o perfil público). |
| Helper interno das públicas | 1 | mt_2c_public_org | Revogar anon. Só é chamada dentro das 2 funções acima, que já são SECDEF e rodam como dono, então não precisa de grant próprio. |
| Triggers | 14 | audit_operational_impersonation_action, destravar_ocorrencia_ao_devolver_gestor, enforce_room_reservation_booking_block, enforce_team_co_leader_role, enforce_team_depth, enforce_team_leader_role, handle_new_user, log_role_change, trg_sale_commission_extras_sync_ocorrencia, trg_sale_payment_sync_ocorrencia, trg_sales_sync_antes_financeiro, trg_sincronizar_financeiro_ocorrencia_da_venda, trg_sincronizar_previsao_ocorrencia_pendente, validate_sale_status_transition | Revogar de PUBLIC, anon e authenticated. O disparo do trigger não verifica EXECUTE. |
| Helpers de policy (RLS só `TO authenticated`) | 14 | can_edit_sale_stage, can_view_sale, exclusive_actor_active, exclusive_can_view, exclusive_is_editor, exclusive_is_manager, has_any_role, has_role, is_active_user, is_lead_of, is_sale_locked, leads_team_or_parent, sees_own_team_leader, sees_team | Revogar anon e manter authenticated. `is_lead_of` também é usada em `user-management.server.ts` (sessão autenticada). |
| RPCs de telas logadas (`/_authenticated`, server functions) | 21 | archive_sale_document, cancel_room_reservation, change_sale_status, cliente_historico, criar_ocorrencia_lancamento, exclusive_capture_enabled, exclusive_profile_registration, exclusive_register_document, exclusive_save, exclusive_transition, get_room_reservation_cancellation_status, insert_sale_document, list_active_corretores, list_active_gestores, list_active_team_leaders, list_active_users, record_user_preview_event, review_positioning_region_suggestion, save_my_positioning, submit_positioning_region_suggestion, update_contrato_pendencia | Revogar anon e manter authenticated. |

Em resumo: das 52, **2 precisam continuar públicas e 50 podem perder o acesso anon**.

## Risco real hoje

É baixo. Quase todas as RPCs validam `auth.uid()` ou o papel antes de agir. Os triggers não fazem nada fora do contexto de um trigger e falham se forem chamados direto.

As funções `list_active_*` e `cliente_historico` devolvem pessoas, mas filtram por `is_active_user(auth.uid())`, conferido no corpo implantado. Para anon, retornam vazio.

O ganho é reduzir a superfície exposta e zerar o aviso `0028 anon_security_definer_function_executable` do Advisor.

## Como aplicar quando aprovado

1. Abrir uma migration no mesmo formato da migration do Visita (`20261012090000_hardening_secdef_anon.sql`, no repositório visitaprova):
   - `revoke … from public, anon` e `grant … to authenticated, service_role` para os helpers e RPCs;
   - `revoke … from public, anon, authenticated` para os triggers.
2. Antes de aplicar, testar em transação desfeita:
   - leitura de todas as tabelas como anon, como corretor e como gestor;
   - chamada das RPCs públicas como anon;
   - smoke em `/especialistas`.
3. Fazer o rollback com `grant execute … to public, anon, authenticated, service_role` nas 50 funções.
