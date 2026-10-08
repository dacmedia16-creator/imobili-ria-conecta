-- Mede (tempo no servidor, sem rede) as telas afetadas como usuário autenticado.
-- Uso no psql: \set uid '...'  \set perfil 'gestor'  \set priv 0|1  \i medir.sql
-- Grava em temp table `tempos` (fase, perfil, consulta, ms) — melhor de 2 execuções.
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true),
       set_config('request.jwt.claim.sub', :'uid', true),
       set_config('perf.perfil', :'perfil', true),
       set_config('perf.priv', :'priv', true);
set local role authenticated;
do $t$
declare
  q text; t0 timestamptz; ms numeric; melhor numeric; i int;
  consultas text[] := array[
    'select public.dashboard_stats()',
    'select count(*) from public.vendas_comerciais_canonicas()',
    'select count(*) from public.sales',
    'select count(*) from public.sale_commission_extras',
    'select count(*) from public.occurrence_commissions',
    'select count(*) from public.sale_status_history'];
begin
  if current_setting('perf.priv') = '1' then
    consultas := consultas || array[
      'select count(*) from public.financeiro_distribuicao_vendas()',
      'select count(*) from public.comparativo_comissao_6pct()',
      'select count(*) from public.comparativo_comissao_6pct_inconsistencias()'];
  end if;
  foreach q in array consultas loop
    melhor := null;
    for i in 1..2 loop
      t0 := clock_timestamp();
      execute q;
      ms := round(extract(epoch from clock_timestamp() - t0) * 1000, 1);
      melhor := least(coalesce(melhor, ms), ms);
    end loop;
    insert into tempos values (current_setting('perf.fase'), current_setting('perf.perfil'),
      regexp_replace(q, '^select (count\(\*\) from )?public\.', ''), melhor);
  end loop;
end $t$;
reset role;
