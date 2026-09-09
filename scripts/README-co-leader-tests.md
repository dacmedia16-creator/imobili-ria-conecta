# Teste isolado de liderança auxiliar

`vitest run --config vitest.sale-management.config.ts` executa os testes locais de capacidade, renderização da condição real da rota e salvamento/avanço. Não carrega `.env` nem testes remotos.

O teste SQL usa PostgreSQL 18 em cluster descartável, sem TCP. Nunca executar seu bootstrap em banco de negócio. A pasta indicada por `ADM_SALE_TEST_WORKSPACE` contém `pg-root/` com binários, biblioteca libpq e socket local em `pg-root/tmp:55432`, o clone em `repo/`, e catálogos JSON somente de esquema: `catalog-columns`, `catalog-constraints`, `catalog-enums`, `catalog-functions`, `catalog-policies` e `catalog-triggers`. Fontes: information_schema.columns, pg_constraint/pg_get_constraintdef, pg_enum, pg_proc/pg_get_functiondef, pg_policies e pg_trigger/pg_get_triggerdef; sem exportar registros de negócio. Inclui public e policies/colunas de storage.objects/buckets; inclui storage.foldername. O bootstrap mantém constraints e triggers do catálogo, com auth.users mínimo e auth.uid/auth.jwt sintéticos. Não reproduz JWT/PostgREST, serviços internos de Storage nem índices não vinculados a constraints.

    ADM_SALE_TEST_WORKSPACE=/caminho/isolado python scripts/sql_harness.py --setup
    ADM_SALE_TEST_WORKSPACE=/caminho/isolado python scripts/test-co-leader-sale-operations.py

O runner exige erro anterior da RPC, aplica a migration real, verifica casos positivos/negativos e gera/exercita a reversão em supabase/rollback. Toda ação de ator usa transação com ROLLBACK. O catálogo deve representar o estado anterior à migration; não usar catálogo já alterado como baseline.

A capacidade nova cobre o fluxo padrão, que possui etapas de gestor. Lançamento mantém seu fluxo próprio (dono → financeiro). Não concede exclusão definitiva nova, aceite/baixa/conclusão financeira nem capacidade de remover o bloqueio jurídico.

Reversão de produção: reverter o commit do frontend pelo pipeline oficial e aplicar SQL compensatório baseado no arquivo de rollback, após conferir que nenhuma migration posterior alterou as mesmas seis funções. Registrar a compensação no histórico, sem apagar migration aplicada. O rollback não desfaz ações de negócio legítimas realizadas após o deploy; restauração física não deve ser acionada automaticamente.
