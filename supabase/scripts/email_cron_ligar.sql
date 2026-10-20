-- Liga o robô do e-mail de boas-vindas (SÓ com OK do Denis). Pré-requisitos: migration
-- 20261020180000_email_boas_vindas_envio aplicada, função send-email-boas-vindas publicada e segredos no Vault:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/send-email-boas-vindas', 'email_boas_vindas_url');
--   select vault.create_secret('<mesmo valor de EMAIL_INTERNAL_SECRET da função>', 'email_internal_secret');
-- 1) Marca a data de corte (ninguém criado antes recebe) e liga a chave:
update public.email_config
   set boas_vindas_mode = 'live', boas_vindas_desde = coalesce(boas_vindas_desde, now()), updated_at = now()
 where id;
-- 2) Agenda o robô (a cada minuto; só chama a função se houver pendência):
select cron.schedule('email-boas-vindas', '* * * * *', $$select public.email_disparar()$$);
