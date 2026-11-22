-- Rollback da migration 20261224120000_feedback_trafego_pago.sql (tráfego pago manual no Feedback, t_f3f64be0).
-- Remove só o que ela criou: a tabela listing_paid_traffic_entries (os lançamentos são PERDIDOS: se já houver
-- uso, exporte antes com SELECT * FROM public.listing_paid_traffic_entries) e a função de gatilho.
-- portal_listing_snapshots, a coleta e as demais tabelas/funções não são tocadas.
BEGIN;
DROP TABLE IF EXISTS public.listing_paid_traffic_entries;
DROP FUNCTION IF EXISTS public.listing_paid_traffic_audit();
COMMIT;
