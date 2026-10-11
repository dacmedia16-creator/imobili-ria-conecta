-- Recupera sale_commission_extras no controle de versão (nunca tinha sido
-- migration — schema confirmado direto no Postgres) e libera papel=
-- corretor_captador/corretor_vendedor, pra dar pra rotular "mais um
-- captador/vendedor" nessa tabela em vez de cair genérico em "Outro".
CREATE TABLE IF NOT EXISTS public.sale_commission_extras (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  nome text,
  origem text NOT NULL DEFAULT 'imobiliaria',
  papel text,
  percentual numeric(6,3),
  valor numeric(14,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sale_commission_extras_pkey PRIMARY KEY (id)
);
ALTER TABLE public.sale_commission_extras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_commission_extras_rw ON public.sale_commission_extras;
CREATE POLICY sale_commission_extras_rw ON public.sale_commission_extras FOR ALL
USING (can_view_sale(auth.uid(), sale_id))
WITH CHECK (
  can_view_sale(auth.uid(), sale_id)
  AND (NOT is_sale_locked(sale_id) OR has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::app_role[]))
);

ALTER TABLE public.sale_commission_extras DROP CONSTRAINT IF EXISTS sale_commission_extras_origem_check;
ALTER TABLE public.sale_commission_extras ADD CONSTRAINT sale_commission_extras_origem_check
  CHECK (origem IN ('imobiliaria','captador','vendedor'));

ALTER TABLE public.sale_commission_extras DROP CONSTRAINT IF EXISTS sale_commission_extras_papel_check;
ALTER TABLE public.sale_commission_extras ADD CONSTRAINT sale_commission_extras_papel_check
  CHECK (papel IS NULL OR papel IN ('gestor','team_leader','outro','corretor_captador','corretor_vendedor'));
