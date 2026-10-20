-- Desliga o e-mail de boas-vindas (efeito imediato). O log em public.email_outbox é preservado.
update public.email_config set boas_vindas_mode = 'off', updated_at = now() where id;
select cron.unschedule('email-boas-vindas')
 where exists (select 1 from cron.job where jobname = 'email-boas-vindas');
