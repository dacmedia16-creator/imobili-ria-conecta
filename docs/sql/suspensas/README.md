# Migrations suspensas — NÃO aplicar

Arquivos aqui já foram publicados e depois revertidos na produção. Eles ficam fora de
`supabase/migrations/` para que nenhum `supabase db push`, `apply-migrations.sh` ou script de
ensaio os reaplique por engano.

| Arquivo | Situação |
|---|---|
| `20260929180000_vendas_data_ultima_assinatura.sql` | Publicada em 29/09/2026 e **revertida em 30/09/2026** (`docs/sql/rollback/20260929180000_vendas_data_ultima_assinatura.rollback.sql`): a CTE `ultimas_assinaturas` lê todo o `sale_status_history` sob RLS e estourava o `statement_timeout` de 8 s para gestor e team leader na tela Vendas. O registro `20260929180000` também saiu de `supabase_migrations.schema_migrations`. |

Na produção, depois do rollback: última migration `20260929100000`; `list_vendas_comerciais_paginadas`
md5 `b2efb5f7…` e `list_vendas_comerciais_paginadas_fila` md5 `1767a55d…`.

A regra "data da venda pela última assinatura" volta numa migration **nova**, com outro número de
versão e a consulta limitada às vendas já filtradas, medida como gestor e team leader (< 2 s por
chamada) antes de publicar. Isso depende de autorização separada de Denis. Não mover este arquivo de
volta para `supabase/migrations/`.
