# Plano de reversão — vendas reais ADM MAX × Estudo de Mercado (t_103e6746, 11/10/2026)

Backups antes da mudança (ADM MAX, ref `xvvymgurpchhlmbpjbgc`):
- Lógico (schema public + dados): `/root/.config/max/adm-max-prod-backups/pre-estudo-vendas-reais-20261011T020532Z.dump`
  (81 tabelas com dados, `pg_restore -l` legível; sem objetos `estudo_vendas`).
- Físico da plataforma: id 1925106798, COMPLETED, 2026-10-10 13:48 UTC (walg; sem PITR).

A mudança é **aditiva**: 1 tabela nova (`estudo_vendas_api_keys`), 2 funções novas, 1 Edge Function nova,
1 secret novo no Worker do Estudo e 1 bloco novo na tela de relatório do Estudo. Nenhuma tabela, função,
policy ou dado existente é alterado. Por isso a reversão não exige restaurar backup.

Reversão, do mais rápido ao completo (cada passo sozinho já corta o envio de vendas ao Estudo):
1. Cortar o acesso na hora: `UPDATE public.estudo_vendas_api_keys SET revoked_at = now() WHERE revoked_at IS NULL;`
   -> a Edge Function passa a responder 401 e o Estudo esconde o bloco sozinho.
2. Estudo: `wrangler secret delete ADM_VENDAS_REAIS_KEYS` (e `ADM_VENDAS_REAIS_URL`) no Worker do Estudo, ou
   reativar a versão anterior do Worker (`wrangler rollback <versão anterior>`).
3. ADM: apagar a Edge Function `estudo-vendas-reais` (`DELETE /v1/projects/<ref>/functions/estudo-vendas-reais`).
4. Banco: aplicar `supabase/rollback/20261011100000_estudo_vendas_reais.sql` e remover a versão
   `20261011100000` de `supabase_migrations.schema_migrations`.
5. Código: `git revert` do merge do PR (sem force-push; repositório ligado ao Lovable) e `npm run deploy:safe`.

Restaurar o backup só seria necessário se algo fora destes objetos mudasse — o que esta mudança não faz.
Depois de reverter: conferir login, Vendas e Dashboard do ADM e um estudo no Estudo de Mercado.
