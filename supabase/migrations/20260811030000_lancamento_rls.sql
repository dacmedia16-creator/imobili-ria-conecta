-- RLS pro papel "Lançamento": pode criar a própria venda de lançamento, editar a divisão de comissão
-- dela enquanto rascunho, e mandar direto pro financeiro (ver migration seguinte, RPC
-- criar_ocorrencia_lancamento) -- sem passar por revisão de gestor/jurídico/contrato.

DROP POLICY IF EXISTS sales_insert_corretor ON public.sales;
CREATE POLICY sales_insert_corretor ON public.sales AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (
  (corretor_id = (select auth.uid()))
  AND (
    has_role((select auth.uid()), 'corretor'::app_role)
    OR has_any_role((select auth.uid()), ARRAY['gestor'::app_role, 'team_leader'::app_role])
    OR (has_role((select auth.uid()), 'lancamento'::app_role) AND modalidade = 'lancamento')
  )
);

-- can_edit_sale_comissao hoje só libera gestor/team_leader (a partir de enviada_revisao) ou
-- financeiro/admin/super_admin -- nunca o corretor dono, nem em rascunho. Lançamento quebra essa
-- regra de propósito: quem preenche o formulário É quem monta a divisão de comissão, sem revisão
-- de gestor no meio (decisão do usuário) -- daí o novo ramo, restrito à própria venda de lançamento
-- em rascunho.
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
      OR (
        public.has_role(_user, 'lancamento'::public.app_role)
        AND EXISTS (
          SELECT 1 FROM public.sales s
          WHERE s.id = _sale_id
          AND s.corretor_id = _user
          AND s.modalidade = 'lancamento'
          AND s.status::text = 'rascunho'
        )
      )
    );
$function$;

-- Único hop de status que o Lançamento usa: rascunho -> ocorrencia_analise_financeiro, direto pro
-- financeiro, sem enviada_revisao/aprovada_gestor/contrato. Disparado pela RPC
-- criar_ocorrencia_lancamento (próxima migration), nunca por update direto do client.
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

  IF NOT allowed AND is_owner AND public.has_any_role(actor, ARRAY['gestor','team_leader']::app_role[]) AND (from_status, to_status) IN (
    ('rascunho', 'aprovada_gestor'),
    ('devolvida_ajuste', 'aprovada_gestor')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND is_owner AND public.has_role(actor, 'lancamento'::app_role) AND (from_status, to_status) IN (
    ('rascunho', 'ocorrencia_analise_financeiro')
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
