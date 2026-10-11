-- Agenda o robô da sincronização (ETAPA 2+, só com OK de Denis). Pré-requisitos: migration
-- 20261011120000_sync_satelites aplicada, função sync-satelites publicada e segredos no Vault:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/sync-satelites', 'sync_satelites_url');
--   select vault.create_secret('<mesmo valor de SYNC_INTERNAL_SECRET da função>', 'sync_internal_secret');
-- O robô só chama a função quando há pendência e o modo geral não está 'off'.
select cron.schedule('sync-satelites', '* * * * *', $$select public.sync_disparar('processar')$$);
-- Reconciliação: hoje é SOB DEMANDA (select public.sync_disparar('reconciliar')).
-- Para a conferência noturna (03:30 BRT = 06:30 UTC), descomente:
-- select cron.schedule('sync-reconciliar', '30 6 * * *', $$select public.sync_disparar('reconciliar')$$);
