# Migrations multiempresa aplicadas em PRODUÇÃO (xvvymgurpchhlmbpjbgc)

Este trilho (`supabase/multiempresa/migrations`) é aplicado por SQL direto e NÃO entra em
`supabase_migrations.schema_migrations` (o `db push` só enxerga `supabase/migrations`).
Antes de aplicar qualquer arquivo daqui, confira esta lista E o estado real do banco.

| Versão | Arquivo | Aplicada em (UTC) | Conferência |
|---|---|---|---|
| 1a…2h | janela multiempresa (ver docs/PLANO_EXECUCAO_MIGRACAO_PRODUCAO_ADM_MAX.md §10) | 2026-10-01 noite | runbook |
| 20261002000002 | mt_platform_context | 2026-10-02 ~09:20 | função platform_enter_org existe; teste Denis aprovado |
| 20261002000003 | mt_p2_indices_rls_authenticated | 2026-10-02 ~09:20 | 0 policies TO public; números dos painéis idênticos |
| 20261002000004 | mt_leitor_amplo_rls_rapida | 2026-10-02 ~11:50 | 6 policies zz_mt_leitor_amplo_select; números de 4 perfis idênticos antes/depois; backup pre-leitor-amplo-20261002T113742Z.dump |

Não aplicada em produção: 20261002000001_mt_dashboard_movimentacao_hist_materialized (só preparada).

Backup completo pós-publicação: `/root/.config/max/adm-max-prod-backups/pos-plataforma-20261002T102908Z.dump`
(gerar novo com `/root/.config/max/adm-max-prod-pg/backup-prod.sh <rotulo>`).

| 20261002000005 | mt_modulos_plataforma | 2026-10-02 ~18:20 | 4 linhas em organization_modules (padrão: captação ligada, reserva ligada); teste isolation_modulos 12/12 com rollback; 235 reservas intactas; backup pre-modulos-20261002T181623Z.dump; Worker 45f0854b (commit fdd8aee) |
