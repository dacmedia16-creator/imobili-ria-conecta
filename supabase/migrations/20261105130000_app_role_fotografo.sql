-- Papel "Fotógrafo" (card t_0666d3f0, PR #269), parte A de 2.
-- ALTER TYPE ... ADD VALUE não pode ser usado na mesma transação que usa o novo valor; por isso as regras
-- do papel ficam na migration seguinte (20261105130100_papel_fotografo.sql).
-- Rollback: valor de enum não é removido (mesmo critério do papel staff, 20260911010000). Sem nenhuma linha
-- em user_roles com 'fotografo', o valor sobra inerte. Ver docs/sql/rollback/20261105130000_app_role_fotografo.rollback.sql.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'fotografo';
