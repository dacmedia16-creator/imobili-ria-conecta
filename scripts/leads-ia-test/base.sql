--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'corretor',
    'coordenador',
    'gestor',
    'juridico',
    'financeiro',
    'admin',
    'super_admin',
    'team_leader'
);


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid $$;


--
-- Name: current_org_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_org_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid() $$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id AND p.ativo
                  WHERE r.user_id = _user_id AND r.role = _role AND r.organization_id = p.organization_id) $$;


--
-- Name: is_active_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_active_user(_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce((SELECT ativo FROM public.profiles WHERE id = _user), false) $$;


--
-- Name: is_platform_super_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_platform_super_admin(_user uuid DEFAULT auth.uid()) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT _user IS NOT NULL AND EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = _user) $$;


--
-- Name: leads_team_or_parent(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.leads_team_or_parent(_team_id uuid, _user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = _team_id AND t.lider_id = _user) $$;


--
-- Name: platform_set_organization_module(uuid, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores')
     OR _enabled IS NULL THEN
    RAISE EXCEPTION 'Modulo invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN
    RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT enabled INTO _current FROM public.organization_modules
    WHERE organization_id = _org AND module = _module FOR UPDATE;
  IF _current IS NOT DISTINCT FROM _enabled THEN RETURN _enabled; END IF;
  INSERT INTO public.organization_modules (organization_id, module, enabled, updated_at, updated_by)
  VALUES (_org, _module, _enabled, now(), _actor)
  ON CONFLICT (organization_id, module)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by = _actor;
  INSERT INTO public.organization_module_history (organization_id, module, enabled, actor_id)
  VALUES (_org, _module, _enabled, _actor);
  RETURN _enabled;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: clientes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clientes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid
);


--
-- Name: exclusive_captures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exclusive_captures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    captor_id uuid,
    broker_name text,
    form_data jsonb DEFAULT '{}'::jsonb,
    discarded_at timestamp with time zone,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid,
    tipo text NOT NULL,
    titulo text NOT NULL,
    mensagem text,
    lida boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: organization_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_members (
    user_id uuid,
    organization_id uuid,
    ativo boolean DEFAULT true
);


--
-- Name: organization_module_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_module_history (
    organization_id uuid,
    module text,
    enabled boolean,
    actor_id uuid
);


--
-- Name: organization_modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_modules (
    organization_id uuid NOT NULL,
    module text NOT NULL,
    enabled boolean,
    updated_at timestamp with time zone,
    updated_by uuid,
    CONSTRAINT organization_modules_module_check CHECK ((module = ANY (ARRAY['captacao_exclusiva'::text, 'reserva_salas'::text, 'feedback_proprietario'::text, 'oportunidades'::text, 'mural_conquistas'::text, 'ranking_valores'::text])))
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid NOT NULL,
    nome text,
    status text DEFAULT 'ativa'::text
);


--
-- Name: platform_admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_admins (
    user_id uuid
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    organization_id uuid,
    nome text,
    ativo boolean DEFAULT true
);


--
-- Name: team_co_leaders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_co_leaders (
    team_id uuid,
    user_id uuid
);


--
-- Name: team_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_members (
    team_id uuid,
    membro_id uuid,
    organization_id uuid
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid NOT NULL,
    lider_id uuid,
    parent_team_id uuid
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    user_id uuid,
    organization_id uuid,
    role public.app_role
);


--
-- Data for Name: clientes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.clientes (id, organization_id) FROM stdin;
\.


--
-- Data for Name: exclusive_captures; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.exclusive_captures (id, organization_id, captor_id, broker_name, form_data, discarded_at, archived_at, created_at) FROM stdin;
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.notifications (id, user_id, organization_id, tipo, titulo, mensagem, lida, created_at) FROM stdin;
ec4ae773-0db2-4809-86a6-98efb5d0e5ce	a0000000-0000-0000-0000-0000000000c1	aaaaaaaa-0000-0000-0000-000000000000	lead	Novo lead para você	Lead "Maria Teste": aceite em até 24 h em Meus leads.	f	2026-10-25 02:53:04.521045+00
a88ea741-ad91-4fa5-9c81-b2b6467098a6	b0000000-0000-0000-0000-0000000000cb	bbbbbbbb-0000-0000-0000-000000000000	lead	Novo lead para você	Lead "Cliente B": aceite em até 24 h em Meus leads.	f	2026-10-25 02:53:04.569554+00
4e6a90ab-3f7f-4060-9cd9-a9b25250f6b0	a0000000-0000-0000-0000-0000000000c2	aaaaaaaa-0000-0000-0000-000000000000	lead	Novo lead para você	Lead "Maria Teste": aceite em até 24 h em Meus leads.	f	2026-10-25 02:53:04.799981+00
08ba5664-56a1-48fe-9d06-32f5d4af7287	a0000000-0000-0000-0000-0000000000c2	aaaaaaaa-0000-0000-0000-000000000000	lead	Lead devolvido ao banco	O lead "Maria Teste" voltou para Leads da imobiliária: sem 1a interacao em 7 dias.	f	2026-10-25 02:53:05.096502+00
09a22905-0710-4852-a0cd-79da42cb2899	a0000000-0000-0000-0000-0000000000c1	aaaaaaaa-0000-0000-0000-000000000000	lead	Novo lead para você	Lead "Joao Rodizio": aceite em até 24 h em Meus leads.	f	2026-10-25 02:53:05.315179+00
c42fd193-9294-4c0f-852e-ec3be6c34fa6	a0000000-0000-0000-0000-0000000000c2	aaaaaaaa-0000-0000-0000-000000000000	lead	Novo lead para você	Lead "Joao Rodizio": aceite em até 24 h em Meus leads.	f	2026-10-25 02:53:05.622061+00
7718adbd-26f9-4c7f-808d-4096260032c3	a0000000-0000-0000-0000-0000000000c1	aaaaaaaa-0000-0000-0000-000000000000	lead	Lead passado para outro corretor	O lead "Joao Rodizio" foi para o próximo da vez: nao aceito em 24 h.	f	2026-10-25 02:53:05.622061+00
832cea21-0b8b-45f0-b2c9-0029ce792caa	a0000000-0000-0000-0000-0000000000c1	aaaaaaaa-0000-0000-0000-000000000000	lead	Novo lead para você	Lead "Lead simulado 87948273": aceite em até 24 h em Meus leads.	f	2026-10-25 02:53:05.982377+00
fb7d78b4-7eb2-4d96-bc68-21db88a82fee	a0000000-0000-0000-0000-0000000000c2	aaaaaaaa-0000-0000-0000-000000000000	lead	Novo lead para você	Lead "Lead simulado A36610FE": aceite em até 24 h em Meus leads.	f	2026-10-25 02:53:05.982377+00
a618ce8d-61e3-4403-ab58-673e89481776	a0000000-0000-0000-0000-0000000000c1	aaaaaaaa-0000-0000-0000-000000000000	lead	Novo lead para você	Lead "Lead simulado EDA5C9AE": aceite em até 24 h em Meus leads.	f	2026-10-25 02:53:05.982377+00
\.


--
-- Data for Name: organization_members; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.organization_members (user_id, organization_id, ativo) FROM stdin;
a0000000-0000-0000-0000-00000000000a	aaaaaaaa-0000-0000-0000-000000000000	t
a0000000-0000-0000-0000-00000000000e	aaaaaaaa-0000-0000-0000-000000000000	t
a0000000-0000-0000-0000-0000000000c1	aaaaaaaa-0000-0000-0000-000000000000	t
a0000000-0000-0000-0000-0000000000c2	aaaaaaaa-0000-0000-0000-000000000000	t
b0000000-0000-0000-0000-00000000000a	bbbbbbbb-0000-0000-0000-000000000000	t
b0000000-0000-0000-0000-0000000000cb	bbbbbbbb-0000-0000-0000-000000000000	t
a0000000-0000-0000-0000-0000000000f1	aaaaaaaa-0000-0000-0000-000000000000	t
\.


--
-- Data for Name: organization_module_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.organization_module_history (organization_id, module, enabled, actor_id) FROM stdin;
\.


--
-- Data for Name: organization_modules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.organization_modules (organization_id, module, enabled, updated_at, updated_by) FROM stdin;
\.


--
-- Data for Name: organizations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.organizations (id, nome, status) FROM stdin;
aaaaaaaa-0000-0000-0000-000000000000	Org A	ativa
bbbbbbbb-0000-0000-0000-000000000000	Org B	ativa
\.


--
-- Data for Name: platform_admins; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.platform_admins (user_id) FROM stdin;
\.


--
-- Data for Name: profiles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.profiles (id, organization_id, nome, ativo) FROM stdin;
a0000000-0000-0000-0000-00000000000a	aaaaaaaa-0000-0000-0000-000000000000	Admin A	t
a0000000-0000-0000-0000-00000000000e	aaaaaaaa-0000-0000-0000-000000000000	Gestor A	t
a0000000-0000-0000-0000-0000000000c1	aaaaaaaa-0000-0000-0000-000000000000	Corretor 1	t
a0000000-0000-0000-0000-0000000000c2	aaaaaaaa-0000-0000-0000-000000000000	Corretor 2	t
b0000000-0000-0000-0000-00000000000a	bbbbbbbb-0000-0000-0000-000000000000	Admin B	t
b0000000-0000-0000-0000-0000000000cb	bbbbbbbb-0000-0000-0000-000000000000	Corretor B	t
a0000000-0000-0000-0000-0000000000f1	aaaaaaaa-0000-0000-0000-000000000000	TL A	t
\.


--
-- Data for Name: team_co_leaders; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.team_co_leaders (team_id, user_id) FROM stdin;
\.


--
-- Data for Name: team_members; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.team_members (team_id, membro_id, organization_id) FROM stdin;
7ea70000-0000-0000-0000-000000000001	a0000000-0000-0000-0000-0000000000c1	aaaaaaaa-0000-0000-0000-000000000000
\.


--
-- Data for Name: teams; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.teams (id, lider_id, parent_team_id) FROM stdin;
7ea70000-0000-0000-0000-000000000001	a0000000-0000-0000-0000-0000000000f1	\N
\.


--
-- Data for Name: user_roles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_roles (user_id, organization_id, role) FROM stdin;
a0000000-0000-0000-0000-00000000000a	aaaaaaaa-0000-0000-0000-000000000000	admin
a0000000-0000-0000-0000-00000000000e	aaaaaaaa-0000-0000-0000-000000000000	gestor
a0000000-0000-0000-0000-0000000000c1	aaaaaaaa-0000-0000-0000-000000000000	corretor
a0000000-0000-0000-0000-0000000000c2	aaaaaaaa-0000-0000-0000-000000000000	corretor
b0000000-0000-0000-0000-00000000000a	bbbbbbbb-0000-0000-0000-000000000000	admin
b0000000-0000-0000-0000-0000000000cb	bbbbbbbb-0000-0000-0000-000000000000	corretor
a0000000-0000-0000-0000-0000000000f1	aaaaaaaa-0000-0000-0000-000000000000	team_leader
\.


--
-- Name: clientes clientes_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_id_organization_id_key UNIQUE (id, organization_id);


--
-- Name: clientes clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);


--
-- Name: exclusive_captures exclusive_captures_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exclusive_captures
    ADD CONSTRAINT exclusive_captures_id_organization_id_key UNIQUE (id, organization_id);


--
-- Name: exclusive_captures exclusive_captures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exclusive_captures
    ADD CONSTRAINT exclusive_captures_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: organization_modules organization_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_modules
    ADD CONSTRAINT organization_modules_pkey PRIMARY KEY (organization_id, module);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_organization_id_key UNIQUE (id, organization_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: notifications notif_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notif_self ON public.notifications FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA auth; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA auth TO anon;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT USAGE ON SCHEMA auth TO service_role;


--
-- Name: SCHEMA extensions; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA extensions TO anon;
GRANT USAGE ON SCHEMA extensions TO authenticated;
GRANT USAGE ON SCHEMA extensions TO service_role;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- PostgreSQL database dump complete
--


