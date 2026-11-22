# Funções executáveis sem login (anon) — inventário de produção 22/11/2026 (t_44f96aed)

Fonte: `pg_proc.proacl` lido em produção (só leitura). Uso no código: busca em `src/`, `server/`, `supabase/functions/`, `scripts/` e `e2e/` (main 3389858). Chamadas anon: `edge_logs` de 30 dias, só requisições sem usuário com papel anon (status×quantidade).

Tabelas, views e sequences abertas ao anon nos schemas expostos (public, academia, graphql_public): **0**.

Funções abertas ao anon: **81** = 80 em `public` + `graphql_public.graphql` (da Supabase, dono supabase_admin; fora do alcance do papel postgres; sem efeito porque nenhuma tabela é legível pelo anon).

Resultado: **74 fechadas**, **6 mantidas públicas** (+ a do GraphQL da Supabase).

| Função | Tipo | Decisão | Uso no código | Chamadas anon 30d | PUBLIC antes |
|---|---|---|---|---|---|
| `public.depoimentos_publicos()` | pública (mantida) | MANTIDA — Vitrine de depoimentos do site (somosunihub.com.br, sem login). Confirmado: 255 chamadas anon em 30 dias + teste depoimentos.test.ts. | — | 200×255 | não |
| `public.list_public_org_regions(text)` | pública (mantida) | MANTIDA — Página pública /especialistas/$slug (positioning-db.ts). Confirmado: 111 chamadas anon em 30 dias. | src/lib/positioning-db.ts | 200×111 | não |
| `public.list_public_org_specialists(text,text,bigint)` | pública (mantida) | MANTIDA — Página pública /especialistas/$slug (positioning-db.ts). Confirmado: 155 chamadas anon em 30 dias. | src/lib/positioning-db.ts scripts/especialistas-test/check_rollback.sql | 200×155 | não |
| `public.list_public_positioning_regions()` | pública (mantida) | MANTIDA — NÃO CONFIRMADO: versão antiga da página de especialistas; o ADM não chama mais, mas houve 17 chamadas anon em 30 dias (última 07/11, sem origem). Mantida aberta por dúvida. | — | 200×17 | não |
| `public.list_public_specialist_agencies()` | pública (mantida) | MANTIDA — Página pública /especialistas (positioning-db.ts). Confirmado: 283 chamadas anon em 30 dias. | src/lib/positioning-db.ts | 200×283 | não |
| `public.list_public_specialists(text,bigint)` | pública (mantida) | MANTIDA — NÃO CONFIRMADO: versão antiga da página de especialistas; o ADM não chama mais, mas houve 89 chamadas anon em 30 dias (última 07/11, sem origem). Mantida aberta por dúvida. | — | 200×89 | não |
| `public.can_edit_sale_stage(uuid,uuid)` | auxiliar de permissão/RLS (usada em políticas ou pelo app logado) | fechada | scripts/test-relatorio-ocorrencias-sql.mjs | 0 | não |
| `public.can_view_sale(uuid,uuid)` | auxiliar de permissão/RLS (usada em políticas ou pelo app logado) | fechada | — | 0 | não |
| `public.exclusive_actor_active(uuid)` | auxiliar de permissão/RLS (usada em políticas ou pelo app logado) | fechada | — | 0 | não |
| `public.exclusive_can_view(uuid,uuid)` | auxiliar de permissão/RLS (usada em políticas ou pelo app logado) | fechada | — | 0 | não |
| `public.exclusive_capture_enabled()` | auxiliar de permissão/RLS (usada em políticas ou pelo app logado) | fechada | src/lib/exclusive-captures-db.ts src/lib/exclusive-capture-settings.ts e2e/mapa-captacoes/mock-supabase.mjs e2e/vouchers… | 200×313, 521×1 | não |
| `public.exclusive_is_editor(uuid,uuid)` | auxiliar de permissão/RLS (usada em políticas ou pelo app logado) | fechada | src/lib/captacao-remover-documento.functions.ts | 0 | não |
| `public.exclusive_is_manager(uuid,uuid)` | auxiliar de permissão/RLS (usada em políticas ou pelo app logado) | fechada | — | 0 | não |
| `public.has_any_role(uuid,public.app_role[])` | auxiliar de permissão/RLS (usada em políticas ou pelo app logado) | fechada | src/lib/excluir-venda.functions.ts scripts/test-relatorio-ocorrencias-sql.mjs | 0 | não |
| `public.has_role(uuid,public.app_role)` | auxiliar de permissão/RLS (usada em políticas ou pelo app logado) | fechada | — | 0 | não |
| `public.is_active_user(uuid)` | auxiliar de permissão/RLS (usada em políticas ou pelo app logado) | fechada | src/lib/excluir-venda.functions.ts | 0 | não |
| `public.is_lead_of(uuid,uuid)` | auxiliar de permissão/RLS (usada em políticas ou pelo app logado) | fechada | src/lib/user-management.server.ts src/lib/excluir-venda.functions.ts | 0 | não |
| `public.is_sale_locked(uuid)` | auxiliar de permissão/RLS (usada em políticas ou pelo app logado) | fechada | scripts/test-relatorio-ocorrencias-sql.mjs | 0 | não |
| `public.leads_team_or_parent(uuid,uuid)` | auxiliar de permissão/RLS (usada em políticas ou pelo app logado) | fechada | scripts/test-relatorio-ocorrencias-sql.mjs | 0 | não |
| `public.sees_own_team_leader(uuid,uuid)` | auxiliar de permissão/RLS (usada em políticas ou pelo app logado) | fechada | scripts/test-relatorio-ocorrencias-sql.mjs | 0 | não |
| `public.sees_team(uuid,uuid)` | auxiliar de permissão/RLS (usada em políticas ou pelo app logado) | fechada | scripts/test-relatorio-ocorrencias-sql.mjs | 0 | não |
| `public.archive_sale_document(uuid)` | ação de tela logada | fechada | src/lib/partes-venda.ts src/components/vendas/DocumentsPanel.tsx | 0 | não |
| `public.cancel_room_reservation(uuid)` | ação de tela logada | fechada | src/routes/_authenticated/reservas-salas.tsx | 0 | não |
| `public.change_sale_status(uuid,text,text)` | ação de tela logada | fechada | src/routes/_authenticated/vendas.$id.tsx src/components/vendas/LancamentoDetail.tsx e2e/venda-campo-faltante/mock-supaba… | 0 | não |
| `public.cliente_historico(uuid,uuid)` | ação de tela logada | fechada | src/components/vendas/PartiesStep.tsx | 0 | não |
| `public.criar_ocorrencia_completa(uuid)` | ação de tela logada | fechada | src/routes/_authenticated/vendas.$id.tsx | 0 | sim |
| `public.criar_ocorrencia_lancamento(uuid)` | ação de tela logada | fechada | src/components/vendas/LancamentoDetail.tsx | 0 | não |
| `public.exclusive_profile_registration()` | ação de tela logada | fechada | src/lib/exclusive-captures-db.ts e2e/vouchers-fotos-prints/mock-supabase.mjs e2e/data-nascimento-prints/mock-supabase.mj… | 0 | não |
| `public.exclusive_register_document(uuid,text,integer,text,text)` | ação de tela logada | fechada | src/lib/exclusive-captures-db.ts e2e/varios-proprietarios/mock-supabase.mjs e2e/captacao-sem-creci/mock-supabase.mjs e2e… | 0 | não |
| `public.exclusive_save(uuid,jsonb,text,text)` | ação de tela logada | fechada | src/lib/exclusive-captures-db.ts e2e/varios-proprietarios/mock-supabase.mjs e2e/captacao-sem-creci/mock-supabase.mjs e2e… | 0 | não |
| `public.exclusive_transition(uuid,text,text)` | ação de tela logada | fechada | src/lib/exclusive-captures-db.ts | 0 | não |
| `public.get_room_reservation_cancellation_status(uuid)` | ação de tela logada | fechada | src/routes/_authenticated/reservas-salas.tsx e2e/vouchers-fotos-prints/mock-supabase.mjs | 0 | não |
| `public.insert_sale_document(uuid,text,text,text,text,public.doc_status,text,text)` | ação de tela logada | fechada | src/lib/proposta-compra-db.ts src/components/vendas/DocumentsPanel.tsx | 0 | não |
| `public.list_active_corretores()` | ação de tela logada | fechada | src/routes/_authenticated/vendas.$id.tsx src/components/vendas/LancamentoDetail.tsx | 0 | não |
| `public.list_active_gestores()` | ação de tela logada | fechada | src/routes/_authenticated/vendas.$id.tsx src/components/vendas/LancamentoDetail.tsx | 0 | não |
| `public.list_active_team_leaders()` | ação de tela logada | fechada | src/routes/_authenticated/vendas.$id.tsx src/components/vendas/LancamentoDetail.tsx | 0 | não |
| `public.list_active_users()` | ação de tela logada | fechada | src/routes/_authenticated/vendas.$id.tsx | 0 | não |
| `public.record_user_preview_event(uuid,text)` | ação de tela logada | fechada | — | 0 | não |
| `public.update_contrato_pendencia(uuid,text,boolean)` | ação de tela logada | fechada | src/routes/_authenticated/vendas.$id.tsx | 0 | não |
| `public.audit_operational_impersonation_action()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.bloquear_avanco_com_previsao_incompleta()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.bloquear_avanco_sem_endereco()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.bloquear_participacao_extra_vazia()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.destravar_ocorrencia_ao_devolver_gestor()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.enforce_max_two_positioning_regions()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.enforce_occurrence_recebido_lock()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.enforce_profiles_ativo_lock()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.enforce_room_reservation_booking_block()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | não |
| `public.enforce_room_reservation_cancellation_deadline()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.enforce_sale_comissao_lock()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.enforce_team_co_leader_role()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.enforce_team_depth()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | não |
| `public.enforce_team_leader_role()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | não |
| `public.enforce_user_roles_self_update_lock()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.handle_new_user()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | scripts/demo/README-demo-org.md | 0 | não |
| `public.log_role_change()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | não |
| `public.mt_1e_member_lock()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.set_updated_at()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.trg_sale_commission_extras_sync_ocorrencia()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.trg_sale_payment_sync_ocorrencia()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.trg_sales_sync_antes_financeiro()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.trg_sincronizar_financeiro_ocorrencia_da_venda()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.trg_sincronizar_previsao_ocorrencia_pendente()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.validar_dados_financeiros_ocorrencia()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.validar_data_venda_lancamento_mes_atual()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.validar_distribuicao_antes_aprovar_gestor()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.validar_distribuicao_antes_concluir_lancamento()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.validar_distribuicao_antes_transicao_critica_occ()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.validar_percentual_valor_comissao_lancamento()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | sim |
| `public.validate_sale_status_transition()` | gatilho (trigger): roda sozinho na gravação, nunca é chamada pela API | fechada | — | 0 | não |
| `public.clicksign_data_br(timestamp with time zone)` | utilitário interno (cálculo/formatação usado por outras funções) | fechada | — | 0 | sim |
| `public.exclusive_norm_address(text)` | utilitário interno (cálculo/formatação usado por outras funções) | fechada | — | 0 | sim |
| `public.exclusive_plan_prazo_dias(text)` | utilitário interno (cálculo/formatação usado por outras funções) | fechada | — | 0 | sim |
| `public.exclusive_plan_semanas(jsonb,uuid)` | utilitário interno (cálculo/formatação usado por outras funções) | fechada | — | 0 | sim |
| `public.exclusive_proxima_segunda()` | utilitário interno (cálculo/formatação usado por outras funções) | fechada | — | 0 | sim |
| `public.exclusive_required_fields(jsonb,text,text)` | utilitário interno (cálculo/formatação usado por outras funções) | fechada | — | 0 | não |
| `public.exclusive_valid_cpf(text)` | utilitário interno (cálculo/formatação usado por outras funções) | fechada | — | 0 | sim |
| `public.mt_2c_public_org()` | utilitário interno (cálculo/formatação usado por outras funções) | fechada | — | 0 | não |
| `public.photo_voucher_vencimento(date)` | utilitário interno (cálculo/formatação usado por outras funções) | fechada | — | 0 | sim |
| `public.portal_code_key(text)` | utilitário interno (cálculo/formatação usado por outras funções) | fechada | — | 0 | sim |
