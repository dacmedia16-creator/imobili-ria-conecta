-- ROLLBACK de 20261026120000_tour_primeiro_acesso (t_2e09bc40).
-- Efeito: apaga a tabela e a escolha gravada de todos (o tour volta a abrir para todos no próximo acesso,
-- exceto em navegadores que guardaram a cópia local). Não mexe em nenhuma outra tabela.
-- Antes de rodar, reverter o frontend (sem a tabela, a tela não abre o tour sozinha: leitura com erro = já visto).
BEGIN;
DROP TABLE IF EXISTS public.user_tour_estado;
COMMIT;
