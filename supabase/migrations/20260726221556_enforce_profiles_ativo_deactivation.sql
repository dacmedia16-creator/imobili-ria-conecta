-- Recuperado de supabase_migrations.schema_migrations (versão 20260726221556) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

-- profiles.ativo nao tinha efeito real: nenhuma policy usava a coluna, e
-- profiles_self_update deixava qualquer usuario mudar a propria coluna ativo
-- (inclusive se reativando sozinho depois de ser desativado por um admin).
--
-- Fix em 3 partes:
-- 1) is_active_user() entra em has_role/has_any_role e nos 3 gates centrais
--    de venda (can_view_sale/can_edit_sale_stage/can_edit_sale_comissao) --
--    cobre praticamente todo acesso a dado de negocio (vendas e tudo que
--    pendura nelas: documentos, pagamento, partes, comentarios, ocorrencias,
--    comissoes, contas bancarias, historico) e toda capacidade baseada em
--    papel (financeiro/gestor/juridico/admin/super_admin) no sistema todo.
-- 2) sales_select/delete_sales_por_papel tinham "corretor_id = auth.uid()"
--    direto, sem passar por has_role nem can_view_sale -- um corretor
--    desativado continuava enxergando/apagando as proprias vendas. Ajustado
--    para exigir is_active_user tambem.
-- 3) Trigger em profiles bloqueia qualquer UPDATE que mude "ativo" vindo de
--    quem nao e admin/super_admin -- fecha a auto-reativacao.
--
-- Fora de escopo (decisao consciente, nao e dado de negocio): profiles/
-- team_members/teams/notifications/user_roles continuam deixando o proprio
-- usuario ver seu proprio registro basico mesmo desativado (ex.: still sees
-- "estou nesse time"), e teams_write ainda tem um "lider_id = auth.uid()"
-- direto que nao foi tocado aqui.

CREATE OR REPLACE FUNCTION public.is_active_user(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT ativo FROM public.profiles WHERE id = _user), true);
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_active_user(_user_id)
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_active_user(_user_id)
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles))
$$;

CREATE OR REPLACE FUNCTION public.can_view_sale(_user uuid, _sale_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.is_active_user(_user) AND EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.id = _sale_id AND (
      s.corretor_id = _user
      OR public.has_any_role(_user, ARRAY['financeiro','admin','super_admin']::public.app_role[])
      OR (public.has_role(_user,'gestor'::public.app_role) AND public.is_lead_of(_user, s.corretor_id))
      OR (public.has_role(_user,'juridico'::public.app_role) AND s.status::text = ANY (ARRAY[
        'aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
        'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor',
        'aguardando_assinatura','contrato_assinado',
        'ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
      ]))
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_sale_stage(_user uuid, _sale_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select public.is_active_user(_user) and exists (
    select 1 from public.sales s
    where s.id = _sale_id
    and (
      public.has_any_role(_user, array['financeiro','admin','super_admin']::public.app_role[])
      or (s.corretor_id = _user and s.status::text = any(array['rascunho','devolvida_ajuste','contrato_conferencia_corretor']))
      or (public.has_role(_user,'gestor') and s.status::text = any(array[
            'enviada_revisao','contrato_conferencia_gestor','contrato_ok_corretor',
            'aguardando_assinatura','contrato_assinado','ocorrencia_pendente','ocorrencia_devolvida_gestor']))
      or (public.has_role(_user,'juridico') and s.status::text = any(array['aprovada_gestor','em_elaboracao_contrato']))
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_sale_comissao(_user uuid, _sale_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.is_active_user(_user) AND (
      public.has_any_role(_user, ARRAY['financeiro','admin','super_admin']::public.app_role[])
      OR (
        public.has_role(_user, 'gestor'::public.app_role)
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
$$;

DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY sales_select ON public.sales FOR SELECT TO authenticated
USING (
  public.is_active_user(auth.uid()) AND (
    corretor_id = auth.uid()
    OR has_any_role(auth.uid(), ARRAY['financeiro'::app_role, 'admin'::app_role, 'super_admin'::app_role])
    OR (has_role(auth.uid(), 'gestor'::app_role) AND is_lead_of(auth.uid(), corretor_id))
    OR (has_role(auth.uid(), 'juridico'::app_role) AND (status::text = ANY (ARRAY[
      'aprovada_gestor','enviada_juridico','em_elaboracao_contrato',
      'contrato_conferencia_gestor','contrato_conferencia_corretor','contrato_ok_corretor',
      'aguardando_assinatura','contrato_assinado',
      'ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida'
    ])))
  )
);

DROP POLICY IF EXISTS delete_sales_por_papel ON public.sales;
CREATE POLICY delete_sales_por_papel ON public.sales FOR DELETE
USING (
  public.is_active_user(auth.uid()) AND (
    has_any_role(auth.uid(), ARRAY['super_admin'::app_role, 'admin'::app_role, 'financeiro'::app_role])
    OR (corretor_id = auth.uid() AND NOT is_sale_locked(id))
    OR (has_role(auth.uid(), 'gestor'::app_role) AND is_lead_of(auth.uid(), corretor_id) AND NOT is_sale_locked(id))
  )
);

CREATE OR REPLACE FUNCTION public.enforce_profiles_ativo_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.ativo IS DISTINCT FROM OLD.ativo
     AND NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Somente admin ou super_admin pode ativar/desativar um usuario.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_profiles_ativo_lock ON public.profiles;
CREATE TRIGGER trg_enforce_profiles_ativo_lock
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.enforce_profiles_ativo_lock();
