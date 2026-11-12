-- Papel geral "Locação" (card t_1fe07126, tópico 6238, Denis 12/11/2026), parte A de 2.
-- ALTER TYPE ... ADD VALUE não pode ser usado na mesma transação que usa o novo valor; por isso as regras
-- do papel ficam na migration seguinte (20261122120100_papel_locacao.sql). Mesmo critério do papel Fotógrafo
-- (20261105130000_app_role_fotografo.sql).
-- NÃO confundir com os papéis internos do módulo (locacao_papeis: gestora, contratos, vistoria, financeiro),
-- que continuam iguais e independentes.
-- Rollback: valor de enum não é removido. Sem nenhuma linha em user_roles com 'locacao', o valor sobra inerte.
-- Ver docs/sql/rollback/20261122120000_app_role_locacao.rollback.sql.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'locacao';
