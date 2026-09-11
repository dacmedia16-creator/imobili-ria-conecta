-- Canal de leitura individual para comentários de vendas.
-- Não altera comentários existentes nem restringe quem já pode comentar.

begin;

create table if not exists public.sale_comment_recipients (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.sale_comments(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (comment_id, user_id)
);

create index if not exists idx_sale_comment_recipients_sale_user
  on public.sale_comment_recipients (sale_id, user_id, read_at);

create index if not exists idx_sale_comment_recipients_comment
  on public.sale_comment_recipients (comment_id);

grant select, update on public.sale_comment_recipients to authenticated;
grant all on public.sale_comment_recipients to service_role;
alter table public.sale_comment_recipients enable row level security;

drop policy if exists sale_comment_recipients_view on public.sale_comment_recipients;
create policy sale_comment_recipients_view
  on public.sale_comment_recipients for select to authenticated
  using (public.can_view_sale((select auth.uid()), sale_id));

drop policy if exists sale_comment_recipients_mark_read on public.sale_comment_recipients;
create policy sale_comment_recipients_mark_read
  on public.sale_comment_recipients for update to authenticated
  using (
    user_id = (select auth.uid())
    and public.can_view_sale((select auth.uid()), sale_id)
  )
  with check (
    user_id = (select auth.uid())
    and public.can_view_sale((select auth.uid()), sale_id)
  );

commit;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sale_comment_recipients'
  ) then
    alter publication supabase_realtime add table public.sale_comment_recipients;
  end if;
end;
$$;
