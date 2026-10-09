-- Corrige "Falha ao criar venda" (42501 new row violates row-level security policy) desde a perf_01.
--
-- Causa: a perf_01 (20261008100100) deixou a policy de leitura de vendas como
--   id IN (SELECT vendas_visiveis_ids())
-- No INSERT ... RETURNING (supabase .insert(...).select("id")), o Postgres confere a policy de LEITURA
-- na linha recém-criada; a função STABLE usa o snapshot do início do comando e não enxerga essa linha.
-- Resultado: o corretor/gestor não consegue criar o rascunho.
--
-- Correção: o próprio corretor (corretor_id / captador / vendedor) com usuário ativo volta a ler a linha
-- direto pela coluna, sem depender da lista. NÃO amplia nada: é exatamente um ramo que já existe em
-- vendas_visiveis_ids() (ctx.ativo AND uid IN (corretor_id, corretor_captador_id, corretor_vendedor_id, ...))
-- e na regra original; o isolamento por imobiliária continua na policy RESTRICTIVE org_isolation e o
-- portão mt_1b_gate continua dentro de is_active_user().
-- Só muda o USING da policy SELECT sales_select. INSERT/UPDATE/DELETE e WITH CHECK ficam iguais.
--
-- Vistoria da mesma classe: as demais policies trocadas pela perf_01 usam sale_id de uma venda que já
-- existe antes do INSERT (comentários, extras, partes, ocorrências...), então o RETURNING delas enxerga
-- a venda na lista e não precisa de ajuste.
--
-- Idempotente: só altera se o USING atual for o da perf_01; se já estiver corrigido, pula; se for outro, PARA.
-- Desfazer: supabase/rollback/20261009050000_fix_sales_select_insert_returning.sql

select set_config('search_path', 'public, extensions', true), set_config('lock_timeout', '5s', true);

do $f$
declare
  atual text;
  esperado constant text := '(id IN ( SELECT vendas_visiveis_ids() AS vendas_visiveis_ids))';
begin
  select p.qual into atual from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'sales' and p.policyname = 'sales_select' and p.cmd = 'SELECT';
  if not found then
    raise exception 'policy sales.sales_select não existe';
  end if;
  if replace(atual, 'public.', '') = esperado then
    alter policy sales_select on public.sales using (
      (id IN (SELECT public.vendas_visiveis_ids()))
      OR (
        (SELECT auth.uid()) IN (corretor_id, corretor_captador_id, corretor_vendedor_id)
        AND (SELECT public.is_active_user((SELECT auth.uid())))
      )
    );
    raise notice 'sales_select corrigida (dono da linha legível no INSERT ... RETURNING)';
  elsif atual ~ 'vendas_visiveis_ids' and atual ~ 'corretor_captador_id' and atual ~ 'is_active_user' then
    raise notice 'sales_select já estava corrigida';
  else
    raise exception 'USING de sales.sales_select diverge do esperado; confira antes. Atual: %', atual;
  end if;
end $f$;
