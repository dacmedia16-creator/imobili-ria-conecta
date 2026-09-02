-- Restaura Gestor e Team Leader na autorização da função de contexto.
-- A função foi recriada por uma migration posterior à liberação original; esta
-- alteração preserva integralmente o cálculo vigente e corrige somente o papel.

do $$
declare
  definition text;
  updated_definition text;
begin
  definition := pg_get_functiondef(
    'public.desempenho_contexto_periodo(date,date)'::regprocedure
  );

  updated_definition := replace(
    definition,
    'array[''financeiro'',''admin'',''super_admin'']::app_role[]',
    'array[''financeiro'',''admin'',''super_admin'',''gestor'',''team_leader'']::app_role[]'
  );

  if updated_definition = definition
     and definition not like '%''gestor'',''team_leader'']::app_role[]%' then
    raise exception 'Contrato de autorização inesperado em desempenho_contexto_periodo';
  end if;

  if updated_definition <> definition then
    execute updated_definition;
  end if;
end $$;

revoke execute on function public.desempenho_contexto_periodo(date,date) from public, anon;
grant execute on function public.desempenho_contexto_periodo(date,date) to authenticated;
