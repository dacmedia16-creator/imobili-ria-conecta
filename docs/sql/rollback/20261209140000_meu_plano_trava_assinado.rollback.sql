-- Rollback de 20261209140000_meu_plano_trava_assinado (cartão t_850a0d39).
-- Tira a trava do plano assinado: o dono volta a poder editar depois de assinar (comportamento anterior).
-- Nenhum dado é apagado nem alterado.
BEGIN;
DROP POLICY IF EXISTS zz_meta_ano_assinado_ins ON public.minhas_metas;
DROP POLICY IF EXISTS zz_meta_ano_assinado_upd ON public.minhas_metas;
DROP POLICY IF EXISTS zz_meta_ano_assinado_del ON public.minhas_metas;
DROP FUNCTION IF EXISTS public.carreira_plano_assinado(uuid, uuid, integer);
DROP TRIGGER IF EXISTS trg_carreira_plano_trava_assinado ON public.carreira_plano;
DROP FUNCTION IF EXISTS public.carreira_plano_trava_assinado();
DROP FUNCTION IF EXISTS public.carreira_plano_parte_travada(jsonb);
COMMIT;
