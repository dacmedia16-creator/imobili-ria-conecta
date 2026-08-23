-- Regra oficial: nenhuma venda do fluxo padrão pode chegar ao Jurídico (nem avançar
-- depois dele) com participante interno sem perfil ativo e corretamente vinculado.
-- Parcerias externas continuam permitidas sem usuário interno quando estiverem
-- explicitamente marcadas como `sem_cadastro_confirmado`.

create or replace function public.validar_participantes_internos_venda(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_sale public.sales%rowtype;
  v_inconsistencias jsonb := '[]'::jsonb;
  v_item record;
begin
  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;

  for v_item in
    select * from (values
      ('Corretor responsável', nullif(trim(coalesce((select p.nome from public.profiles p where p.id = v_sale.corretor_id), '')), ''), v_sale.corretor_id),
      ('Captador', nullif(trim(v_sale.corretor_captador), ''), v_sale.corretor_captador_id),
      ('Vendedor', nullif(trim(v_sale.corretor_vendedor), ''), v_sale.corretor_vendedor_id),
      ('Indicador do captador', nullif(trim(v_sale.indicador_captador), ''), v_sale.indicador_captador_id),
      ('Indicador do vendedor', nullif(trim(v_sale.indicador_vendedor), ''), v_sale.indicador_vendedor_id),
      ('Líder do captador', nullif(trim(v_sale.lider_captador_nome), ''), v_sale.lider_captador_id),
      ('Líder do vendedor', nullif(trim(v_sale.lider_vendedor_nome), ''), v_sale.lider_vendedor_id)
    ) as participantes(papel, nome, user_id)
  loop
    if v_item.user_id is not null and not exists (
      select 1 from public.profiles p where p.id = v_item.user_id and p.ativo = true
    ) then
      v_inconsistencias := v_inconsistencias || jsonb_build_array(
        v_item.papel || case when v_item.nome is not null then ' "' || v_item.nome || '"' else '' end ||
        ' está sem cadastro ativo no sistema.'
      );
    elsif v_item.nome is not null and v_item.user_id is null then
      v_inconsistencias := v_inconsistencias || jsonb_build_array(
        v_item.papel || ' "' || v_item.nome || '" está sem conta vinculada no sistema.'
      );
    end if;
  end loop;

  for v_item in
    select e.nome, e.papel, e.user_id
    from public.sale_commission_extras e
    where e.sale_id = p_sale_id
      and nullif(trim(e.nome), '') is not null
      and coalesce(e.sem_cadastro_confirmado, false) = false
      and (
        e.user_id is null
        or not exists (select 1 from public.profiles p where p.id = e.user_id and p.ativo = true)
      )
  loop
    v_inconsistencias := v_inconsistencias || jsonb_build_array(
      coalesce(initcap(replace(v_item.papel, '_', ' ')), 'Participante') ||
      ' "' || trim(v_item.nome) || '" está sem conta ativa vinculada no sistema.'
    );
  end loop;

  return jsonb_build_object(
    'valido', jsonb_array_length(v_inconsistencias) = 0,
    'inconsistencias', v_inconsistencias
  );
end;
$function$;

revoke all on function public.validar_participantes_internos_venda(uuid) from public, anon;
grant execute on function public.validar_participantes_internos_venda(uuid) to authenticated, service_role;

create or replace function public.bloquear_venda_com_participante_sem_cadastro()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_resultado jsonb;
begin
  if old.status is distinct from new.status
     and new.status::text in (
       'aprovada_gestor', 'enviada_juridico', 'em_elaboracao_contrato',
       'contrato_conferencia_gestor', 'contrato_conferencia_corretor',
       'contrato_ok_corretor', 'aguardando_assinatura', 'contrato_assinado',
       'ocorrencia_pendente', 'ocorrencia_analise_financeiro',
       'ocorrencia_devolvida_gestor', 'ocorrencia_concluida'
     ) then
    v_resultado := public.validar_participantes_internos_venda(new.id);
    if not coalesce((v_resultado->>'valido')::boolean, false) then
      raise exception 'Não é possível avançar a venda: %', (
        select string_agg(item, '; ')
        from jsonb_array_elements_text(v_resultado->'inconsistencias') item
      ) using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_bloquear_participante_sem_cadastro on public.sales;
create trigger trg_bloquear_participante_sem_cadastro
  before update of status on public.sales
  for each row
  execute function public.bloquear_venda_com_participante_sem_cadastro();

revoke all on function public.bloquear_venda_com_participante_sem_cadastro() from public, anon;

