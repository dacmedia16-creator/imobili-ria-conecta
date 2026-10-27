-- Aviso de assunto sensível também para o Administrador principal (t_a7be646a), em PostgreSQL descartável.
-- Uso: bash scripts/leads-ia-test/test_aviso_sensivel.sh ta7be
-- Org A: admA (admin + super_admin), gesA (gestor), sA (só super_admin), c1 (corretor, responsável).
-- Org B: admB (admin), sB (só super_admin). A distribuição automática é sobrescrita por t.lead().
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
CREATE SCHEMA IF NOT EXISTS t;
CREATE TABLE IF NOT EXISTS t.res (n serial, ok boolean, label text);
CREATE OR REPLACE FUNCTION t.ok(_c boolean, _l text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO t.res (ok, label) VALUES (coalesce(_c, false), _l);
  IF coalesce(_c, false) THEN RAISE WARNING 'PASS %', _l; ELSE RAISE WARNING 'FAIL %', _l; END IF;
END $$;

\set orgA '''aaaaaaaa-0000-0000-0000-000000000000'''
\set orgB '''bbbbbbbb-0000-0000-0000-000000000000'''
\set admA '''a0000000-0000-0000-0000-00000000000a'''
\set gesA '''a0000000-0000-0000-0000-00000000000e'''
\set c1 '''a0000000-0000-0000-0000-0000000000c1'''
\set admB '''b0000000-0000-0000-0000-00000000000a'''
-- Administradores principais.
\set sA '''a0000000-0000-0000-0000-00000000005a'''
\set sB '''b0000000-0000-0000-0000-00000000005b'''
INSERT INTO public.profiles (id, organization_id, nome, ativo) VALUES (:sA, :orgA, 'Principal A', true), (:sB, :orgB, 'Principal B', true);
INSERT INTO public.organization_members (user_id, organization_id, ativo) VALUES (:sA, :orgA, true), (:sB, :orgB, true);
INSERT INTO public.user_roles (user_id, organization_id, role) VALUES
  (:sA, :orgA, 'super_admin'), (:sB, :orgB, 'super_admin'), (:admA, :orgA, 'super_admin');

UPDATE public.organization_modules SET enabled = true WHERE module = 'leads';
SELECT public.leads_preparar_org(:orgA), public.leads_preparar_org(:orgB);
UPDATE public.lead_config SET ia_ativa = true, ia_nome = 'Nicole';

CREATE OR REPLACE FUNCTION t.lead(_org uuid, _nome text, _tel text, _ext text, _resp uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE _l uuid; _cv uuid;
BEGIN
  _l := public.lead_inserir(_org, _nome, _tel, NULL, 'olx', NULL, NULL, NULL, false, NULL, _ext);
  UPDATE public.leads SET responsavel_id = _resp WHERE id = _l;
  SELECT id INTO _cv FROM public.lead_conversas WHERE lead_id = _l;
  IF _cv IS NULL THEN RAISE EXCEPTION 'sem conversa para %', _ext; END IF;
  RETURN _cv;
END $$;
-- Quantos avisos com este título cada pessoa recebeu.
CREATE OR REPLACE FUNCTION t.n(_u uuid, _tit text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.notifications WHERE user_id = _u AND titulo LIKE _tit || '%' $$;

-- 1) Assunto sensível na A, lead com responsável (c1).
TRUNCATE public.notifications;
SELECT public.lead_ia_passar(t.lead(:orgA, 'Lead Sensivel', '15981119001', 'sens1', :c1), 'sensivel', 'Cliente falou em Procon.');
SELECT t.ok(t.n(:sA, 'Atenção: assunto sensível') = 1, 'S1 Administrador principal (só esse papel) recebe 1 aviso');
SELECT t.ok(t.n(:admA, 'Atenção: assunto sensível') = 1, 'S2 quem é admin + Administrador principal recebe 1 só');
SELECT t.ok(t.n(:gesA, 'Atenção: assunto sensível') = 1, 'S3 gestor continua recebendo 1');
SELECT t.ok(t.n(:c1, 'Atenção: assunto sensível') = 1, 'S4 responsável continua recebendo 1');
SELECT t.ok(t.n(:sB, 'Atenção: assunto sensível') = 0 AND t.n(:admB, 'Atenção: assunto sensível') = 0,
            'S5 ninguém da outra imobiliária recebe');
SELECT t.ok((SELECT count(*) FROM public.notifications) = 4, 'S6 total = 4 avisos (c1, admA, gesA, sA), sem duplicar');

-- 2) Responsável é o próprio Administrador principal: recebe 1 só.
TRUNCATE public.notifications;
SELECT public.lead_ia_passar(t.lead(:orgA, 'Lead Sens 2', '15981119002', 'sens2', :sA), 'sensivel', 'Ameaça de processo.');
SELECT t.ok(t.n(:sA, 'Atenção: assunto sensível') = 1, 'S7 Administrador principal responsável recebe 1 só');

-- 3) Outros motivos não mudam: o Administrador principal (só esse papel) NÃO recebe.
TRUNCATE public.notifications;
SELECT public.lead_ia_passar(t.lead(:orgA, 'Dono Imovel', '15981119003', 'nl1', :c1), 'nao_lead', 'Proprietário.');
SELECT t.ok(t.n(:sA, 'Contato que não é comprador') = 0 AND t.n(:admA, 'Contato que não é comprador') = 1
            AND t.n(:gesA, 'Contato que não é comprador') = 1, 'S8 não-lead: igual a antes (admin e gestor; principal não)');
TRUNCATE public.notifications;
SELECT public.lead_ia_passar(t.lead(:orgA, 'Lead Q', '15981119004', 'q1', :c1), 'qualificado', 'Qualificado.');
SELECT t.ok((SELECT count(*) FROM public.notifications) = 1 AND t.n(:c1, 'IA qualificou') = 1,
            'S9 qualificado: só o responsável, igual a antes');
TRUNCATE public.notifications;
SELECT public.lead_ia_passar(t.lead(:orgA, 'Lead SemResp', '15981119005', 'sr1', NULL), 'pediu_pessoa', 'Pediu pessoa.');
SELECT t.ok(t.n(:sA, 'Cliente pediu') = 0 AND t.n(:admA, 'Cliente pediu') = 1 AND t.n(:gesA, 'Cliente pediu') = 1,
            'S10 sem responsável: igual a antes (admin e gestor)');

-- 4) Org B: o Administrador principal da B recebe o sensível da B; ninguém da A.
TRUNCATE public.notifications;
SELECT public.lead_ia_passar(t.lead(:orgB, 'Lead B', '15981119006', 'sb1', NULL), 'sensivel', 'Procon.');
SELECT t.ok(t.n(:sB, 'Atenção: assunto sensível') = 1 AND t.n(:admB, 'Atenção: assunto sensível') = 1
            AND (SELECT count(*) FROM public.notifications WHERE organization_id = :orgA) = 0,
            'S11 imobiliária B: principal e admin da B avisados; ninguém da A');

SELECT format('RESULTADO: %s/%s PASS', count(*) FILTER (WHERE ok), count(*)) FROM t.res;
SELECT label FROM t.res WHERE NOT ok;
