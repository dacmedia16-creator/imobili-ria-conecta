-- Meta de comissão mensal (item 5) — por corretor ou por equipe, nunca os dois na mesma linha.
-- Quem gerencia é quem já gerencia a equipe hoje (mesma regra de leads_team_or_parent usada em
-- teams/team_members), admin/super_admin sempre podem. Leitura mais ampla: qualquer um que já
-- enxerga a equipe (sees_team) ou o próprio corretor vendo a meta dele.
CREATE TABLE public.metas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo = ANY (ARRAY['corretor','equipe'])),
  corretor_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  mes date NOT NULL,
  meta_comissao numeric(14,2) NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT metas_tipo_alvo_check CHECK (
    (tipo = 'corretor' AND corretor_id IS NOT NULL AND team_id IS NULL)
    OR (tipo = 'equipe' AND team_id IS NOT NULL AND corretor_id IS NULL)
  )
);

-- Sempre o dia 1 do mês — trava aqui em vez de confiar que quem grava lembra de zerar o dia.
ALTER TABLE public.metas ADD CONSTRAINT metas_mes_dia1_check CHECK (date_trunc('month', mes)::date = mes);

CREATE UNIQUE INDEX metas_corretor_mes_key ON public.metas (corretor_id, mes) WHERE tipo = 'corretor';
CREATE UNIQUE INDEX metas_equipe_mes_key ON public.metas (team_id, mes) WHERE tipo = 'equipe';

CREATE TRIGGER trg_metas_updated BEFORE UPDATE ON public.metas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.metas ENABLE ROW LEVEL SECURITY;

CREATE POLICY metas_select ON public.metas FOR SELECT USING (
  public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR (tipo = 'corretor' AND corretor_id = auth.uid())
  OR (tipo = 'corretor' AND EXISTS (
    SELECT 1 FROM public.team_members tm WHERE tm.membro_id = metas.corretor_id AND public.sees_team(tm.team_id, auth.uid())
  ))
  OR (tipo = 'equipe' AND public.sees_team(metas.team_id, auth.uid()))
);

CREATE POLICY metas_write ON public.metas FOR ALL USING (
  public.is_active_user(auth.uid()) AND (
    public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
    OR (tipo = 'corretor' AND EXISTS (
      SELECT 1 FROM public.team_members tm WHERE tm.membro_id = metas.corretor_id AND public.leads_team_or_parent(tm.team_id, auth.uid())
    ))
    OR (tipo = 'equipe' AND public.leads_team_or_parent(metas.team_id, auth.uid()))
  )
) WITH CHECK (
  public.is_active_user(auth.uid()) AND (
    public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
    OR (tipo = 'corretor' AND EXISTS (
      SELECT 1 FROM public.team_members tm WHERE tm.membro_id = metas.corretor_id AND public.leads_team_or_parent(tm.team_id, auth.uid())
    ))
    OR (tipo = 'equipe' AND public.leads_team_or_parent(metas.team_id, auth.uid()))
  )
);

-- Progresso da meta (comissão realizada no mês) pra quem já pode ver a meta — SECURITY INVOKER:
-- o join com occurrences/sales fica automaticamente restrito ao recorte de vendas que o chamador
-- já enxerga (can_view_sale via RLS de sales/occurrences), igual o resto do sistema.
CREATE OR REPLACE FUNCTION public.metas_progresso(_mes date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH mes_alvo AS (SELECT date_trunc('month', _mes)::date AS mes),
comissao_corretor AS (
  SELECT s.corretor_id, sum(o.valor_comissao) AS total
  FROM occurrences o
  JOIN sales s ON s.id = o.sale_id
  CROSS JOIN mes_alvo
  WHERE date_trunc('month', COALESCE(o.data_assinatura, o.created_at::date))::date = mes_alvo.mes
  GROUP BY s.corretor_id
),
comissao_equipe AS (
  SELECT tm.team_id, sum(cc.total) AS total
  FROM comissao_corretor cc
  JOIN team_members tm ON tm.membro_id = cc.corretor_id
  GROUP BY tm.team_id
)
SELECT jsonb_build_object(
  'corretor', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'corretor_id', m.corretor_id, 'meta_comissao', m.meta_comissao, 'comissao_realizada', COALESCE(cc.total, 0)
    ))
    FROM metas m
    LEFT JOIN comissao_corretor cc ON cc.corretor_id = m.corretor_id
    WHERE m.tipo = 'corretor' AND m.mes = (SELECT mes FROM mes_alvo)
  ), '[]'::jsonb),
  'equipe', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'team_id', m.team_id, 'meta_comissao', m.meta_comissao, 'comissao_realizada', COALESCE(ce.total, 0)
    ))
    FROM metas m
    LEFT JOIN comissao_equipe ce ON ce.team_id = m.team_id
    WHERE m.tipo = 'equipe' AND m.mes = (SELECT mes FROM mes_alvo)
  ), '[]'::jsonb)
);
$function$;

GRANT EXECUTE ON FUNCTION public.metas_progresso(date) TO authenticated;
