-- Bloqueia as 3 transições críticas quando a distribuição financeira da venda está inconsistente
-- (calcular_distribuicao_venda().calculo_valido = false) — direto no banco, via trigger, pra valer
-- mesmo em alteração por API direta (não só quando passa pela tela). O front-end já mostra a mesma
-- mensagem antes de tentar (ver vendas.$id.tsx), isso aqui é o bloqueio de verdade, não só o aviso.

-- 1) Envio ao jurídico: transição de sales.status para 'aprovada_gestor'.
create or replace function public.validar_distribuicao_antes_aprovar_gestor()
 returns trigger
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
declare
  v_dist jsonb;
begin
  if NEW.status::text = 'aprovada_gestor' and OLD.status::text is distinct from NEW.status::text then
    v_dist := public.calcular_distribuicao_venda(NEW.id);
    if not coalesce((v_dist->>'calculo_valido')::boolean, false) then
      raise exception 'Não é possível enviar ao jurídico: %', (
        select string_agg(x, '; ') from jsonb_array_elements_text(v_dist->'inconsistencias') x
      ) using errcode = '23514';
    end if;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_validar_distribuicao_aprovar_gestor on public.sales;
create trigger trg_validar_distribuicao_aprovar_gestor
  before update on public.sales
  for each row
  execute function public.validar_distribuicao_antes_aprovar_gestor();

-- 2) Conclusão da Ocorrência (occurrences.status -> 'concluida') e aceite financeiro
-- (occurrences.aceita_financeiro -> true) — mesma checagem, papéis diferentes.
create or replace function public.validar_distribuicao_antes_transicao_critica_occ()
 returns trigger
 language plpgsql
 security invoker
 set search_path to 'public'
as $function$
declare
  v_dist jsonb;
  v_acao text;
begin
  if NEW.status = 'concluida' and OLD.status is distinct from NEW.status then
    v_acao := 'concluir a Ocorrência';
  elsif NEW.aceita_financeiro = true and OLD.aceita_financeiro is distinct from NEW.aceita_financeiro then
    v_acao := 'travar a Ocorrência (aceite financeiro)';
  else
    return NEW;
  end if;

  v_dist := public.calcular_distribuicao_venda(NEW.sale_id);
  if not coalesce((v_dist->>'calculo_valido')::boolean, false) then
    raise exception 'Não é possível % desta venda: %', v_acao, (
      select string_agg(x, '; ') from jsonb_array_elements_text(v_dist->'inconsistencias') x
    ) using errcode = '23514';
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_validar_distribuicao_occ_critica on public.occurrences;
create trigger trg_validar_distribuicao_occ_critica
  before update on public.occurrences
  for each row
  execute function public.validar_distribuicao_antes_transicao_critica_occ();
