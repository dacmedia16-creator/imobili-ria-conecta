-- Minha carreira, PR 2 (card t_0219ca7f; "pode executar" de Denis em 15/10/2026): bloco "Meu mês".
-- 1) minhas_metas: a meta que o PRÓPRIO corretor define (mês e ano), separada da tabela "metas" da
--    gestão (que continua igual: só gestor/admin gravam e o relatório de metas não muda).
--    RLS: o corretor lê e escreve só a própria linha, na organização ativa; anon não acessa.
-- 2) carreira_taxas: taxas da calculadora de trás para frente. user_id NULL = padrão da imobiliária
--    (só admin/gestor gravam); user_id = corretor = ajuste dele (só ele grava).
-- 3) meu_realizado(_inicio, _fim): SÓ LEITURA, sempre auth.uid() + current_org_id(). Mesma regra dos
--    relatórios (participacoes_comerciais_validas / vendas_comerciais_canonicas: mês da assinatura, SP).
--      comissao  = soma da comissão individual do corretor nas vendas válidas do período;
--      vendas    = vendas válidas em que ele tem comissão;
--      vgv       = VGV próprio (sem parceria externa) dessas vendas, sem dividir entre participantes;
--      captacoes = captações exclusivas aprovadas no período (NULL se o módulo estiver desligado);
--      como_captador / como_vendedor (+ VGV): vendas válidas em que ele é captador / vendedor.
-- Nenhuma venda, captação ou meta existente é alterada.
-- Rollback: supabase/rollback/20261016120000_minha_carreira_meu_mes.sql
BEGIN;

-- 1) Metas do próprio corretor ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.minhas_metas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id() REFERENCES public.organizations(id),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  periodo text NOT NULL CHECK (periodo IN ('mes', 'ano')),
  inicio date NOT NULL,
  meta_comissao numeric(14,2) CHECK (meta_comissao IS NULL OR meta_comissao >= 0),
  meta_vgv numeric(16,2) CHECK (meta_vgv IS NULL OR meta_vgv >= 0),
  meta_vendas integer CHECK (meta_vendas IS NULL OR meta_vendas BETWEEN 0 AND 10000),
  meta_captacoes integer CHECK (meta_captacoes IS NULL OR meta_captacoes BETWEEN 0 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT minhas_metas_inicio_check CHECK (
    (periodo = 'mes' AND inicio = date_trunc('month', inicio)::date)
    OR (periodo = 'ano' AND inicio = date_trunc('year', inicio)::date)),
  CONSTRAINT minhas_metas_unica UNIQUE (organization_id, user_id, periodo, inicio)
);

-- 2) Taxas da calculadora --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.carreira_taxas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id() REFERENCES public.organizations(id),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE, -- NULL = padrão da imobiliária
  comissao_media numeric(14,2) CHECK (comissao_media IS NULL OR comissao_media > 0),
  ligacoes_por_visita numeric(8,2) NOT NULL DEFAULT 10 CHECK (ligacoes_por_visita > 0 AND ligacoes_por_visita <= 1000),
  visitas_por_acm numeric(8,2) NOT NULL DEFAULT 3 CHECK (visitas_por_acm > 0 AND visitas_por_acm <= 1000),
  acms_por_venda numeric(8,2) NOT NULL DEFAULT 4 CHECK (acms_por_venda > 0 AND acms_por_venda <= 1000),
  acms_por_captacao numeric(8,2) NOT NULL DEFAULT 2 CHECK (acms_por_captacao > 0 AND acms_por_captacao <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carreira_taxas_unica UNIQUE NULLS NOT DISTINCT (organization_id, user_id)
);

CREATE TRIGGER trg_minhas_metas_updated BEFORE UPDATE ON public.minhas_metas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_carreira_taxas_updated BEFORE UPDATE ON public.carreira_taxas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) Acesso ----------------------------------------------------------------------------------
ALTER TABLE public.minhas_metas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carreira_taxas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.minhas_metas, public.carreira_taxas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.minhas_metas, public.carreira_taxas TO authenticated;
GRANT ALL ON public.minhas_metas, public.carreira_taxas TO service_role;

CREATE POLICY org_isolation ON public.minhas_metas AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
CREATE POLICY org_isolation ON public.carreira_taxas AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));

-- Só a própria linha (ler e escrever), e só usuário ativo na organização.
CREATE POLICY minhas_metas_proprias ON public.minhas_metas FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.is_active_user((SELECT auth.uid()))));

-- Taxas: lê o padrão da imobiliária e as próprias; grava as próprias; padrão só admin/gestor.
CREATE POLICY carreira_taxas_ler ON public.carreira_taxas FOR SELECT TO authenticated
  USING (user_id IS NULL OR user_id = (SELECT auth.uid()));
CREATE POLICY carreira_taxas_proprias ON public.carreira_taxas FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.is_active_user((SELECT auth.uid()))));
CREATE POLICY carreira_taxas_padrao ON public.carreira_taxas FOR ALL TO authenticated
  USING (user_id IS NULL AND (SELECT public.has_any_role((SELECT auth.uid()),
    ARRAY['admin', 'super_admin', 'gestor']::public.app_role[])))
  WITH CHECK (user_id IS NULL AND (SELECT public.is_active_user((SELECT auth.uid())))
    AND (SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin', 'super_admin', 'gestor']::public.app_role[])));

-- 4) Realizado do próprio corretor -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meu_realizado(_inicio date, _fim date)
RETURNS TABLE(comissao numeric, vendas integer, vgv numeric, captacoes integer,
              como_captador integer, vgv_captador numeric, como_vendedor integer, vgv_vendedor numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id();
BEGIN
  IF _me IS NULL OR _org IS NULL THEN RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501'; END IF;
  IF _inicio IS NULL OR _fim IS NULL OR _fim < _inicio OR _fim - _inicio > 366 THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH canon AS (
    SELECT v.sale_id, v.vgv_proprio, s.corretor_captador_id, s.corretor_vendedor_id
      FROM public.vendas_comerciais_canonicas() v
      JOIN public.sales s ON s.id = v.sale_id
     WHERE s.organization_id = _org AND v.data_fechamento BETWEEN _inicio AND _fim),
  minhas AS (
    SELECT p.sale_id, sum(p.valor_individual) AS valor
      FROM public.participacoes_comerciais_validas() p
      JOIN canon c ON c.sale_id = p.sale_id
     WHERE p.user_id = _me
     GROUP BY p.sale_id),
  caps AS (
    SELECT count(*)::integer AS n
      FROM public.exclusive_captures c
     WHERE c.captor_id = _me AND c.organization_id = _org AND c.status = 'aprovada' AND c.discarded_at IS NULL
       AND public.exclusive_aprovada_em(c.id) BETWEEN _inicio AND _fim)
  SELECT
    coalesce((SELECT sum(m.valor) FROM minhas m), 0)::numeric,
    (SELECT count(*) FROM minhas)::integer,
    coalesce((SELECT sum(c.vgv_proprio) FROM canon c JOIN minhas m ON m.sale_id = c.sale_id), 0)::numeric,
    CASE WHEN EXISTS (SELECT 1 FROM public.organization_modules om
                       WHERE om.organization_id = _org AND om.module = 'captacao_exclusiva' AND om.enabled)
         THEN (SELECT n FROM caps) END,
    (SELECT count(*) FROM canon c WHERE c.corretor_captador_id = _me)::integer,
    coalesce((SELECT sum(c.vgv_proprio) FROM canon c WHERE c.corretor_captador_id = _me), 0)::numeric,
    (SELECT count(*) FROM canon c WHERE c.corretor_vendedor_id = _me)::integer,
    coalesce((SELECT sum(c.vgv_proprio) FROM canon c WHERE c.corretor_vendedor_id = _me), 0)::numeric;
END $function$;
REVOKE ALL ON FUNCTION public.meu_realizado(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meu_realizado(date, date) TO authenticated, service_role;

COMMIT;
