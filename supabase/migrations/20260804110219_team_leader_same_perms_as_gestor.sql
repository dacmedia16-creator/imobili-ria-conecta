-- Team Leader ganha exatamente as mesmas permissões que Gestor já tinha: mesmas funções
-- SECURITY DEFINER usadas pelas policies de venda/ocorrência, e as poucas policies que citavam
-- 'gestor' literalmente. Não mexe em is_lead_of/sees_own_team_leader (já são estruturais, baseadas
-- em teams.lider_id, e continuam valendo pra qualquer papel).

-- Quem pode liderar uma equipe (teams.lider_id): gestor OU team_leader.
CREATE OR REPLACE FUNCTION public.enforce_team_leader_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_any_role(NEW.lider_id, ARRAY['gestor', 'team_leader']::public.app_role[]) THEN
    RAISE EXCEPTION 'O líder de uma equipe precisa ter o papel gestor ou team leader.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.can_edit_sale_comissao(_user uuid, _sale_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.is_active_user(_user) AND (
      public.has_any_role(_user, ARRAY['financeiro','admin','super_admin']::public.app_role[])
      OR (
        public.has_any_role(_user, ARRAY['gestor','team_leader']::public.app_role[])
        AND NOT public.is_sale_locked(_sale_id)
        AND EXISTS (
          SELECT 1 FROM public.sales s
          WHERE s.id = _sale_id
          AND s.status::text = ANY(ARRAY[
            'enviada_revisao','contrato_conferencia_gestor','contrato_ok_corretor',
            'aguardando_assinatura','contrato_assinado','ocorrencia_pendente','ocorrencia_devolvida_gestor'
          ])
        )
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.can_edit_sale_stage(_user uuid, _sale_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select public.is_active_user(_user) and exists (
    select 1 from public.sales s
    where s.id = _sale_id
    and (
      public.has_any_role(_user, array['financeiro','admin','super_admin']::public.app_role[])
      or (s.corretor_id = _user and s.status::text = any(array['rascunho','devolvida_ajuste','contrato_conferencia_corretor']))
      or (public.has_any_role(_user, array['gestor','team_leader']::public.app_role[]) and s.status::text = any(array[
            'enviada_revisao','contrato_conferencia_gestor','contrato_ok_corretor',
            'aguardando_assinatura','contrato_assinado','ocorrencia_pendente','ocorrencia_devolvida_gestor']))
      or (public.has_role(_user,'juridico') and s.status::text = any(array['aprovada_gestor','em_elaboracao_contrato']))
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.can_view_sale(_user uuid, _sale_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.is_active_user(_user) AND EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id AND (
      s.corretor_id = _user
      OR public.has_any_role(_user, ARRAY['financeiro','admin','super_admin']::public.app_role[])
      OR (public.has_any_role(_user, ARRAY['gestor','team_leader']::public.app_role[]) AND public.is_lead_of(_user, s.corretor_id))
      OR (public.has_role(_user,'juridico'::public.app_role) AND s.status::text = ANY (ARRAY[
        'aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
        'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor',
        'aguardando_assinatura','contrato_assinado',
        'ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
      ]))
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public.update_contrato_pendencia(_sale_id uuid, _pendencia_descricao text, _libera_assinatura boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_view_sale(auth.uid(), _sale_id) THEN
    RAISE EXCEPTION 'Sem permissão para editar esta venda.';
  END IF;

  IF NOT public.has_any_role(auth.uid(), ARRAY['gestor','team_leader','juridico','financeiro','admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Somente gestor, jurídico, financeiro ou admin podem editar a pendência do contrato.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id
    AND s.status::text = ANY(ARRAY[
      'em_elaboracao_contrato','contrato_conferencia_gestor','contrato_conferencia_corretor',
      'contrato_ok_corretor','aguardando_assinatura'
    ])
  ) THEN
    RAISE EXCEPTION 'A pendência do contrato só pode ser editada durante as etapas de elaboração/conferência/assinatura do contrato.';
  END IF;

  UPDATE public.sales
  SET contrato_pendencia_descricao = _pendencia_descricao,
      contrato_libera_assinatura = _libera_assinatura
  WHERE id = _sale_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_sale_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  is_owner boolean := (OLD.corretor_id = auth.uid());
  allowed boolean := false;
  from_status text := OLD.status::text;
  to_status text := NEW.status::text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF public.has_any_role(actor, ARRAY['admin','super_admin']::app_role[]) THEN
    RETURN NEW;
  END IF;

  IF is_owner AND (from_status, to_status) IN (
    ('rascunho', 'enviada_revisao'),
    ('devolvida_ajuste', 'enviada_revisao'),
    ('contrato_conferencia_corretor', 'contrato_ok_corretor'),
    ('contrato_conferencia_corretor', 'contrato_conferencia_gestor')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND public.has_any_role(actor, ARRAY['gestor','team_leader']::app_role[]) AND (from_status, to_status) IN (
    ('enviada_revisao', 'aprovada_gestor'),
    ('enviada_revisao', 'devolvida_ajuste'),
    ('contrato_conferencia_gestor', 'contrato_conferencia_corretor'),
    ('contrato_conferencia_gestor', 'aguardando_assinatura'),
    ('contrato_conferencia_gestor', 'em_elaboracao_contrato'),
    ('contrato_ok_corretor', 'aguardando_assinatura'),
    ('contrato_ok_corretor', 'contrato_conferencia_corretor'),
    ('aguardando_assinatura', 'contrato_assinado'),
    ('contrato_assinado', 'ocorrencia_pendente'),
    ('contrato_assinado', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'ocorrencia_analise_financeiro'),
    ('ocorrencia_pendente', 'ocorrencia_concluida'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_analise_financeiro'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_concluida')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND public.has_role(actor, 'juridico') AND (from_status, to_status) IN (
    ('aprovada_gestor', 'em_elaboracao_contrato'),
    ('aprovada_gestor', 'enviada_revisao'),
    ('aprovada_gestor', 'devolvida_ajuste'),
    ('em_elaboracao_contrato', 'contrato_conferencia_gestor'),
    ('em_elaboracao_contrato', 'enviada_revisao'),
    ('em_elaboracao_contrato', 'devolvida_ajuste')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND public.has_role(actor, 'financeiro') AND (from_status, to_status) IN (
    ('ocorrencia_analise_financeiro', 'ocorrencia_devolvida_gestor'),
    ('ocorrencia_analise_financeiro', 'ocorrencia_concluida'),
    ('contrato_assinado', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'ocorrencia_concluida'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_concluida'),
    ('ocorrencia_concluida', 'ocorrencia_pendente')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Transição de status não permitida para este usuário: % -> %', from_status, to_status
      USING ERRCODE = '42501';
  END IF;

  IF from_status = 'aguardando_assinatura' AND to_status = 'contrato_assinado' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.sale_documents d
      WHERE d.sale_id = OLD.id AND d.tipo = 'contrato_assinado'
    ) THEN
      RAISE EXCEPTION 'Anexe o contrato assinado (aba Documentos) antes de marcar como assinado.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Policies que citavam 'gestor' literalmente na lista de papéis (as demais tabelas de venda já
-- passam por can_view_sale/can_edit_sale_stage/can_edit_sale_comissao, atualizadas acima).
DROP POLICY IF EXISTS notif_insert ON public.notifications;
CREATE POLICY notif_insert ON public.notifications FOR INSERT TO authenticated
WITH CHECK (
  (user_id = (SELECT auth.uid()))
  OR has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin','financeiro','gestor','team_leader','juridico']::app_role[])
);

DROP POLICY IF EXISTS occ_write ON public.occurrences;
CREATE POLICY occ_write ON public.occurrences FOR ALL TO authenticated
USING (
  has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin','gestor','team_leader']::app_role[])
  AND can_view_sale((SELECT auth.uid()), sale_id)
)
WITH CHECK (
  has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin','gestor','team_leader']::app_role[])
  AND can_view_sale((SELECT auth.uid()), sale_id)
  AND ((NOT is_sale_locked(sale_id)) OR has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin']::app_role[]))
);

DROP POLICY IF EXISTS occ_comm_write ON public.occurrence_commissions;
CREATE POLICY occ_comm_write ON public.occurrence_commissions FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM occurrences o
    WHERE o.id = occurrence_commissions.occurrence_id
    AND has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin','gestor','team_leader']::app_role[])
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM occurrences o
    WHERE o.id = occurrence_commissions.occurrence_id
    AND has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin','gestor','team_leader']::app_role[])
    AND ((NOT is_sale_locked(o.sale_id)) OR has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin']::app_role[]))
  )
);

DROP POLICY IF EXISTS occ_part_write ON public.occurrence_partners;
CREATE POLICY occ_part_write ON public.occurrence_partners FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM occurrences o
    WHERE o.id = occurrence_partners.occurrence_id
    AND has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin','gestor','team_leader']::app_role[])
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM occurrences o
    WHERE o.id = occurrence_partners.occurrence_id
    AND has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin','gestor','team_leader']::app_role[])
    AND ((NOT is_sale_locked(o.sale_id)) OR has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin']::app_role[]))
  )
);

DROP POLICY IF EXISTS profiles_self_select ON public.profiles;
CREATE POLICY profiles_self_select ON public.profiles FOR SELECT TO authenticated
USING (
  (id = (SELECT auth.uid()))
  OR has_any_role((SELECT auth.uid()), ARRAY['gestor','team_leader','juridico','financeiro','admin','super_admin']::app_role[])
  OR sees_own_team_leader(id, (SELECT auth.uid()))
);

DROP POLICY IF EXISTS delete_sales_por_papel ON public.sales;
CREATE POLICY delete_sales_por_papel ON public.sales FOR DELETE TO authenticated
USING (
  is_active_user((SELECT auth.uid()))
  AND (status = ANY (ARRAY['rascunho','devolvida_ajuste','enviada_revisao']::sale_status[]))
  AND (
    has_any_role((SELECT auth.uid()), ARRAY['super_admin','admin','financeiro']::app_role[])
    OR (corretor_id = (SELECT auth.uid()))
    OR (has_any_role((SELECT auth.uid()), ARRAY['gestor','team_leader']::app_role[]) AND is_lead_of((SELECT auth.uid()), corretor_id))
  )
);

DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY sales_select ON public.sales FOR SELECT TO authenticated
USING (
  is_active_user((SELECT auth.uid()))
  AND (
    (corretor_id = (SELECT auth.uid()))
    OR has_any_role((SELECT auth.uid()), ARRAY['financeiro','admin','super_admin']::app_role[])
    OR (has_any_role((SELECT auth.uid()), ARRAY['gestor','team_leader']::app_role[]) AND is_lead_of((SELECT auth.uid()), corretor_id))
    OR (has_role((SELECT auth.uid()), 'juridico'::app_role) AND (status::text = ANY (ARRAY[
      'aprovada_gestor','enviada_juridico','em_elaboracao_contrato','contrato_conferencia_gestor',
      'contrato_conferencia_corretor','contrato_ok_corretor','aguardando_assinatura','contrato_assinado',
      'ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
    ])))
  )
);
