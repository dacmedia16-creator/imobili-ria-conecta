-- Ensaio 2d: impressão integral de ocorrências concluídas (imprimir_ocorrencias_concluidas).
-- Só imprime venda da MESMA agência do chamador e dentro da visibilidade de liderança
-- (can_view_sale); qualquer ID fora disso recusa o lote inteiro com 42501 (falha fechada).
-- Tudo em transação + ROLLBACK; nenhuma linha persiste.
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA mt_2d_test;
CREATE TABLE mt_2d_test.results (n serial, label text, ok boolean);
GRANT USAGE ON SCHEMA mt_2d_test TO service_role, authenticated;
GRANT ALL ON mt_2d_test.results TO service_role, authenticated;
GRANT ALL ON SEQUENCE mt_2d_test.results_n_seq TO service_role, authenticated;
CREATE FUNCTION mt_2d_test.check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO mt_2d_test.results(label,ok) VALUES(label,coalesce(ok,false)) $$;
-- 'ok:<n documentos>' ou 'erro:<SQLSTATE>'.
CREATE FUNCTION mt_2d_test.print(ids uuid[]) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE r jsonb; BEGIN r := public.imprimir_ocorrencias_concluidas(ids);
 RETURN 'ok:' || jsonb_array_length(r);
 EXCEPTION WHEN OTHERS THEN RETURN 'erro:' || SQLSTATE; END $$;
CREATE FUNCTION mt_2d_test.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true); END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mt_2d_test TO service_role, authenticated;

-- ---------- Preparação (dados sintéticos) ----------
-- A = agência histórica: gestor líder (a1) da equipe do corretor a2; gestor sem liderança (a3);
--     team_leader de outra equipe (a4); financeiro (a5).
-- B = agência sintética: gestor líder (b1) da equipe do corretor b2.
INSERT INTO public.organizations(id,slug,nome) VALUES
 ('2d000000-0000-4000-8000-0000000000b0','mt-2d-b','Agencia B 2d');
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('2d000000-0000-4000-8000-0000000000a1','a1.2d@example.test','{"nome":"A Gestor Lider"}','{}'),
 ('2d000000-0000-4000-8000-0000000000a2','a2.2d@example.test','{"nome":"A Corretor"}','{}'),
 ('2d000000-0000-4000-8000-0000000000a3','a3.2d@example.test','{"nome":"A Gestor Sem Equipe"}','{}'),
 ('2d000000-0000-4000-8000-0000000000a4','a4.2d@example.test','{"nome":"A TL Outra Equipe"}','{}'),
 ('2d000000-0000-4000-8000-0000000000a5','a5.2d@example.test','{"nome":"A Financeiro"}','{}'),
 ('2d000000-0000-4000-8000-0000000000b1','b1.2d@example.test','{"nome":"B Gestor Lider"}','{"organization_id":"2d000000-0000-4000-8000-0000000000b0"}'),
 ('2d000000-0000-4000-8000-0000000000b2','b2.2d@example.test','{"nome":"B Corretor"}','{"organization_id":"2d000000-0000-4000-8000-0000000000b0"}');
INSERT INTO public.user_roles(user_id,role) VALUES
 ('2d000000-0000-4000-8000-0000000000a1','gestor'),
 ('2d000000-0000-4000-8000-0000000000a3','gestor'),
 ('2d000000-0000-4000-8000-0000000000a4','team_leader'),
 ('2d000000-0000-4000-8000-0000000000a5','financeiro'),
 ('2d000000-0000-4000-8000-0000000000b1','gestor');
INSERT INTO public.teams(id,lider_id,nome,organization_id) VALUES
 ('2d0a0000-0000-4000-8000-00000000000a','2d000000-0000-4000-8000-0000000000a1','Equipe A 2d','00000000-0000-4000-8000-000000000001'),
 ('2d0a0000-0000-4000-8000-00000000000c','2d000000-0000-4000-8000-0000000000a4','Equipe A2 2d','00000000-0000-4000-8000-000000000001'),
 ('2d0a0000-0000-4000-8000-00000000000b','2d000000-0000-4000-8000-0000000000b1','Equipe B 2d','2d000000-0000-4000-8000-0000000000b0');
INSERT INTO public.team_members(team_id,membro_id,tipo) VALUES
 ('2d0a0000-0000-4000-8000-00000000000a','2d000000-0000-4000-8000-0000000000a2','corretor'),
 ('2d0a0000-0000-4000-8000-00000000000b','2d000000-0000-4000-8000-0000000000b2','corretor');
INSERT INTO public.sales(id,corretor_id,imovel_id,organization_id) VALUES
 ('2d050000-0000-4000-8000-00000000000a','2d000000-0000-4000-8000-0000000000a2','IMP-2D-A','00000000-0000-4000-8000-000000000001'),
 ('2d050000-0000-4000-8000-0000000000aa','2d000000-0000-4000-8000-0000000000a2','IMP-2D-A-PEND','00000000-0000-4000-8000-000000000001'),
 ('2d050000-0000-4000-8000-00000000000b','2d000000-0000-4000-8000-0000000000b2','IMP-2D-B','2d000000-0000-4000-8000-0000000000b0');
-- Ocorrências sintéticas: o estado 'concluida' é gravado direto pelo dono do banco (sem API).
ALTER TABLE public.occurrences DISABLE TRIGGER USER;
INSERT INTO public.occurrences(sale_id,status,organization_id) VALUES
 ('2d050000-0000-4000-8000-00000000000a','concluida','00000000-0000-4000-8000-000000000001'),
 ('2d050000-0000-4000-8000-0000000000aa','pendente','00000000-0000-4000-8000-000000000001'),
 ('2d050000-0000-4000-8000-00000000000b','concluida','2d000000-0000-4000-8000-0000000000b0');
ALTER TABLE public.occurrences ENABLE TRIGGER USER;

-- ---------- Estrutura ----------
SELECT mt_2d_test.check('RPC continua SECURITY DEFINER com search_path fixo',
 EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.imprimir_ocorrencias_concluidas(uuid[])'::regprocedure
   AND prosecdef AND proconfig IS NOT NULL));
SELECT mt_2d_test.check('anon sem EXECUTE',
 NOT has_function_privilege('anon','public.imprimir_ocorrencias_concluidas(uuid[])','EXECUTE'));

-- ---------- Caminho permitido (sem regressão) ----------
SELECT mt_2d_test.as_user('2d000000-0000-4000-8000-0000000000a1');
SELECT mt_2d_test.check('A gestor lider: imprime venda da propria equipe',
 mt_2d_test.print(ARRAY['2d050000-0000-4000-8000-00000000000a']::uuid[])='ok:1');
SELECT mt_2d_test.check('A gestor lider: documento vem da venda pedida',
 (public.imprimir_ocorrencias_concluidas(ARRAY['2d050000-0000-4000-8000-00000000000a']::uuid[])
   -> 0 -> 'sale' ->> 'id') = '2d050000-0000-4000-8000-00000000000a');
SELECT mt_2d_test.check('A gestor lider: ocorrencia nao concluida continua recusada (22023)',
 mt_2d_test.print(ARRAY['2d050000-0000-4000-8000-0000000000aa']::uuid[])='erro:22023');
RESET ROLE;
SELECT mt_2d_test.as_user('2d000000-0000-4000-8000-0000000000b1');
SELECT mt_2d_test.check('B gestor lider: imprime venda da propria equipe',
 mt_2d_test.print(ARRAY['2d050000-0000-4000-8000-00000000000b']::uuid[])='ok:1');
RESET ROLE;

-- ---------- Entre agências ----------
SELECT mt_2d_test.as_user('2d000000-0000-4000-8000-0000000000b1');
SELECT mt_2d_test.check('B gestor: NAO imprime venda da agencia A (42501)',
 mt_2d_test.print(ARRAY['2d050000-0000-4000-8000-00000000000a']::uuid[])='erro:42501');
SELECT mt_2d_test.check('B gestor: lote misto B+A recusado inteiro (42501)',
 mt_2d_test.print(ARRAY['2d050000-0000-4000-8000-00000000000b','2d050000-0000-4000-8000-00000000000a']::uuid[])='erro:42501');
RESET ROLE;
SELECT mt_2d_test.as_user('2d000000-0000-4000-8000-0000000000a1');
SELECT mt_2d_test.check('A gestor: NAO imprime venda da agencia B (42501)',
 mt_2d_test.print(ARRAY['2d050000-0000-4000-8000-00000000000b']::uuid[])='erro:42501');
RESET ROLE;

-- ---------- Mesma agência, sem liderança sobre a venda ----------
SELECT mt_2d_test.as_user('2d000000-0000-4000-8000-0000000000a3');
SELECT mt_2d_test.check('A gestor sem lideranca: NAO imprime (42501)',
 mt_2d_test.print(ARRAY['2d050000-0000-4000-8000-00000000000a']::uuid[])='erro:42501');
RESET ROLE;
SELECT mt_2d_test.as_user('2d000000-0000-4000-8000-0000000000a4');
SELECT mt_2d_test.check('A team_leader de outra equipe: NAO imprime (42501)',
 mt_2d_test.print(ARRAY['2d050000-0000-4000-8000-00000000000a']::uuid[])='erro:42501');
RESET ROLE;

-- ---------- Papéis sem impressão continuam fora ----------
SELECT mt_2d_test.as_user('2d000000-0000-4000-8000-0000000000a5');
SELECT mt_2d_test.check('financeiro: continua sem impressao (42501)',
 mt_2d_test.print(ARRAY['2d050000-0000-4000-8000-00000000000a']::uuid[])='erro:42501');
RESET ROLE;
SELECT mt_2d_test.as_user('2d000000-0000-4000-8000-0000000000a2');
SELECT mt_2d_test.check('corretor: continua sem impressao (42501)',
 mt_2d_test.print(ARRAY['2d050000-0000-4000-8000-00000000000a']::uuid[])='erro:42501');
RESET ROLE;

-- ---------- ID inexistente não vira sonda ----------
SELECT mt_2d_test.as_user('2d000000-0000-4000-8000-0000000000a1');
SELECT mt_2d_test.check('ID inexistente: mesmo erro de venda alheia (42501)',
 mt_2d_test.print(ARRAY['2d050000-0000-4000-8000-0000000000ff']::uuid[])='erro:42501');
RESET ROLE;

-- ---------- Líder desativado / agência suspensa ----------
SELECT set_config('request.jwt.claims','',true);
ALTER TABLE public.profiles DISABLE TRIGGER USER;
UPDATE public.profiles SET ativo=false WHERE id='2d000000-0000-4000-8000-0000000000a1';
ALTER TABLE public.profiles ENABLE TRIGGER USER;
SELECT mt_2d_test.as_user('2d000000-0000-4000-8000-0000000000a1');
SELECT mt_2d_test.check('gestor desativado: NAO imprime (42501)',
 mt_2d_test.print(ARRAY['2d050000-0000-4000-8000-00000000000a']::uuid[])='erro:42501');
RESET ROLE; SELECT set_config('request.jwt.claims','',true);
ALTER TABLE public.profiles DISABLE TRIGGER USER;
UPDATE public.profiles SET ativo=true WHERE id='2d000000-0000-4000-8000-0000000000a1';
ALTER TABLE public.profiles ENABLE TRIGGER USER;
UPDATE public.organizations SET status='suspensa' WHERE id='2d000000-0000-4000-8000-0000000000b0';
SELECT mt_2d_test.as_user('2d000000-0000-4000-8000-0000000000b1');
SELECT mt_2d_test.check('agencia suspensa: gestor B NAO imprime nem a propria (42501)',
 mt_2d_test.print(ARRAY['2d050000-0000-4000-8000-00000000000b']::uuid[])='erro:42501');
RESET ROLE; SELECT set_config('request.jwt.claims','',true);
UPDATE public.organizations SET status='ativa' WHERE id='2d000000-0000-4000-8000-0000000000b0';

-- ---------- Defesa em profundidade: não depende da RLS do dono ----------
-- Se a função voltar a ter dono com BYPASSRLS (ex.: rollback parcial da 1b), a regra continua.
SELECT set_config('request.jwt.claims','',true);
ALTER FUNCTION public.imprimir_ocorrencias_concluidas(uuid[]) OWNER TO postgres;
SELECT mt_2d_test.as_user('2d000000-0000-4000-8000-0000000000b1');
SELECT mt_2d_test.check('dono BYPASSRLS: B gestor continua sem imprimir A (42501)',
 mt_2d_test.print(ARRAY['2d050000-0000-4000-8000-00000000000a']::uuid[])='erro:42501');
RESET ROLE;
SELECT mt_2d_test.as_user('2d000000-0000-4000-8000-0000000000a3');
SELECT mt_2d_test.check('dono BYPASSRLS: A gestor sem lideranca continua sem imprimir (42501)',
 mt_2d_test.print(ARRAY['2d050000-0000-4000-8000-00000000000a']::uuid[])='erro:42501');
RESET ROLE;
SELECT set_config('request.jwt.claims','',true);

SELECT 'FALHA: ' || label FROM mt_2d_test.results WHERE NOT ok ORDER BY n;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM mt_2d_test.results;
ROLLBACK;
