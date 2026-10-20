-- DESFAZER da migration 20261020180000_email_boas_vindas_envio (t_30cf354f).
-- Tira o cron (se existir), o gatilho, as funções e as tabelas. ATENÇÃO: apaga o log de envios (email_outbox).
-- Para só PARAR o envio sem perder o log, use: update public.email_config set boas_vindas_mode = 'off';
begin;
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'email-boas-vindas'$q$;
  end if;
end $$;
drop trigger if exists trg_zz_email_boas_vindas on public.profiles;
drop function if exists public.email_enfileirar_boas_vindas_trg();
drop function if exists public.email_outbox_pegar(integer);
drop function if exists public.email_boas_vindas_dados(uuid);
drop function if exists public.email_outbox_concluir(bigint, text, text, text);
drop function if exists public.email_teste_reservar(uuid);
drop function if exists public.email_teste_ficticio_reservar(text);
drop function if exists public.email_reenviar_boas_vindas(uuid);
drop function if exists public.email_disparar();
drop table if exists public.email_outbox;
drop table if exists public.email_config;
commit;
