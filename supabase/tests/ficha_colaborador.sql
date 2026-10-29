-- Suíte da ficha do colaborador (migration 20261029130000, t_618b64bc).
-- Roda DENTRO de transação revertida (run-ficha-colaborador.sh), em banco local descartável ou
-- homologação; nunca em produção. Dados 100% fictícios, criados aqui.
-- Imobiliária A: admin, staff, gestor (líder da equipe), team leader (co-líder), corretores C1 e C2.
-- Imobiliária B: admin B e corretor B.  Plataforma: dono da plataforma (platform_admins).
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text, _sid text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           (json_build_object('sub', _uid, 'role', 'authenticated')::jsonb
            || CASE WHEN _sid IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('session_id', _sid) END)::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
-- Chamada válida da própria ficha (parâmetros nomeados para ficar legível).
CREATE FUNCTION pg_temp.salvar_ok(_plano boolean, _qual text, _rel text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.ficha_salvar_minha(_qtd_filhos => 2, _tem_plano_saude => _plano, _plano_saude => _qual,
    _emergencia_nome => 'Maria Exemplo', _emergencia_parentesco => 'Mae',
    _emergencia_telefone => '(15) 99123-4567', _hospital_preferencia => 'Hospital Exemplo',
    _religiao => _rel, _data_nascimento => DATE '1990-05-17', _ciente => true) $$;

\set org_a 'a0000000-0000-4000-8000-0000000000a0'
\set org_b 'b0000000-0000-4000-8000-0000000000b0'
\set admin 'a0000000-0000-4000-8000-000000000001'
\set gestor 'a0000000-0000-4000-8000-000000000002'
\set tl 'a0000000-0000-4000-8000-000000000003'
\set c1 'a0000000-0000-4000-8000-000000000004'
\set c2 'a0000000-0000-4000-8000-000000000005'
\set staff 'a0000000-0000-4000-8000-000000000006'
\set ab 'b0000000-0000-4000-8000-000000000001'
\set cb 'b0000000-0000-4000-8000-000000000002'
\set plat 'f0000000-0000-4000-8000-000000000001'
\set team 'a0000000-0000-4000-8000-0000000000f1'
\set sid_imp 'd0000000-0000-4000-8000-000000000001'
\set sid_c1 'd0000000-0000-4000-8000-000000000002'

-- Montagem (sem gatilhos, só nesta transação) -----------------------------------------------------
-- O clone estrutural local não tem auth.sessions (usado pela visão da plataforma): cria só aqui.
CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid, not_after timestamptz);
INSERT INTO auth.sessions (id, user_id) VALUES
  (:'sid_imp', :'c1'), (:'sid_c1', :'c1') ON CONFLICT DO NOTHING;
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'org_a', 'teste-ficha-a', 'Imobiliaria Exemplo A', 'ativa', '00000000000191', '#112233', '#445566'),
  (:'org_b', 'teste-ficha-b', 'Imobiliaria Exemplo B', 'ativa', '00000000000272', '#112233', '#445566');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'gestor', :'tl', :'c1', :'c2', :'staff', :'ab', :'cb', :'plat']::uuid[]);
-- Cadastro (telefone/CPF/ID RE/MAX) já completo: esta suíte testa só a ficha. Desde a 20261029160000
-- o cadastro também conta para liberar (suíte própria em cadastro_completo.sql).
INSERT INTO public.profiles (id, nome, email, ativo, organization_id, telefone, cpf, remax_id) VALUES
  (:'admin', 'Dona Exemplo', 'dona@exemplo.test', true, :'org_a', '15991234567', NULL, NULL),
  (:'gestor', 'Gestor Exemplo', 'gestor@exemplo.test', true, :'org_a', '15991234567', '529.982.247-25', '630000011'),
  (:'tl', 'Lider Exemplo', 'tl@exemplo.test', true, :'org_a', '15991234567', '529.982.247-25', '630000012'),
  (:'c1', 'Carlos Um', 'c1@exemplo.test', true, :'org_a', '15991234567', '529.982.247-25', '630000013'),
  (:'c2', 'Bruna Dois', 'c2@exemplo.test', true, :'org_a', '15991234567', '529.982.247-25', '630000014'),
  (:'staff', 'Sara Staff', 'staff@exemplo.test', true, :'org_a', '15991234567', NULL, NULL),
  (:'ab', 'Admin B', 'ab@exemplo.test', true, :'org_b', '15991234567', NULL, NULL),
  (:'cb', 'Corretor B', 'cb@exemplo.test', true, :'org_b', '15991234567', '529.982.247-25', '630000015'),
  (:'plat', 'Dono Plataforma', 'plat@exemplo.test', true, :'org_a', NULL, NULL, NULL);
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org_a', :'admin', true), (:'org_a', :'gestor', true), (:'org_a', :'tl', true), (:'org_a', :'c1', true),
  (:'org_a', :'c2', true), (:'org_a', :'staff', true), (:'org_b', :'ab', true), (:'org_b', :'cb', true),
  (:'org_a', :'plat', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'gestor', 'gestor', :'org_a'), (:'tl', 'team_leader', :'org_a'),
  (:'c1', 'corretor', :'org_a'), (:'c2', 'corretor', :'org_a'), (:'staff', 'staff', :'org_a'),
  (:'ab', 'admin', :'org_b'), (:'cb', 'corretor', :'org_b'), (:'plat', 'super_admin', :'org_a');
INSERT INTO public.platform_admins (user_id) VALUES (:'plat');
INSERT INTO public.teams (id, lider_id, nome, organization_id) VALUES (:'team', :'gestor', 'Equipe Exemplo', :'org_a');
INSERT INTO public.team_members (membro_id, team_id, organization_id) VALUES
  (:'c1', :'team', :'org_a'), (:'c2', :'team', :'org_a');
INSERT INTO public.team_co_leaders (team_id, user_id, organization_id) VALUES (:'team', :'tl', :'org_a');
-- Sessão de "Entrar como" (dono da plataforma operando a conta do C1).
INSERT INTO public.operational_impersonation_sessions (actor_user_id, target_user_id, auth_session_id, status, started_at, organization_id)
  VALUES (:'plat', :'c1', :'sid_imp', 'active', now(), :'org_a');
-- Ficha fictícia do corretor B (outra imobiliária) para provar o isolamento.
INSERT INTO public.colaborador_fichas (user_id, organization_id, qtd_filhos, tem_plano_saude, plano_saude,
    emergencia_nome, emergencia_parentesco, emergencia_telefone, hospital_preferencia, religiao)
  VALUES (:'cb', :'org_b', 1, false, NULL, 'Contato B', 'Irmao', '15991234567', 'Hospital B', 'Religiao B');
SET LOCAL session_replication_role = origin;

-- 1) Prazo: ANTES da data (padrão 30/10/2026 01:30 SP ou config futura) → aparece, não trava ----------
INSERT INTO public.ficha_config (organization_id, obrigatoria_a_partir_de) VALUES (:'org_a', now() + interval '1 day');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1', :'sid_c1');
SELECT pg_temp.ok((public.ficha_minha_situacao()->>'aplica')::boolean, 'antes do prazo: ficha aplica ao corretor');
SELECT pg_temp.ok(NOT (public.ficha_minha_situacao()->>'completa')::boolean, 'antes do prazo: ficha pendente');
SELECT pg_temp.ok(NOT (public.ficha_minha_situacao()->>'bloqueia')::boolean, 'antes do prazo: NAO bloqueia (Preencher depois)');
RESET ROLE;

-- 2) DEPOIS da data → bloqueia até completar ---------------------------------------------------------
UPDATE public.ficha_config SET obrigatoria_a_partir_de = now() - interval '1 minute' WHERE organization_id = :'org_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1', :'sid_c1');
SELECT pg_temp.ok((public.ficha_minha_situacao()->>'bloqueia')::boolean, 'depois do prazo: bloqueia ficha pendente');
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok((public.ficha_minha_situacao()->>'bloqueia')::boolean, 'depois do prazo: vale para gestor tambem');
SELECT pg_temp.as_user(:'staff');
SELECT pg_temp.ok((public.ficha_minha_situacao()->>'bloqueia')::boolean, 'depois do prazo: vale para staff tambem');

-- 3) Validação ao salvar -----------------------------------------------------------------------------
SELECT pg_temp.as_user(:'c1', :'sid_c1');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.ficha_salvar_minha(2, true, 'Unimed', 'Maria', 'Mae', '15991234567', 'Hosp', NULL, DATE '1990-05-17', false)$q$) LIKE '22023%', 'sem aceite do aviso: recusa');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.ficha_salvar_minha(2, true, '', 'Maria', 'Mae', '15991234567', 'Hosp', NULL, DATE '1990-05-17', true)$q$) LIKE '22023%', 'tem plano sem dizer qual: recusa');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.ficha_salvar_minha(-1, false, NULL, 'Maria', 'Mae', '15991234567', 'Hosp', NULL, DATE '1990-05-17', true)$q$) LIKE '22023%', 'filhos negativo: recusa');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.ficha_salvar_minha(0, false, NULL, 'Maria', 'Mae', '1234', 'Hosp', NULL, DATE '1990-05-17', true)$q$) LIKE '22023%', 'telefone curto: recusa');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.ficha_salvar_minha(0, false, NULL, 'Maria', 'Mae', '15991234567', '', NULL, DATE '1990-05-17', true)$q$) LIKE '22023%', 'sem hospital: recusa');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.ficha_salvar_minha(0, false, NULL, 'Maria', 'Mae', '15991234567', 'Hosp', NULL, NULL, true)$q$) LIKE '22023%', 'sem data de nascimento: recusa');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.ficha_salvar_minha(0, false, NULL, 'Maria', 'Mae', '15991234567', 'Hosp', NULL, current_date, true)$q$) LIKE '22023%', 'nascimento hoje (menos de 16 anos): recusa');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.ficha_salvar_minha(0, false, NULL, 'Maria', '', '15991234567', 'Hosp', NULL, DATE '1990-05-17', true)$q$) LIKE '22023%', 'sem parentesco: recusa');

-- 4) Salvar válido: filhos 0 é válido, religião opcional; libera ----------------------------------------
SELECT pg_temp.ok((public.ficha_salvar_minha(0, false, 'ignorado', 'Maria Exemplo', 'Mae', '(15) 99123-4567', 'Hospital Exemplo', NULL, DATE '1990-05-17', true)->>'completa')::boolean, 'C1 salva com 0 filhos e sem religiao: completa');
SELECT pg_temp.ok(NOT (public.ficha_minha_situacao()->>'bloqueia')::boolean, 'C1 depois de salvar: libera');
SELECT pg_temp.ok(public.ficha_minha_situacao()->'ficha'->>'plano_saude' IS NULL, 'sem plano: o "qual" é descartado');
SELECT pg_temp.ok(public.ficha_minha_situacao()->>'data_nascimento' = '1990-05-17', 'data de nascimento gravada na tabela existente');
SELECT pg_temp.ok((public.ficha_minha_situacao()->'ficha'->>'aceite_em') IS NOT NULL, 'data do aceite registrada');
SELECT pg_temp.ok((pg_temp.salvar_ok(true, 'Unimed', 'Prefiro nao informar')->'ficha'->>'plano_saude') = 'Unimed', 'C1 edita depois (Meu perfil): plano Unimed');
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok((pg_temp.salvar_ok(false, NULL, 'Catolica')->>'completa')::boolean, 'C2 salva a propria ficha');

-- 5) RLS / acesso direto: ninguém lê a tabela sem RPC ------------------------------------------------
SELECT pg_temp.as_user(:'c1', :'sid_c1');
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.colaborador_fichas') LIKE '42501%', 'corretor: SELECT direto na tabela recusado');
SELECT pg_temp.ok(pg_temp.err($q$UPDATE public.colaborador_fichas SET religiao = 'x'$q$) LIKE '42501%', 'corretor: UPDATE direto recusado');
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.ficha_config') LIKE '42501%', 'corretor: ficha_config direto recusado');
SELECT pg_temp.as_user(:'staff');
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.colaborador_fichas') LIKE '42501%', 'staff: SELECT direto também recusado (só via RPC)');

-- 6) Quem NÃO vê a lista: corretor, gestor, team leader ---------------------------------------------
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(pg_temp.err('SELECT public.ficha_colaboradores_listar()') LIKE '42501%', 'corretor nao ve ficha de outro');
SELECT pg_temp.ok(NOT public.ficha_pode_ver_colaboradores(), 'corretor: pode_ver = false');
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(pg_temp.err('SELECT public.ficha_colaboradores_listar()') LIKE '42501%', 'gestor nao ve');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.ficha_colaboradores_registrar_exportacao('pdf', 1)$q$) LIKE '42501%', 'gestor nao exporta');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.ficha_config_salvar(now())$q$) LIKE '42501%', 'gestor nao muda o prazo');
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(pg_temp.err('SELECT public.ficha_colaboradores_listar()') LIKE '42501%', 'team leader nao ve');

-- 7) Staff/admin da MESMA imobiliária veem todos; nada da outra -------------------------------------
SELECT pg_temp.as_user(:'staff');
CREATE TEMP TABLE lst_staff ON COMMIT DROP AS SELECT public.ficha_colaboradores_listar() AS j;
SELECT pg_temp.ok(jsonb_array_length(j->'colaboradores') = 6, 'staff A: 6 colaboradores da A (sem o dono da plataforma)') FROM lst_staff;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM lst_staff, jsonb_array_elements(j->'colaboradores') e
                               WHERE e->>'user_id' IN (:'cb', :'ab', :'plat')), 'staff A: nenhuma pessoa da B nem a plataforma');
SELECT pg_temp.ok((SELECT (e->>'completa')::boolean FROM lst_staff, jsonb_array_elements(j->'colaboradores') e WHERE e->>'user_id' = :'c1'), 'staff A ve ficha completa do C1');
SELECT pg_temp.ok((SELECT e->>'plano_saude' FROM lst_staff, jsonb_array_elements(j->'colaboradores') e WHERE e->>'user_id' = :'c1') = 'Unimed', 'staff A ve plano do C1');
SELECT pg_temp.ok((SELECT NOT (e->>'completa')::boolean FROM lst_staff, jsonb_array_elements(j->'colaboradores') e WHERE e->>'user_id' = :'gestor'), 'staff A ve gestor pendente');
SELECT pg_temp.ok((SELECT e->'equipes' ? 'Equipe Exemplo' FROM lst_staff, jsonb_array_elements(j->'colaboradores') e WHERE e->>'user_id' = :'c1'), 'lista traz a equipe');
SELECT pg_temp.ok((SELECT e->'papeis' ? 'corretor' FROM lst_staff, jsonb_array_elements(j->'colaboradores') e WHERE e->>'user_id' = :'c1'), 'lista traz o papel');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(jsonb_array_length(public.ficha_colaboradores_listar()->'colaboradores') = 6, 'admin A ve os 6 da A');
SELECT pg_temp.as_user(:'ab');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.ficha_colaboradores_listar()->'colaboradores') e
                               WHERE e->>'user_id' NOT IN (:'ab', :'cb')), 'admin B: só pessoas da B (multiempresa)');
SELECT pg_temp.ok((SELECT e->>'religiao' FROM jsonb_array_elements(public.ficha_colaboradores_listar()->'colaboradores') e WHERE e->>'user_id' = :'cb') = 'Religiao B', 'admin B ve a ficha do corretor B');

-- 8) Log de exportação sem dados pessoais; prazo editável por staff ---------------------------------
SELECT pg_temp.as_user(:'staff');
SELECT public.ficha_colaboradores_registrar_exportacao('excel', 6);
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.ficha_colaboradores_registrar_exportacao('csv', 6)$q$) LIKE '22023%', 'formato fora da lista: recusa');
SELECT public.ficha_config_salvar(now() + interval '3 days');
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(NOT (public.ficha_minha_situacao()->>'bloqueia')::boolean, 'staff adiou o prazo: gestor volta a ter Preencher depois');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) = 1 AND bool_and(payload = jsonb_build_object('formato', 'excel', 'total', 6) AND autor_id = :'staff')
                     FROM public.activity_logs WHERE acao = 'colaborador_fichas_exportadas' AND organization_id = :'org_a'),
                  'log de exportacao: quem, formato e total (sem dado pessoal)');

-- 9) "Entrar como" e plataforma não leem nem gravam ---------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1', :'sid_imp');
SELECT pg_temp.ok(NOT (public.ficha_minha_situacao()->>'aplica')::boolean, 'Entrar como C1: porteiro nao aparece');
SELECT pg_temp.ok(public.ficha_minha_situacao()->'ficha' IS NULL, 'Entrar como C1: nao devolve a ficha');
SELECT pg_temp.ok(pg_temp.err($q$SELECT pg_temp.salvar_ok(false, NULL, NULL)$q$) LIKE '42501%', 'Entrar como C1: nao grava');
SELECT pg_temp.as_user(:'plat');
SELECT pg_temp.ok(NOT (public.ficha_minha_situacao()->>'aplica')::boolean, 'dono da plataforma: ficha nao se aplica');
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.ok(pg_temp.err('SELECT public.ficha_minha_situacao()') LIKE '42501%', 'sem login: recusa');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.ok(pg_temp.err('SELECT public.ficha_colaboradores_listar()') LIKE '42501%', 'anon: sem execute');
RESET ROLE;

-- 10) Padrão sem config: 30/10/2026 01:30 em São Paulo ----------------------------------------------
DELETE FROM public.ficha_config WHERE organization_id = :'org_b';
SELECT pg_temp.ok(public.ficha_obrigatoria_desde(:'org_b') = timestamptz '2026-10-30 04:30:00+00', 'padrao: 30/10/2026 01:30 SP (04:30 UTC)');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
