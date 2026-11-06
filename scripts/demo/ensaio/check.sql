\pset footer off
select 'leads_modulo' k, coalesce((select enabled::text from public.organization_modules where organization_id='eb0a260a-db2f-4cbf-b031-f0c2aebb407c' and module='leads'),'-') v
union all select 'leads_abertos_zz', count(*)::text from public.leads where organization_id='eb0a260a-db2f-4cbf-b031-f0c2aebb407c' and etapa not in ('ganho','perdido')
union all select 'leads_resp_md5', md5(string_agg(id::text||coalesce(responsavel_id::text,'-')||etapa, ',' order by id)) from public.leads
union all select 'leads_com_ficticio', count(*)::text from public.leads where responsavel_id::text like 'de30de30-%' or captador_id::text like 'de30de30-%'
union all select 'auth_demo', count(*)::text from auth.users where id::text like 'de30de30-%'
union all select 'auth_demo_com_senha', count(*)::text from auth.users where id::text like 'de30de30-%' and coalesce(encrypted_password,'') <> ''
union all select 'auth_demo_email_fora_invalid', count(*)::text from auth.users where id::text like 'de30de30-%' and email not like '%@demo.invalid'
union all select 'profiles_por_org', string_agg(o||'='||n, ' ') from (select left(organization_id::text,8) o, count(*) n from public.profiles group by 1 order by 1) x
union all select 'roles_demo', string_agg(role||'='||n, ' ') from (select role::text, count(*) n from public.user_roles where user_id::text like 'de30de30-%' group by 1 order by 1) x
union all select 'whats_ligado_demo', count(*)::text from public.user_roles where user_id::text like 'de30de30-%' and (notificar_whatsapp or notificar_toda_atualizacao)
union all select 'teams', count(*)::text from public.teams where organization_id='eb0a260a-db2f-4cbf-b031-f0c2aebb407c'
union all select 'team_members', count(*)::text from public.team_members where organization_id='eb0a260a-db2f-4cbf-b031-f0c2aebb407c'
union all select 'sales', count(*)::text from public.sales where organization_id='eb0a260a-db2f-4cbf-b031-f0c2aebb407c'
union all select 'sales_vgv_fechadas', to_char(sum(valor_negociado),'FM999G999G999') from public.sales where organization_id='eb0a260a-db2f-4cbf-b031-f0c2aebb407c' and (status::text like 'ocorrencia%' or status::text='contrato_assinado')
union all select 'sale_status_history', count(*)::text from public.sale_status_history where organization_id='eb0a260a-db2f-4cbf-b031-f0c2aebb407c'
union all select 'occurrences', count(*)::text from public.occurrences where organization_id='eb0a260a-db2f-4cbf-b031-f0c2aebb407c'
union all select 'occurrence_commissions', count(*)::text from public.occurrence_commissions where organization_id='eb0a260a-db2f-4cbf-b031-f0c2aebb407c'
union all select 'venda_distribuicao', count(*)::text from public.venda_distribuicao
union all select 'exclusive_captures', count(*)::text from public.exclusive_captures where organization_id='eb0a260a-db2f-4cbf-b031-f0c2aebb407c'
union all select 'metas', count(*)::text from public.metas where organization_id='eb0a260a-db2f-4cbf-b031-f0c2aebb407c'
union all select 'minhas_metas', count(*)::text from public.minhas_metas where organization_id='eb0a260a-db2f-4cbf-b031-f0c2aebb407c'
union all select 'room_reservations', count(*)::text from public.room_reservations where organization_id='eb0a260a-db2f-4cbf-b031-f0c2aebb407c'
union all select 'reservas_futuras_sem_lembrete', count(*)::text from public.room_reservations where organization_id='eb0a260a-db2f-4cbf-b031-f0c2aebb407c' and reserved_date >= current_date and reminder_sent_at is null
union all select 'achievement_posts', count(*)::text from public.achievement_posts
union all select 'notifications', count(*)::text from public.notifications
union all select 'email_outbox_pendente', count(*)::text from public.email_outbox where status = 'pendente'
union all select 'email_outbox_total', count(*)::text from public.email_outbox
union all select 'sync_fila', (select count(*)::text from public.sync_outbox)
union all select 'sync_exclusoes', count(*)::text from public.sync_exclusoes
union all select 'clicksign_envelopes', count(*)::text from public.clicksign_envelopes
union all select 'clicksign_whatsapp_fila', count(*)::text from public.clicksign_whatsapp_fila
union all select 'photo_vouchers', count(*)::text from public.photo_vouchers
union all select 'activity_logs', count(*)::text from public.activity_logs
union all select 'outra_org_linhas', ((select count(*) from public.profiles where organization_id='0e0e0e0e-0000-4000-8000-000000000001')
   + (select count(*) from public.sales where organization_id='0e0e0e0e-0000-4000-8000-000000000001'))::text
union all select 'modulos_zz', string_agg(module||'='||enabled, ' ' order by module) from public.organization_modules where organization_id='eb0a260a-db2f-4cbf-b031-f0c2aebb407c';
