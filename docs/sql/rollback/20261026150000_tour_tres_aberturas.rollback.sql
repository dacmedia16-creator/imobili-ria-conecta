-- ROLLBACK de 20261026150000_tour_tres_aberturas (t_7444a154). Volta ao tour de 1 abertura.
-- Antes de rodar, reverter o frontend (a tela nova chama public.tour_registrar_abertura; sem ela, o tour
-- só não abre sozinho — nada quebra).
-- Efeito nos dados: linhas com status 'aberto' (tour abriu e a pessoa ainda não fechou/concluiu) viram
-- 'fechado', para caber de novo na regra antiga; as colunas aberturas e ultima_abertura_em são removidas.
-- Nenhuma linha é apagada e nenhuma outra tabela é tocada.
BEGIN;
DROP FUNCTION IF EXISTS public.tour_registrar_abertura(text);
UPDATE public.user_tour_estado SET status = 'fechado' WHERE status = 'aberto';
ALTER TABLE public.user_tour_estado DROP CONSTRAINT IF EXISTS user_tour_estado_status_check;
ALTER TABLE public.user_tour_estado
  ADD CONSTRAINT user_tour_estado_status_check CHECK (status IN ('concluido', 'fechado'));
ALTER TABLE public.user_tour_estado DROP CONSTRAINT IF EXISTS user_tour_estado_aberturas_check;
ALTER TABLE public.user_tour_estado DROP COLUMN IF EXISTS ultima_abertura_em;
ALTER TABLE public.user_tour_estado DROP COLUMN IF EXISTS aberturas;
COMMIT;
