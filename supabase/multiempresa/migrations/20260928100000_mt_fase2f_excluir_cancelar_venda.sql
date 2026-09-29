-- Fase 2f (somente clone/homologação até aprovação de Denis): regra final de excluir/cancelar venda
-- (decisão de Denis de 28/09/2026, com a correção do cancelamento no mesmo dia). Substitui a regra de
-- exclusão da 2e. Roda depois de 1a–2e; não muda dados.
--
-- EXCLUIR (DELETE em sales): só em 'rascunho' e só por
--   * quem criou a venda (sales.corretor_id: a policy sales_insert_corretor exige corretor_id = autor);
--   * gestor ou team_leader que lidera a equipe de quem criou (is_lead_of, inclui co-liderança);
--   * admin ou super_admin (papel da agência) da mesma agência.
--   Não excluem: participante que não criou, financeiro, jurídico, lançamento (salvo criador), staff.
-- CANCELAR (status 'cancelada'): só o dono da plataforma (public.platform_admins, função
--   is_platform_super_admin), em qualquer agência, e só depois do rascunho. O super_admin/admin da
--   agência, gestor e team_leader deixam de cancelar. Caminho único: RPC platform_cancel_sale(venda,
--   motivo). A trigger validate_sale_status_transition recusa 'cancelada' vinda de qualquer outro
--   caminho (change_sale_status, UPDATE direto), inclusive do próprio dono da plataforma.
--   Arquivar não muda.
-- Auditoria: cada cancelamento grava public.platform_sale_cancellations (quem, quando, venda,
--   agência, status anterior, motivo) e o histórico da própria venda (sale_status_history e
--   activity_logs, autor nulo = "Sistema", motivo com o prefixo "[Plataforma]"; o autor não é gravado
--   ali porque o dono da plataforma não é perfil da agência da venda e a FK composta recusaria).
--
-- Falha fechada: sem o dono da plataforma confirmado no banco, sem motivo, em rascunho ou venda
-- inexistente, nada muda. Não abre leitura/edição geral entre agências: a função só troca o status
-- de uma venda pelo id. Backup exato das definições anteriores para o down.
BEGIN;
CREATE TABLE public.mt_2f_backup (kind text NOT NULL, name text PRIMARY KEY, ddl text NOT NULL, owner_name text);
REVOKE ALL ON public.mt_2f_backup FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO public.mt_2f_backup(kind, name, ddl, owner_name)
SELECT 'function', p.oid::regprocedure::text, pg_get_functiondef(p.oid), p.proowner::regrole::text
  FROM pg_proc p
 WHERE p.oid = 'public.validate_sale_status_transition()'::regprocedure;

INSERT INTO public.mt_2f_backup(kind, name, ddl)
SELECT 'policy', format('%I.%I.%I', schemaname, tablename, policyname),
       format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s', policyname, schemaname, tablename,
         permissive, cmd,
         (SELECT string_agg(quote_ident(r), ', ') FROM unnest(roles) r),
         CASE WHEN qual IS NOT NULL THEN ' USING (' || qual || ')' ELSE '' END,
         CASE WHEN with_check IS NOT NULL THEN ' WITH CHECK (' || with_check || ')' ELSE '' END)
  FROM pg_policies
 WHERE (schemaname, tablename, policyname) = ('public', 'sales', 'delete_sales_por_papel');

DO $$ BEGIN
  IF (SELECT count(*) FROM public.mt_2f_backup WHERE kind = 'function') <> 1
     OR (SELECT count(*) FROM public.mt_2f_backup WHERE kind = 'policy') <> 1 THEN
    RAISE EXCEPTION 'Objetos esperados ausentes; abortando 2f';
  END IF;
  IF to_regclass('public.mt_2e_backup') IS NULL
     OR to_regclass('public.platform_admins') IS NULL
     OR to_regprocedure('public.is_platform_super_admin(uuid)') IS NULL
     OR to_regprocedure('public.is_lead_of(uuid,uuid)') IS NULL
     OR to_regprocedure('public.current_org_id()') IS NULL
     OR to_regprocedure('public.is_sale_responsavel(uuid,uuid)') IS NULL
     OR to_regprocedure('public.is_lead_of_sale_responsavel(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pre-requisitos 1a-2e / 20260929100000 (atribuicao) ausentes; abortando 2f';
  END IF;
END $$;

-- 1) Excluir venda.
DROP POLICY delete_sales_por_papel ON public.sales;
CREATE POLICY delete_sales_por_papel ON public.sales AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    status = 'rascunho'::public.sale_status
    AND public.is_active_user((SELECT auth.uid()))
    AND (
      corretor_id = (SELECT auth.uid())
      OR public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::public.app_role[])
      OR (public.has_any_role((SELECT auth.uid()), ARRAY['gestor','team_leader']::public.app_role[])
          AND public.is_lead_of((SELECT auth.uid()), corretor_id))
    )
  );

-- 2) Auditoria dos cancelamentos (tabela da PLATAFORMA, como platform_admins: não é dado de uma
--    agência; só o dono da plataforma lê; ninguém grava direto, só a função abaixo).
CREATE TABLE public.platform_sale_cancellations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id uuid NOT NULL,
  sale_organization_id uuid NOT NULL REFERENCES public.organizations(id),
  actor_user_id uuid NOT NULL,
  status_anterior text NOT NULL,
  motivo text NOT NULL CHECK (btrim(motivo) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_sale_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_sale_cancellations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.platform_sale_cancellations TO authenticated, service_role;
CREATE POLICY platform_sale_cancellations_select ON public.platform_sale_cancellations
  AS PERMISSIVE FOR SELECT TO authenticated USING (public.is_platform_super_admin((SELECT auth.uid())));

-- 3) Trigger de status: 'cancelada' só pelo caminho da plataforma. Resto idêntico ao anterior, menos
--    'cancelada' no ramo do gestor/team_leader (arquivar continua).
CREATE OR REPLACE FUNCTION public.validate_sale_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := auth.uid();
  is_owner boolean := public.is_sale_responsavel(auth.uid(), old.id);
  allowed boolean := false;
  from_status text := old.status::text;
  to_status text := new.status::text;
begin
  if new.status is not distinct from old.status then return new; end if;

  -- Fase 2f: cancelar venda = só o dono da plataforma, via platform_cancel_sale, depois do rascunho.
  if to_status = 'cancelada' then
    if from_status = 'rascunho' then
      raise exception 'Venda em rascunho não é cancelada: use Excluir venda.' using errcode = '42501';
    end if;
    if actor is not null
       and public.is_platform_super_admin(actor)
       and current_setting('mt.platform_cancel_sale', true) = old.id::text then
      return new;
    end if;
    raise exception 'Somente o dono da plataforma cancela venda.' using errcode = '42501';
  end if;

  if public.has_any_role(actor, array['admin','super_admin']::app_role[]) then return new; end if;

  if to_status = 'arquivada'
     and public.has_any_role(actor, array['gestor','team_leader']::app_role[])
     and public.is_lead_of_sale_responsavel(actor, old.id)
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
     and public.is_lead_of_sale_responsavel(actor, old.id) then
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

-- 4) Caminho único do cancelamento. Dono = papel da migration (BYPASSRLS, como platform_*): precisa
--    alcançar venda de outra agência; por isso só age sobre UMA venda pelo id e só para o dono da
--    plataforma. Não devolve dados da venda.
CREATE FUNCTION public.platform_cancel_sale(_sale_id uuid, _motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _prev text;
  _org uuid;
  _motivo_limpo text := nullif(btrim(_motivo), '');
  _claims text;
  _claim_sub text;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Somente o dono da plataforma cancela venda.' USING ERRCODE = '42501';
  END IF;
  IF _motivo_limpo IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo para cancelar a venda.' USING ERRCODE = '23514';
  END IF;
  SELECT status::text, organization_id INTO _prev, _org FROM public.sales WHERE id = _sale_id FOR UPDATE;
  IF _prev IS NULL THEN
    RAISE EXCEPTION 'Venda não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF _prev = 'rascunho' THEN
    RAISE EXCEPTION 'Venda em rascunho não é cancelada: use Excluir venda.' USING ERRCODE = '42501';
  END IF;
  IF _prev = 'cancelada' THEN
    RAISE EXCEPTION 'Venda já está cancelada.' USING ERRCODE = '23514';
  END IF;

  -- A trigger de status só aceita 'cancelada' com esta marca local (vale só nesta transação).
  PERFORM set_config('mt.platform_cancel_sale', _sale_id::text, true);
  UPDATE public.sales SET status = 'cancelada'::public.sale_status WHERE id = _sale_id;
  PERFORM set_config('mt.platform_cancel_sale', '', true);

  INSERT INTO public.platform_sale_cancellations(sale_id, sale_organization_id, actor_user_id, status_anterior, motivo)
  VALUES (_sale_id, _org, _actor, _prev, _motivo_limpo);

  -- Histórico da venda na agência dela: sem autor (o dono da plataforma não é perfil dessa agência e
  -- o gatilho de organização recusaria o vínculo); a autoria fica na tabela acima.
  _claims := current_setting('request.jwt.claims', true);
  _claim_sub := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  INSERT INTO public.sale_status_history (sale_id, de, para, autor_id, motivo, organization_id)
  VALUES (_sale_id, _prev::public.sale_status, 'cancelada', NULL, '[Plataforma] ' || _motivo_limpo, _org);
  INSERT INTO public.activity_logs (autor_id, sale_id, acao, payload, organization_id)
  VALUES (NULL, _sale_id, 'status_change',
          jsonb_build_object('de', _prev, 'para', 'cancelada', 'motivo', _motivo_limpo, 'origem', 'plataforma'), _org);
  PERFORM set_config('request.jwt.claims', coalesce(_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(_claim_sub, ''), true);
END $function$;
REVOKE ALL ON FUNCTION public.platform_cancel_sale(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_cancel_sale(uuid, text) TO authenticated;

-- CREATE OR REPLACE preserva dono e ACL; conferir para falhar fechado.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT * FROM public.mt_2f_backup WHERE kind = 'function' LOOP
    IF (SELECT proowner::regrole::text FROM pg_proc WHERE oid = f.name::regprocedure) <> f.owner_name THEN
      RAISE EXCEPTION 'Dono de % mudou; abortando 2f', f.name;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.platform_cancel_sale(uuid,text)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.platform_sale_cancellations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.platform_sale_cancellations', 'INSERT')
     OR has_table_privilege('authenticated', 'public.platform_sale_cancellations', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.platform_sale_cancellations', 'DELETE') THEN
    RAISE EXCEPTION 'Privilegios abertos demais; abortando 2f';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sales' AND policyname = 'org_isolation' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'Isolamento por agencia ausente; abortando 2f';
  END IF;
END $$;
COMMIT;
