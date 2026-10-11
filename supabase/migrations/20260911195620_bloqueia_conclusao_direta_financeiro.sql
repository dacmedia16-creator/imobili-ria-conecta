-- Recuperado de supabase_migrations.schema_migrations (versão 20260911195620) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

-- Impede que qualquer papel conclua uma venda sem a passagem pela análise do Financeiro.
-- A conclusão válida é exclusivamente ocorrencia_analise_financeiro -> ocorrencia_concluida.
-- Admin/super_admin continuam com autonomia operacional nas demais transições, mas não
-- podem contornar esta regra de negócio.

create or replace function public.validate_sale_status_transition()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor uuid := auth.uid();
  is_owner boolean := (old.corretor_id = auth.uid());
  allowed boolean := false;
  from_status text := old.status::text;
  to_status text := new.status::text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Administradores mantêm autonomia nas demais operações, mas a conclusão
  -- continua obrigatoriamente sujeita à regra do Financeiro abaixo.
  if public.has_any_role(actor, array['admin','super_admin']::app_role[])
     and to_status <> 'ocorrencia_concluida' then
    return new;
  end if;

  if to_status in ('cancelada', 'arquivada')
     and public.has_any_role(actor, array['gestor','team_leader']::app_role[])
     and (public.is_lead_of(actor, old.corretor_id) or public.can_edit_sale_as_co_leader(old.id))
     and from_status in (
       'enviada_revisao', 'contrato_conferencia_gestor', 'contrato_ok_corretor',
       'aguardando_assinatura', 'contrato_assinado', 'ocorrencia_pendente',
       'ocorrencia_devolvida_gestor'
     ) then
    return new;
  end if;

  if is_owner and (from_status, to_status) in (
    ('rascunho', 'enviada_revisao'),
    ('devolvida_ajuste', 'enviada_revisao'),
    ('contrato_conferencia_corretor', 'contrato_ok_corretor'),
    ('contrato_conferencia_corretor', 'contrato_conferencia_gestor')
  ) then
    allowed := true;
  end if;

  if not allowed
     and is_owner
     and public.has_any_role(actor, array['gestor','team_leader']::app_role[])
     and (from_status, to_status) in (
       ('rascunho', 'aprovada_gestor'),
       ('devolvida_ajuste', 'aprovada_gestor')
     ) then
    allowed := true;
  end if;

  if not allowed
     and from_status = 'rascunho'
     and to_status = 'aprovada_gestor'
     and public.has_any_role(actor, array['gestor','team_leader']::app_role[])
     and (public.is_lead_of(actor, old.corretor_id) or public.can_edit_sale_as_co_leader(old.id)) then
    allowed := true;
  end if;

  if not allowed
     and is_owner
     and public.has_role(actor, 'lancamento'::app_role)
     and (from_status, to_status) in (
       ('rascunho', 'ocorrencia_analise_financeiro'),
       ('devolvida_ajuste', 'ocorrencia_analise_financeiro')
     ) then
    allowed := true;
  end if;

  if not allowed
     and public.has_any_role(actor, array['gestor','team_leader']::app_role[])
     and (from_status, to_status) in (
       ('enviada_revisao', 'aprovada_gestor'),
       ('enviada_revisao', 'devolvida_ajuste'),
       ('contrato_conferencia_gestor', 'contrato_conferencia_corretor'),
       ('contrato_conferencia_gestor', 'aguardando_assinatura'),
       ('contrato_conferencia_gestor', 'em_elaboracao_contrato'),
       ('contrato_ok_corretor', 'aguardando_assinatura'),
       ('contrato_ok_corretor', 'contrato_conferencia_corretor'),
       ('aguardando_assinatura', 'contrato_assinado'),
       ('aguardando_assinatura', 'em_elaboracao_contrato'),
       ('contrato_assinado', 'ocorrencia_pendente'),
       ('ocorrencia_pendente', 'ocorrencia_analise_financeiro'),
       ('ocorrencia_pendente', 'aguardando_assinatura'),
       ('ocorrencia_devolvida_gestor', 'ocorrencia_analise_financeiro')
     ) then
    allowed := true;
  end if;

  if not allowed
     and public.has_role(actor, 'juridico')
     and (from_status, to_status) in (
       ('aprovada_gestor', 'em_elaboracao_contrato'),
       ('aprovada_gestor', 'enviada_revisao'),
       ('aprovada_gestor', 'devolvida_ajuste'),
       ('em_elaboracao_contrato', 'contrato_conferencia_gestor'),
       ('em_elaboracao_contrato', 'enviada_revisao'),
       ('em_elaboracao_contrato', 'devolvida_ajuste')
     ) then
    allowed := true;
  end if;

  -- Único caminho para concluir: a ocorrência já precisa estar em análise do Financeiro.
  if not allowed
     and public.has_role(actor, 'financeiro')
     and (from_status, to_status) in (
       ('ocorrencia_analise_financeiro', 'ocorrencia_devolvida_gestor'),
       ('ocorrencia_analise_financeiro', 'ocorrencia_concluida'),
       ('ocorrencia_concluida', 'ocorrencia_pendente')
     ) then
    allowed := true;
  end if;

  if not allowed
     and public.has_role(actor, 'financeiro')
     and new.modalidade = 'lancamento'
     and (from_status, to_status) in (
       ('ocorrencia_analise_financeiro', 'devolvida_ajuste'),
       ('ocorrencia_concluida', 'ocorrencia_analise_financeiro')
     ) then
    allowed := true;
  end if;

  if not allowed then
    raise exception 'Transição de status não permitida para este usuário: % -> %', from_status, to_status
      using errcode = '42501';
  end if;

  if from_status = 'aguardando_assinatura'
     and to_status = 'contrato_assinado'
     and not exists (
       select 1 from public.sale_documents d
       where d.sale_id = old.id and d.tipo = 'contrato_assinado'
     ) then
    raise exception 'Anexe o contrato assinado (aba Documentos) antes de marcar como assinado.'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;
