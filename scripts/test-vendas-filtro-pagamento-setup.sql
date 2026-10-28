-- Esquema mínimo + dados sintéticos para scripts/test-vendas-filtro-pagamento.sql (banco descartável).
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;

CREATE TYPE public.app_role AS ENUM ('corretor','gestor','team_leader','juridico','financeiro','admin','super_admin');
CREATE TABLE public.membros (user_id uuid PRIMARY KEY, organization_id uuid NOT NULL, papel public.app_role NOT NULL);
CREATE TABLE public.sales (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, status text NOT NULL, valor_negociado numeric,
  imovel_id text, codigo_interno text, corretor_captador text, corretor_vendedor text,
  updated_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(), corretor_id uuid NOT NULL,
  modalidade text NOT NULL DEFAULT 'padrao', data_assinatura date, midia text,
  imovel_endereco text, imovel_logradouro text, imovel_bairro text, imovel_cidade text, imovel_cep text,
  UNIQUE (id, organization_id)
);
CREATE TABLE public.occurrences (sale_id uuid, data_assinatura date);
CREATE TABLE public.sale_status_history (sale_id uuid, para text, created_at timestamptz);
CREATE TABLE public.sale_parties (sale_id uuid, nome text);
CREATE TABLE public.sale_payment (
  sale_id uuid PRIMARY KEY REFERENCES public.sales(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  tipo_pagamento text NOT NULL DEFAULT 'vista' CHECK (tipo_pagamento IN ('vista','financiamento','consorcio')),
  financiamento boolean DEFAULT false, financiamento_banco text, financiamento_correspondente text,
  FOREIGN KEY (sale_id, organization_id) REFERENCES public.sales(id, organization_id)
);

CREATE FUNCTION public.current_org_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$ SELECT organization_id FROM public.membros WHERE user_id = auth.uid() $$;
CREATE FUNCTION public.has_role(_u uuid, _r public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.membros WHERE user_id = _u AND papel = _r) $$;
CREATE FUNCTION public.has_any_role(_u uuid, _r public.app_role[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.membros WHERE user_id = _u AND papel = ANY(_r)) $$;
CREATE FUNCTION public.is_sale_responsavel(_u uuid, _s uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.sales WHERE id = _s AND corretor_id = _u) $$;
CREATE FUNCTION public.is_lead_of_sale_responsavel(_u uuid, _s uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_sale_corretor(_u uuid, _s uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.sales WHERE id = _s AND corretor_id = _u) $$;
CREATE FUNCTION public.sale_corretores_ids(_s uuid) RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$ SELECT array_agg(corretor_id) FROM public.sales WHERE id = _s $$;
CREATE FUNCTION public.vendas_visiveis_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$ SELECT s.id FROM public.sales s
   WHERE s.organization_id = public.current_org_id()
     AND (public.has_any_role(auth.uid(), ARRAY['financeiro','admin','super_admin']::public.app_role[]) OR s.corretor_id = auth.uid()) $$;

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_payment ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON public.sales AS RESTRICTIVE FOR ALL TO authenticated USING (organization_id = (SELECT public.current_org_id()));
CREATE POLICY sales_select ON public.sales FOR SELECT TO authenticated USING (id IN (SELECT public.vendas_visiveis_ids()));
CREATE POLICY org_isolation ON public.sale_payment AS RESTRICTIVE FOR ALL TO authenticated USING (organization_id = (SELECT public.current_org_id()));
CREATE POLICY sale_payment_select ON public.sale_payment FOR SELECT TO authenticated USING (sale_id IN (SELECT public.vendas_visiveis_ids()));
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

-- Dados sintéticos (sem dados pessoais).
INSERT INTO public.membros VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000000', 'financeiro'),
 ('cccccccc-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000000', 'corretor'),
 ('dddddddd-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000000', 'corretor'),
 ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000000', 'admin');
INSERT INTO public.sales (id, organization_id, status, valor_negociado, imovel_id, corretor_id, data_assinatura) VALUES
 ('00000000-0000-0000-0000-0000000000f1', '11111111-0000-0000-0000-000000000000', 'contrato_assinado', 100, 'F1', 'dddddddd-0000-0000-0000-000000000004', '2026-10-05'),
 ('00000000-0000-0000-0000-0000000000f2', '11111111-0000-0000-0000-000000000000', 'rascunho',          200, 'F2', 'cccccccc-0000-0000-0000-000000000003', '2026-10-06'),
 ('00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000000', 'contrato_assinado', 300, 'V1', 'dddddddd-0000-0000-0000-000000000004', '2026-10-07'),
 ('00000000-0000-0000-0000-0000000000c1', '11111111-0000-0000-0000-000000000000', 'contrato_assinado', 400, 'K1', 'dddddddd-0000-0000-0000-000000000004', '2026-10-08'),
 ('00000000-0000-0000-0000-0000000000e1', '11111111-0000-0000-0000-000000000000', 'rascunho',          500, 'N1', 'cccccccc-0000-0000-0000-000000000003', '2026-10-09'),
 ('00000000-0000-0000-0000-0000000000b1', '11111111-0000-0000-0000-000000000000', 'cancelada',         999, 'X1', 'dddddddd-0000-0000-0000-000000000004', '2026-10-10'),
 ('00000000-0000-0000-0000-0000000000d1', '11111111-0000-0000-0000-000000000000', 'contrato_assinado', 777, 'S1', 'dddddddd-0000-0000-0000-000000000004', '2026-09-20'),
 ('00000000-0000-0000-0000-000000000021', '22222222-0000-0000-0000-000000000000', 'contrato_assinado', 800, 'Z1', 'bbbbbbbb-0000-0000-0000-000000000002', '2026-10-11');
INSERT INTO public.sale_payment (sale_id, organization_id, tipo_pagamento, financiamento, financiamento_banco, financiamento_correspondente) VALUES
 ('00000000-0000-0000-0000-0000000000f1', '11111111-0000-0000-0000-000000000000', 'financiamento', true, 'Caixa', 'Corresp X'),
 ('00000000-0000-0000-0000-0000000000f2', '11111111-0000-0000-0000-000000000000', 'financiamento', true, NULL, NULL),
 ('00000000-0000-0000-0000-0000000000a1', '11111111-0000-0000-0000-000000000000', 'vista', false, NULL, NULL),
 ('00000000-0000-0000-0000-0000000000c1', '11111111-0000-0000-0000-000000000000', 'consorcio', false, NULL, NULL),
 ('00000000-0000-0000-0000-0000000000b1', '11111111-0000-0000-0000-000000000000', 'financiamento', true, 'Itaú', NULL),
 ('00000000-0000-0000-0000-0000000000d1', '11111111-0000-0000-0000-000000000000', 'financiamento', true, NULL, NULL),
 ('00000000-0000-0000-0000-000000000021', '22222222-0000-0000-0000-000000000000', 'financiamento', true, 'Banco Z', NULL);
