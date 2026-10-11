-- Recuperado de supabase_migrations.schema_migrations (versão 20260719234131) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

-- Permite adicionar partes extras na divisão da comissão do Resumo (revisão do gestor),
-- além dos campos fixos de captador/vendedor/indicador. Cada parte extra escolhe de qual
-- fatia (imobiliária, captador ou vendedor) o valor sai — não descontamos automaticamente
-- dos campos fixos, é só um registro informativo de destino/valor, igual ao indicador hoje.
create table public.sale_commission_extras (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  nome text,
  origem text not null default 'imobiliaria' check (origem in ('imobiliaria', 'captador', 'vendedor')),
  percentual numeric,
  valor numeric,
  created_at timestamptz not null default now()
);

alter table public.sale_commission_extras enable row level security;

create policy sale_commission_extras_rw on public.sale_commission_extras
  for all
  using (public.can_view_sale(auth.uid(), sale_id))
  with check (
    public.can_view_sale(auth.uid(), sale_id)
    and (
      not public.is_sale_locked(sale_id)
      or public.has_any_role(auth.uid(), array['financeiro','admin','super_admin']::app_role[])
    )
  );
