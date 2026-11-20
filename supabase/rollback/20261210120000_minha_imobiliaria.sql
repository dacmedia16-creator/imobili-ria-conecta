-- Rollback da migration 20261210120000 (Minha imobiliária, t_f7f1b3e4).
-- Apaga SÓ as 4 funções novas. Nenhuma tabela nem dado foi criado ou alterado, então não há nada a guardar antes.
-- Sem as funções, a tela /minha-imobiliaria mostra erro (não dado falso); para tirar a tela, reverta o PR.
BEGIN;
DROP FUNCTION IF EXISTS public.minha_imobiliaria_atividades(integer);
DROP FUNCTION IF EXISTS public.minha_imobiliaria_resumo();
DROP FUNCTION IF EXISTS public.minha_imobiliaria_respostas_funil(jsonb);
DROP FUNCTION IF EXISTS public.minha_imobiliaria_org();
COMMIT;
