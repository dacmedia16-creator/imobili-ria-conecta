-- Regra de Denis (28/09/2026) para excluir e cancelar venda — publicação isolada na Única Escolha.
--
-- EXCLUIR (policy delete_sales_por_papel): só em 'rascunho', e só por quem criou a venda
--   (sales.corretor_id — a policy sales_insert_corretor exige corretor_id = auth.uid() no INSERT),
--   Gestor/Team Leader da equipe (is_lead_of), Administrador ou Super Admin.
--   Financeiro, Jurídico, Staff e participante que não criou deixam de excluir.
-- CANCELAR (trigger validate_sale_status_transition): só depois do rascunho e só o dono da
--   plataforma (public.platform_admins, mesmo esquema da fase 1a multiempresa). Admin, Super Admin,
--   Gestor e Team Leader perdem o cancelamento. Arquivar não muda.
--   Auditoria: o cancelamento continua passando por change_sale_status, que exige motivo e grava
--   sale_status_history (autor, data, motivo) e activity_logs na mesma transação.
--
-- Compatibilidade com a multiempresa: platform_admins e is_platform_super_admin(uuid) têm o mesmo
-- esquema/assinatura/grants da 1a, que passa a tratá-los como já existentes.
-- Sem DML de vendas. O cadastro do dono da plataforma é feito à parte (dado, não versionado).
-- Rollback literal: docs/sql/rollback/20260929090000_excluir_cancelar_venda.rollback.sql
BEGIN;
-- Dono atual do trigger, para conferir no fim que o CREATE OR REPLACE o preservou.
CREATE TEMP TABLE ecv_owner ON COMMIT DROP AS
  SELECT proowner FROM pg_proc WHERE oid = 'public.validate_sale_status_transition()'::regprocedure;

CREATE TABLE public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Marca de origem: a 1a multiempresa (CREATE ... IF NOT EXISTS) e o rollback dela leem este comentário
-- para NÃO apagar a tabela/função criadas aqui (preserva o cadastro do dono da plataforma).
COMMENT ON TABLE public.platform_admins IS 'origem:20260929090000_excluir_cancelar_venda';
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_admins FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_admins TO service_role;

CREATE FUNCTION public.is_platform_super_admin(_user uuid DEFAULT auth.uid()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _user IS NOT NULL AND EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _user)
$$;
REVOKE ALL ON FUNCTION public.is_platform_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_super_admin(uuid) TO authenticated, service_role;

-- Excluir: só rascunho; criador, líder da equipe, admin ou super_admin.
DROP POLICY delete_sales_por_papel ON public.sales;
CREATE POLICY delete_sales_por_papel ON public.sales AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    status = 'rascunho'::public.sale_status
    AND public.is_active_user((SELECT auth.uid()))
    AND (
      public.has_any_role((SELECT auth.uid()), ARRAY['super_admin','admin']::public.app_role[])
      OR corretor_id = (SELECT auth.uid())
      OR (public.has_any_role((SELECT auth.uid()), ARRAY['gestor','team_leader']::public.app_role[])
          AND public.is_lead_of((SELECT auth.uid()), corretor_id))
    )
  );

-- Cancelar: só o dono da plataforma, fora do rascunho. Única mudança: o bloco "cancelada" no início;
-- o restante é a definição implantada em 28/09/2026 (md5 c31d105c03b81f2777ee5b307b30f6d4).
CREATE OR REPLACE FUNCTION public.validate_sale_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := auth.uid();
  is_owner boolean := (old.corretor_id = auth.uid());
  allowed boolean := false;
  from_status text := old.status::text;
  to_status text := new.status::text;
begin
  if new.status is not distinct from old.status then return new; end if;

  if to_status = 'cancelada' then
    if from_status = 'rascunho' then
      raise exception 'Venda em rascunho não é cancelada: exclua o rascunho.' using errcode = '42501';
    end if;
    if not (public.is_active_user(actor) and public.is_platform_super_admin(actor)) then
      raise exception 'Somente o dono da plataforma pode cancelar vendas.' using errcode = '42501';
    end if;
    return new;
  end if;

  if public.has_any_role(actor, array['admin','super_admin']::app_role[]) then return new; end if;

  if to_status in ('cancelada', 'arquivada')
     and public.has_any_role(actor, array['gestor','team_leader']::app_role[])
     and public.is_lead_of(actor, old.corretor_id)
     and from_status in (
       'enviada_revisao', 'contrato_conferencia_gestor', 'contrato_ok_corretor',
       'aguardando_assinatura', 'contrato_assinado', 'ocorrencia_pendente',
       'ocorrencia_devolvida_gestor'
     ) then
    return new;
  end if;

  if is_owner and (from_status, to_status) in (
    ('rascunho', 'enviada_revisao'), ('devolvida_ajuste', 'enviada_revisao'),
    ('contrato_conferencia_corretor', 'contrato_ok_corretor'),
    ('contrato_conferencia_corretor', 'contrato_conferencia_gestor')
  ) then allowed := true; end if;

  if not allowed and is_owner and public.has_any_role(actor, array['gestor','team_leader']::app_role[]) and (from_status, to_status) in (
    ('rascunho', 'aprovada_gestor'), ('devolvida_ajuste', 'aprovada_gestor')
  ) then allowed := true; end if;

  if not allowed
     and from_status = 'rascunho'
     and to_status = 'aprovada_gestor'
     and public.has_any_role(actor, array['gestor','team_leader']::app_role[])
     and public.is_lead_of(actor, old.corretor_id) then
    allowed := true;
  end if;

  if not allowed and is_owner and public.has_role(actor, 'lancamento'::app_role) and (from_status, to_status) in (
    ('rascunho', 'ocorrencia_analise_financeiro'),
    ('devolvida_ajuste', 'ocorrencia_analise_financeiro')
  ) then allowed := true; end if;

  if not allowed and public.has_any_role(actor, array['gestor','team_leader']::app_role[]) and (from_status, to_status) in (
    ('enviada_revisao', 'aprovada_gestor'), ('enviada_revisao', 'devolvida_ajuste'),
    ('contrato_conferencia_gestor', 'contrato_conferencia_corretor'),
    ('contrato_conferencia_gestor', 'aguardando_assinatura'),
    ('contrato_conferencia_gestor', 'em_elaboracao_contrato'),
    ('contrato_ok_corretor', 'aguardando_assinatura'),
    ('contrato_ok_corretor', 'contrato_conferencia_corretor'),
    ('contrato_ok_corretor', 'em_elaboracao_contrato'),
    ('aguardando_assinatura', 'contrato_assinado'),
    ('aguardando_assinatura', 'em_elaboracao_contrato'),
    ('contrato_assinado', 'ocorrencia_pendente'), ('contrato_assinado', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'ocorrencia_analise_financeiro'),
    ('ocorrencia_pendente', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'aguardando_assinatura'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_analise_financeiro'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_concluida')
  ) then allowed := true; end if;

  if not allowed and public.has_role(actor, 'juridico') and (from_status, to_status) in (
    ('aprovada_gestor', 'em_elaboracao_contrato'), ('aprovada_gestor', 'enviada_revisao'),
    ('aprovada_gestor', 'devolvida_ajuste'),
    ('em_elaboracao_contrato', 'contrato_conferencia_gestor'),
    ('em_elaboracao_contrato', 'enviada_revisao'), ('em_elaboracao_contrato', 'devolvida_ajuste')
  ) then allowed := true; end if;

  if not allowed and public.has_role(actor, 'financeiro') and (from_status, to_status) in (
    ('ocorrencia_analise_financeiro', 'ocorrencia_devolvida_gestor'),
    ('ocorrencia_analise_financeiro', 'ocorrencia_concluida'),
    ('contrato_assinado', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'ocorrencia_concluida'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_concluida'),
    ('ocorrencia_concluida', 'ocorrencia_pendente')
  ) then allowed := true; end if;

  if not allowed and public.has_role(actor, 'financeiro') and new.modalidade = 'lancamento' and (from_status, to_status) in (
    ('ocorrencia_analise_financeiro', 'devolvida_ajuste'),
    ('ocorrencia_concluida', 'ocorrencia_analise_financeiro')
  ) then allowed := true; end if;

  if not allowed then
    raise exception 'Transição de status não permitida para este usuário: % -> %', from_status, to_status using errcode = '42501';
  end if;

  if from_status = 'aguardando_assinatura' and to_status = 'contrato_assinado'
     and not exists (select 1 from public.sale_documents d where d.sale_id = old.id and d.tipo = 'contrato_assinado') then
    raise exception 'Anexe o contrato assinado (aba Documentos) antes de marcar como assinado.' using errcode = '23514';
  end if;
  return new;
end;
$function$;

-- Falha fechada: dono/ACL preservados e anon sem acesso à tabela nova.
DO $$ BEGIN
  IF (SELECT proowner FROM pg_proc WHERE oid = 'public.validate_sale_status_transition()'::regprocedure)
     IS DISTINCT FROM (SELECT proowner FROM ecv_owner) THEN
    RAISE EXCEPTION 'Dono de validate_sale_status_transition mudou; abortando';
  END IF;
  IF has_function_privilege('anon', 'public.is_platform_super_admin(uuid)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.platform_admins', 'SELECT')
     OR has_table_privilege('authenticated', 'public.platform_admins', 'SELECT') THEN
    RAISE EXCEPTION 'platform_admins/is_platform_super_admin expostos; abortando';
  END IF;
END $$;
COMMIT;
