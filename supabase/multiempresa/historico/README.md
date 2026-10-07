# Histórico de migrations — item 6 (t_df979849)

As migrations `20261002000002_mt_platform_context` e `20261002000003_mt_p2_indices_rls_authenticated`
foram aplicadas em produção em 02/10, mas não ficaram registradas em `supabase_migrations.schema_migrations`.
Os efeitos estão no banco: `platform_enter_org` existe, há 10 índices `idx_p2b*` e 0 policies `TO public`.

Este registro **não foi executado**. Para executar, é preciso aprovação do Denis.

1. Confira antes: `item6_conferir.sql`. O resultado esperado é só `20261002120000` na faixa `20261002%` e total 286.
2. Registre: `item6_registrar.sql`. Ele aborta se os efeitos não estiverem presentes e é idempotente (`ON CONFLICT DO NOTHING`).
3. Confira depois: `item6_conferir.sql`. O total esperado é 288, com o `sha256` de cada linha igual ao do arquivo do repo.
4. Para reverter: `item6_rollback.sql`. Ele apaga somente as 2 linhas criadas, identificadas por `created_by` e `idempotency_key`.

O formato segue o das versões `mt_*` de 04/10 já registradas em produção: um elemento em `statements`
com o arquivo inteiro, `created_by='max-tecnologia'` e `idempotency_key='max-tecnologia-<versão>'`.
O ensaio em homologação foi feito em tabela temporária, com ROLLBACK: inserir, repetir sem duplicar, conferir o sha256 e reverter.
