-- Rollback da 20261002000004: remove somente as 6 policies zz_mt_leitor_amplo_select.
-- As demais policies não foram tocadas pelo up, então nada mais precisa ser restaurado.
BEGIN;
DROP POLICY IF EXISTS zz_mt_leitor_amplo_select ON public.sale_status_history;
DROP POLICY IF EXISTS zz_mt_leitor_amplo_select ON public.occurrences;
DROP POLICY IF EXISTS zz_mt_leitor_amplo_select ON public.occurrence_commissions;
DROP POLICY IF EXISTS zz_mt_leitor_amplo_select ON public.occurrence_partners;
DROP POLICY IF EXISTS zz_mt_leitor_amplo_select ON public.sale_commission_extras;
DROP POLICY IF EXISTS zz_mt_leitor_amplo_select ON public.sale_parties;
COMMIT;
