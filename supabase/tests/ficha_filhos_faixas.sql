-- Suíte das faixas de idade dos filhos (migration 20261030100000, t_27d37c57). Transação revertida,
-- banco local descartável; nunca produção. Dados fictícios. Montagem copiada de ficha_colaborador.sql.
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

INSERT INTO public.ficha_config (organization_id, obrigatoria_a_partir_de) VALUES (:'org_a', now() - interval '1 minute');
CREATE FUNCTION pg_temp.salvar(_qtd int, _faixas text[]) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.ficha_salvar_minha(_qtd_filhos => _qtd, _tem_plano_saude => false, _plano_saude => NULL,
    _emergencia_nome => 'Maria Exemplo', _emergencia_parentesco => 'Mae',
    _emergencia_telefone => '(15) 99123-4567', _hospital_preferencia => 'Hospital Exemplo',
    _religiao => NULL, _data_nascimento => DATE '1990-05-17', _ciente => true, _filhos_faixas => _faixas) $$;
CREATE FUNCTION pg_temp.faixas() RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.ficha_minha_situacao()->'ficha'->'filhos_faixas' $$;

-- Ficha antiga (já existente antes da migration) fica com lista vazia.
SELECT pg_temp.ok((SELECT filhos_faixas = '{}' FROM public.colaborador_fichas WHERE user_id = :'cb'), 'ficha existente: faixas vazias (nada alterado)');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1', :'sid_c1');
-- SIM (2 filhos) com duas faixas, fora de ordem e repetida → grava ordenado e sem repetir.
SELECT pg_temp.ok((pg_temp.salvar(2, ARRAY['11-15','0-5','11-15'])->>'completa')::boolean, 'tem filhos + 2 faixas: salva e completa');
SELECT pg_temp.ok(pg_temp.faixas() = '["0-5","11-15"]'::jsonb, 'faixas gravadas em ordem, sem repetir');
SELECT pg_temp.salvar(3, ARRAY['16+','6-10','0-5','11-15']);
SELECT pg_temp.ok(pg_temp.faixas() = '["0-5","6-10","11-15","16+"]'::jsonb, 'as 4 faixas (inclui 16 anos ou mais)');
-- Opcional: tem filhos sem faixa → salva, completa, não bloqueia.
SELECT pg_temp.ok((pg_temp.salvar(1, ARRAY[]::text[])->>'completa')::boolean, 'tem filhos sem faixa: salva (opcional)');
SELECT pg_temp.ok(NOT (public.ficha_minha_situacao()->>'bloqueia')::boolean, 'sem faixa nao bloqueia');
SELECT pg_temp.ok(pg_temp.faixas() = '[]'::jsonb, 'lista vazia enviada: limpa');
-- Chamada antiga (sem o parâmetro) mantém o que estava.
SELECT pg_temp.salvar(2, ARRAY['6-10']);
SELECT public.ficha_salvar_minha(2, false, NULL, 'Maria Exemplo', 'Mae', '(15) 99123-4567', 'Hospital Exemplo', NULL, DATE '1990-05-17', true);
SELECT pg_temp.ok(pg_temp.faixas() = '["6-10"]'::jsonb, 'chamada antiga (10 parametros): mantem faixas');
-- NÃO (0 filhos) limpa, mesmo se a tela mandar faixas.
SELECT pg_temp.salvar(0, ARRAY['0-5']);
SELECT pg_temp.ok(pg_temp.faixas() = '[]'::jsonb, '0 filhos: faixas limpas');
SELECT pg_temp.salvar(2, ARRAY['6-10']);
SELECT public.ficha_salvar_minha(0, false, NULL, 'Maria Exemplo', 'Mae', '(15) 99123-4567', 'Hospital Exemplo', NULL, DATE '1990-05-17', true);
SELECT pg_temp.ok(pg_temp.faixas() = '[]'::jsonb, '0 filhos pela chamada antiga: tambem limpa');
-- Valor fora da lista: recusa sem gravar.
SELECT pg_temp.ok(pg_temp.err($q$SELECT pg_temp.salvar(2, ARRAY['0-5','17-20'])$q$) LIKE '22023%Faixa%', 'faixa invalida: recusa 22023');
SELECT pg_temp.ok(pg_temp.err($q$SELECT pg_temp.salvar(2, ARRAY[NULL::text])$q$) LIKE '22023%', 'faixa nula: recusa');
-- Sem acesso direto à tabela.
SELECT pg_temp.ok(pg_temp.err('SELECT filhos_faixas FROM public.colaborador_fichas') LIKE '42501%', 'authenticated: sem SELECT direto');
-- Staff vê as faixas; corretor não lista.
SELECT pg_temp.salvar(2, ARRAY['0-5','16+']);
SELECT pg_temp.as_user(:'staff');
SELECT pg_temp.ok((SELECT c->'filhos_faixas' FROM jsonb_array_elements(public.ficha_colaboradores_listar()->'colaboradores') c
                    WHERE c->>'user_id' = :'c1') = '["0-5","16+"]'::jsonb, 'staff ve as faixas do C1');
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(pg_temp.err('SELECT public.ficha_colaboradores_listar()') LIKE '42501%', 'corretor nao lista fichas');
-- Entrar como: continua recusado.
SELECT pg_temp.as_user(:'c1', :'sid_imp');
SELECT pg_temp.ok(pg_temp.err($q$SELECT pg_temp.salvar(2, ARRAY['0-5'])$q$) LIKE '42501%', 'Entrar como: nao grava');
RESET ROLE;
-- Trava no banco: faixa com 0 filhos é recusada mesmo por escrita direta.
SELECT pg_temp.ok(pg_temp.err($q$UPDATE public.colaborador_fichas SET qtd_filhos = 0 WHERE user_id = 'a0000000-0000-4000-8000-000000000004'$q$) LIKE '23514%', 'CHECK: 0 filhos com faixa recusado');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
