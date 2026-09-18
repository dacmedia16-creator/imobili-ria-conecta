-- Alinha o fluxo de Lançamento com a autorização já exposta na tela e na RPC
-- de criação, sem alterar dados existentes.
--
-- 1) corretor, gestor, team_leader e lancamento podem criar e enviar o próprio
--    Lançamento ao financeiro.
-- 2) o envio/reenvio trava a venda e valida calculo_valido no servidor antes de
--    criar ou sincronizar a ocorrência.
--
-- A migration usa pg_get_functiondef() para preservar integralmente as regras
-- atuais e alterar apenas os trechos auditados. Falha fechada se a definição
-- implantada divergir do trecho esperado.

begin;

do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  -- A trigger de status era a única etapa que aceitava apenas o papel
  -- "lancamento", embora a tela e criar_lancamento() aceitem quatro perfis.
  select pg_get_functiondef('public.validate_sale_status_transition()'::regprocedure)
    into v_definition;

  v_old := $old$if not allowed and is_owner and public.has_role(actor, 'lancamento'::app_role) and (from_status, to_status) in ($old$;
  v_new := $new$if not allowed
     and is_owner
     and new.modalidade = 'lancamento'
     and public.has_any_role(actor, array['lancamento','corretor','gestor','team_leader']::app_role[])
     and (from_status, to_status) in ($new$;

  if position(v_old in v_definition) = 0 then
    raise exception 'Definição de validate_sale_status_transition divergente; migration interrompida.';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;

  -- Reforça criar_ocorrencia_lancamento() sem reescrever a função inteira:
  -- a venda fica serializada e a divisão precisa estar válida no servidor.
  select pg_get_functiondef('public.criar_ocorrencia_lancamento(uuid)'::regprocedure)
    into v_definition;

  v_old := $old$select * into v_sale from sales where id = p_sale_id;$old$;
  v_new := $new$select * into v_sale from sales where id = p_sale_id for update;$new$;
  if position(v_old in v_definition) = 0 then
    raise exception 'Definição de criar_ocorrencia_lancamento sem SELECT esperado; migration interrompida.';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$  v_comissao_bruta := (v_dist->>'comissao_bruta')::numeric;$old$;
  v_new := $new$  v_comissao_bruta := (v_dist->>'comissao_bruta')::numeric;

  if not coalesce((v_dist->>'calculo_valido')::boolean, false) then
    raise exception 'Não é possível enviar este lançamento ao financeiro: %', (
      select string_agg(x, '; ')
      from jsonb_array_elements_text(coalesce(v_dist->'inconsistencias', '[]'::jsonb)) x
    ) using errcode = '23514';
  end if;$new$;
  if position(v_old in v_definition) = 0 then
    raise exception 'Definição de criar_ocorrencia_lancamento sem cálculo esperado; migration interrompida.';
  end if;
  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end;
$migration$;

commit;
