-- Harness isolado: executar somente num Postgres descartável sem dados reais.
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TYPE public.app_role AS ENUM ('corretor', 'juridico', 'admin');
CREATE TABLE public.sales (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, imovel_observacoes text,
 valor_total_comissao numeric
);
CREATE TABLE public.sale_parties (id uuid PRIMARY KEY, sale_id uuid);
CREATE TABLE public.sale_commission_extras (id uuid PRIMARY KEY, sale_id uuid);
CREATE TABLE public.occurrence_commissions (id uuid PRIMARY KEY, sale_id uuid);
CREATE TABLE public.occurrence_partners (id uuid PRIMARY KEY, sale_id uuid);
CREATE TABLE public.sale_bank_accounts (id uuid PRIMARY KEY, sale_id uuid, parte text, titular text);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, organization_id uuid NOT NULL);
CREATE TABLE public.user_roles (user_id uuid, organization_id uuid, role public.app_role);
CREATE TABLE public.sale_documents (
 id uuid PRIMARY KEY, sale_id uuid NOT NULL, organization_id uuid NOT NULL,
 tipo text, deleted_at timestamptz
);
CREATE TABLE public.document_extractions (
 document_id uuid, sale_id uuid NOT NULL, organization_id uuid NOT NULL,
 status text, raw_json jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION public.is_active_user(_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user)
$$;
CREATE FUNCTION public.can_view_sale(_user uuid, _sale_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (SELECT 1 FROM public.sales s JOIN public.profiles p
    ON p.organization_id = s.organization_id WHERE s.id = _sale_id AND p.id = _user)
$$;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sales TO authenticated;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_select ON public.sales FOR SELECT TO authenticated USING (public.can_view_sale(auth.uid(), id));
CREATE POLICY org_update ON public.sales FOR UPDATE TO authenticated
 USING (public.can_view_sale(auth.uid(), id)) WITH CHECK (public.can_view_sale(auth.uid(), id));
INSERT INTO public.profiles VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
 ('aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
 ('aaaaaaaa-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO public.user_roles VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','corretor'),
 ('aaaaaaaa-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','juridico'),
 ('aaaaaaaa-0000-0000-0000-000000000003','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','admin'),
 ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','juridico');
INSERT INTO public.sales(id, organization_id, imovel_observacoes) VALUES
 ('aaaaaaaa-1000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',null),
 ('aaaaaaaa-1000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Texto legado preservado'),
 ('bbbbbbbb-1000-0000-0000-000000000001','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Texto B');
INSERT INTO public.sale_bank_accounts VALUES
 ('aaaaaaaa-2000-0000-0000-000000000001','aaaaaaaa-1000-0000-0000-000000000001','vendedor_1','Legado');
INSERT INTO public.sale_documents VALUES
 ('aaaaaaaa-3000-0000-0000-000000000001','aaaaaaaa-1000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','matricula',null);
INSERT INTO public.document_extractions(document_id, sale_id, organization_id, status, raw_json) VALUES
 ('aaaaaaaa-3000-0000-0000-000000000001','aaaaaaaa-1000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','done','{"observacoes_imovel":"Descrição IA"}');
