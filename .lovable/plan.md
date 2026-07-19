## Exportar schema completo (DDL) do banco

Vou gerar um único arquivo `docs/schema.sql` com todo o DDL do schema `public`, pronto para rodar em outro Postgres/Supabase.

### O que será incluído, nesta ordem

1. `CREATE TYPE` de todos os enums (ex.: `app_role`, status de venda, etc.)
2. `CREATE OR REPLACE FUNCTION` de todas as funções (`has_role`, `has_any_role`, `is_lead_of`, `is_sale_locked`, `can_view_sale`, `handle_new_user`, `set_updated_at`, `log_role_change`, e demais existentes)
3. `CREATE TABLE IF NOT EXISTS` de todas as tabelas em ordem topológica (referenciadas primeiro), com colunas, defaults, NOT NULL, PK, FKs (com `ON DELETE`/`ON UPDATE`), UNIQUE e CHECK
4. `CREATE INDEX IF NOT EXISTS` de todos os índices não implícitos
5. `GRANT` por tabela (authenticated / service_role / anon quando aplicável)
6. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` de cada política existente
7. `CREATE TRIGGER` (incluindo `set_updated_at`, `log_role_change`, etc.)

Cada seção separada por comentários `-- ===== TABELA: nome =====`.

### Como vou extrair

Consultas somente-leitura ao catálogo (`information_schema` + `pg_catalog`) para reconstruir DDL fiel:
- `pg_type` + `pg_enum` → enums
- `pg_proc` → funções (`pg_get_functiondef`)
- `pg_class` + `pg_attribute` + `pg_attrdef` → colunas/defaults
- `pg_constraint` (`pg_get_constraintdef`) → PK/FK/UNIQUE/CHECK
- `pg_index` (`pg_get_indexdef`) → índices
- `pg_policies` (`pg_get_expr`) → RLS policies
- `pg_trigger` (`pg_get_triggerdef`) → triggers
- `information_schema.role_table_grants` → grants

### Entrega

- Arquivo único: `docs/schema.sql`
- Idempotente (`IF NOT EXISTS` onde possível; `CREATE OR REPLACE` para funções; `DROP POLICY IF EXISTS` antes de cada `CREATE POLICY` para evitar conflito na reexecução)
- Sem dados (nenhum `INSERT`)
- Também colo o SQL completo na resposta em um bloco de código

### Nota técnica

`CREATE TABLE IF NOT EXISTS` não altera tabelas já existentes — a migration serve para provisionar um banco novo. Se você quiser também um modo "reset" (com `DROP ... CASCADE` no topo), me diga que eu incluo comentado.
