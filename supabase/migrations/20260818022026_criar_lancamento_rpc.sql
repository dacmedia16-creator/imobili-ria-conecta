-- Substitui as 3 chamadas soltas do client (insert em sales, 2x insert em sale_parties, insert
-- fire-and-forget em activity_logs) por UMA RPC transacional — mesmo motivo de change_sale_status
-- (ver 20260727020000): se uma chamada solta falhar no meio (rede caiu), a venda existe mas fica
-- sem histórico de criação, sem erro visível pra ninguém. O log de criação deixa de depender de
-- "melhor esforço" — ou a venda inteira (sales + partes + log) é criada, ou nada é.
--
-- SECURITY DEFINER com checagem de papel explícita no topo (mesmo padrão de
-- criar_ocorrencia_lancamento) — replica a MESMA regra que a policy sales_insert_corretor já usa
-- pra modalidade = 'lancamento', então não afrouxa nem aperta o que já era permitido via insert
-- direto.
create or replace function public.criar_lancamento(p_imovel_id text, p_construtora_nome text, p_construtora_cnpj text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_sale_id uuid;
begin
  if v_user is null then
    raise exception 'Não autenticado.' using errcode = '42501';
  end if;

  if not (
    public.has_role(v_user, 'lancamento'::app_role)
    or public.has_any_role(v_user, array['gestor','team_leader']::app_role[])
    or public.has_role(v_user, 'corretor'::app_role)
  ) then
    raise exception 'Sem permissão para criar um Lançamento.' using errcode = '42501';
  end if;

  insert into sales (corretor_id, imovel_id, status, modalidade)
  values (v_user, nullif(p_imovel_id, ''), 'rascunho', 'lancamento')
  returning id into v_sale_id;

  -- Construtora entra como vendedor_1 (pessoa jurídica) — mesmo formato que sale_parties já
  -- suportava no insert direto do client.
  insert into sale_parties (sale_id, papel, tipo_pessoa, razao_social, cnpj)
  values (v_sale_id, 'vendedor_1', 'juridica', nullif(p_construtora_nome, ''), nullif(p_construtora_cnpj, ''));

  insert into sale_parties (sale_id, papel, tipo_pessoa)
  values (v_sale_id, 'comprador_1', 'fisica');

  insert into activity_logs (autor_id, sale_id, acao, payload)
  values (v_user, v_sale_id, 'lancamento_criado', jsonb_build_object(
    'imovel_id', nullif(p_imovel_id, ''),
    'construtora', nullif(p_construtora_nome, '')
  ));

  return v_sale_id;
end;
$function$;

revoke execute on function public.criar_lancamento(text, text, text) from public;
revoke execute on function public.criar_lancamento(text, text, text) from anon;
grant execute on function public.criar_lancamento(text, text, text) to authenticated;
