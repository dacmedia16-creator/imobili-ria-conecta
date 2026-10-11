-- Para o robô da sincronização (reversão rápida). Para tudo na hora também: update public.sync_config set mode = 'off';
select cron.unschedule(jobname) from cron.job where jobname in ('sync-satelites', 'sync-reconciliar');
