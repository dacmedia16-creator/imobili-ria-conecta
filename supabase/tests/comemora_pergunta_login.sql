-- Suíte da pergunta "Comemora aniversário?" no login (migration 20261104170000, t_05a37081).
-- Transação revertida, banco local descartável; nunca produção. Dados fictícios.
-- Montagem copiada de comemora_aniversario.sql.
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
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'mural_conquistas', true), (:'org_b', 'mural_conquistas', true)
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;

-- Mês "do aniversário" = mês atual em São Paulo (o mural lista o mês corrente).
CREATE FUNCTION pg_temp.mes() RETURNS int LANGUAGE sql AS
  $$ SELECT extract(month FROM now() AT TIME ZONE 'America/Sao_Paulo')::int $$;
CREATE FUNCTION pg_temp.nasc(_ano int) RETURNS date LANGUAGE sql AS $$ SELECT make_date(_ano, pg_temp.mes(), 7) $$;
CREATE FUNCTION pg_temp.no_mural(_u uuid) RETURNS boolean LANGUAGE sql AS
  $$ SELECT EXISTS (SELECT 1 FROM public.achievement_birthdays(pg_temp.mes()) a WHERE a.user_id = _u) $$;
CREATE FUNCTION pg_temp.salvar_ficha(_comemora boolean) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.ficha_salvar_minha(_qtd_filhos => 0, _tem_plano_saude => false, _plano_saude => NULL,
    _emergencia_nome => 'Maria Exemplo', _emergencia_parentesco => 'Mae',
    _emergencia_telefone => '(15) 99123-4567', _hospital_preferencia => 'Hospital Exemplo',
    _religiao => NULL, _data_nascimento => pg_temp.nasc(1990), _ciente => true,
    _comemora_aniversario => _comemora) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

-- Carga inicial (dados de comemora_pergunta_login_seed.sql, gravados antes da migration) ---------------
CREATE FUNCTION pg_temp.resp(_u uuid) RETURNS boolean LANGUAGE sql AS
  $$ SELECT comemora_respondido_em IS NOT NULL FROM public.profile_birthdates WHERE user_id = _u $$;
GRANT EXECUTE ON FUNCTION pg_temp.resp(uuid) TO authenticated;
SELECT pg_temp.ok(NOT pg_temp.resp('e0000000-0000-4000-8000-000000000001'), 'carga: Sim antigo (antes da tela nova) = nao respondeu');
SELECT pg_temp.ok(pg_temp.resp('e0000000-0000-4000-8000-000000000002'), 'carga: ja estava Nao = respondeu');
SELECT pg_temp.ok(pg_temp.resp('e0000000-0000-4000-8000-000000000003'), 'carga: gravou pela tela nova = respondeu');
SELECT pg_temp.ok(NOT pg_temp.resp('e0000000-0000-4000-8000-000000000004'), 'carga: gravado pela gestao = nao respondeu');
SELECT pg_temp.ok((SELECT bool_and(comemora_aniversario) FILTER (WHERE user_id <> 'e0000000-0000-4000-8000-000000000002')
                          AND NOT bool_or(comemora_aniversario) FILTER (WHERE user_id = 'e0000000-0000-4000-8000-000000000002')
                     FROM public.profile_birthdates WHERE user_id::text LIKE 'e0000000%'), 'carga: nenhuma escolha Sim/Nao mudou');
SELECT pg_temp.ok((SELECT is_nullable = 'YES' AND column_default IS NULL FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'profile_birthdates'
                      AND column_name = 'comemora_respondido_em'), 'coluna nova: nula, sem padrao');

-- Pessoas da montagem com data antiga (sem resposta), como em produção.
SET LOCAL session_replication_role = replica;
INSERT INTO public.profile_birthdates (user_id, data_nascimento) VALUES
  (:'c1', pg_temp.nasc(1990)), (:'c2', pg_temp.nasc(1985)), (:'staff', pg_temp.nasc(1988)),
  (:'plat', pg_temp.nasc(1970)), (:'cb', pg_temp.nasc(1979));
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
-- 1) Quem vê a janela.
SELECT pg_temp.as_user(:'c1', :'sid_c1');
SELECT pg_temp.ok(public.comemora_pergunta_pendente(), 'C1 com data e sem resposta: ve a janela');
SELECT pg_temp.ok(pg_temp.no_mural(:'c1'::uuid), 'enquanto nao responde vale Sim: C1 no mural');
SELECT pg_temp.as_user(:'c1', :'sid_imp');
SELECT pg_temp.ok(NOT public.comemora_pergunta_pendente(), '"Entrar como" C1: nao ve a janela');
SELECT pg_temp.ok(pg_temp.err('SELECT public.comemora_responder(false)') LIKE '42501%', '"Entrar como" nao responde pela pessoa');
SELECT pg_temp.as_user(:'plat');
SELECT pg_temp.ok(NOT public.comemora_pergunta_pendente(), 'dono da plataforma: nao ve a janela');
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(NOT public.comemora_pergunta_pendente(), 'sem data cadastrada: nao ve a janela');
SELECT pg_temp.ok(pg_temp.err('SELECT public.comemora_responder(true)') LIKE 'P0002%', 'sem data: responder recusa (nada criado)');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.profile_birthdates WHERE user_id = :'tl'), 'sem data: nenhuma linha criada');

-- 2) Resposta pela janela.
SELECT pg_temp.as_user(:'c1', :'sid_c1');
SELECT pg_temp.ok(pg_temp.err('SELECT public.comemora_responder(NULL)') LIKE '22023%', 'resposta vazia recusada');
SELECT pg_temp.ok(public.comemora_responder(false) = false, 'C1 responde Nao');
SELECT pg_temp.ok((SELECT NOT comemora_aniversario AND comemora_respondido_em IS NOT NULL AND data_nascimento = pg_temp.nasc(1990)
                     FROM public.profile_birthdates WHERE user_id = :'c1'), 'Nao gravado + respondido, data intacta');
SELECT pg_temp.ok(NOT public.comemora_pergunta_pendente(), 'depois de responder: nao pergunta de novo');
SELECT pg_temp.ok(NOT pg_temp.no_mural(:'c1'::uuid), 'Nao: fora do mural');
-- Janela velha (outra aba) responde Sim depois: não sobrescreve o Não já gravado.
SELECT pg_temp.ok(public.comemora_responder(true) = false, 'janela de outra aba: devolve a escolha atual (Nao)');
SELECT pg_temp.ok((SELECT NOT comemora_aniversario FROM public.profile_birthdates WHERE user_id = :'c1'),
  'janela de outra aba nao sobrescreve a resposta');
-- Muda depois no perfil (como hoje) e continua respondido.
SELECT public.profile_set_birthdate(pg_temp.nasc(1990), true);
SELECT pg_temp.ok(pg_temp.no_mural(:'c1'::uuid) AND pg_temp.resp(:'c1'::uuid), 'troca no perfil para Sim: volta ao mural, segue respondido');
SELECT public.profile_set_birthdate(pg_temp.nasc(1991));
SELECT pg_temp.ok(pg_temp.resp(:'c1'::uuid) AND NOT public.comemora_pergunta_pendente(), 'tela antiga (so data) nao apaga a resposta');

-- 3) Responder pelo perfil / 1º acesso (tela nova envia a escolha) também conta.
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(public.comemora_pergunta_pendente(), 'C2 ve a janela');
SELECT public.profile_set_birthdate(pg_temp.nasc(1985), true);
SELECT pg_temp.ok(pg_temp.resp(:'c2'::uuid) AND NOT public.comemora_pergunta_pendente(), 'Meu acesso com a escolha: respondido');
-- Tela antiga (só data) num registro novo: nasce Sim e sem resposta.
SELECT pg_temp.as_user(:'tl');
SELECT public.profile_set_birthdate(pg_temp.nasc(1990));
SELECT pg_temp.ok(NOT pg_temp.resp(:'tl'::uuid) AND public.comemora_pergunta_pendente(), 'so data (tela antiga): continua pendente');
-- Ficha com a escolha, mesma data e mesma escolha: ainda assim marca.
SELECT pg_temp.ok((pg_temp.salvar_ficha(true)->>'comemora_aniversario')::boolean, 'ficha grava Sim');
SELECT pg_temp.ok(pg_temp.resp(:'tl'::uuid) AND NOT public.comemora_pergunta_pendente(), 'ficha com a escolha (mesma data/escolha): respondido');
-- Ficha sem a escolha (tela antiga) não marca.
SELECT pg_temp.as_user(:'gestor');
SELECT public.profile_set_birthdate(pg_temp.nasc(1990));
SELECT pg_temp.ok((pg_temp.salvar_ficha(NULL)->>'comemora_aniversario')::boolean, 'ficha sem escolha: Sim mantido');
SELECT pg_temp.ok(NOT pg_temp.resp(:'gestor'::uuid) AND public.comemora_pergunta_pendente(), 'ficha sem escolha: continua pendente');

-- 4) Gestão grava pela pessoa: não conta como resposta.
SELECT pg_temp.as_user(:'admin');
SELECT public.profile_birthdate_set_for_user(:'staff', pg_temp.nasc(1988), false);
-- (lido como a própria pessoa: a tabela continua "só o dono lê")
SELECT pg_temp.as_user(:'staff');
SELECT pg_temp.ok((SELECT NOT comemora_aniversario AND comemora_respondido_em IS NULL
                     FROM public.profile_birthdates WHERE user_id = :'staff'),
  'gestao marcou Nao: vale Nao, mas nao conta como resposta da pessoa');
SELECT pg_temp.ok(public.comemora_pergunta_pendente(), 'staff ainda ve a janela');
SELECT pg_temp.ok(public.comemora_responder(true) AND pg_temp.no_mural(:'staff'::uuid), 'staff responde Sim: volta ao mural');

-- 5) Membro inativo e escrita direta.
SELECT pg_temp.as_user(:'cb');
SELECT pg_temp.ok(public.comemora_pergunta_pendente(), 'corretor de B (ativo) ve a janela');
RESET ROLE;
UPDATE public.organization_members SET ativo = false WHERE user_id = :'cb';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'cb');
SELECT pg_temp.ok(NOT public.comemora_pergunta_pendente(), 'membro inativo: nao ve a janela');
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(pg_temp.err('UPDATE public.profile_birthdates SET comemora_respondido_em = NULL') LIKE '42501%',
  'UPDATE direto da coluna recusado');
RESET ROLE;
-- Responder mexe só na própria linha.
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.profile_birthdates WHERE user_id::text LIKE 'e0000000%'
                     AND comemora_respondido_em IS NOT NULL
                     AND user_id NOT IN ('e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003')),
  'respostas dos outros nao mexem em ninguem mais');

SELECT pg_temp.ok(NOT (has_function_privilege('anon', 'public.comemora_pergunta_pendente()', 'EXECUTE')
                    OR has_function_privilege('anon', 'public.comemora_responder(boolean)', 'EXECUTE')), 'anon: sem execute');
SELECT pg_temp.ok(has_function_privilege('authenticated', 'public.comemora_pergunta_pendente()', 'EXECUTE')
              AND has_function_privilege('authenticated', 'public.comemora_responder(boolean)', 'EXECUTE'), 'authenticated: execute');
SELECT pg_temp.ok((SELECT bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'])
                     FROM pg_proc p WHERE p.proname IN ('comemora_pergunta_pendente', 'comemora_responder')),
  'RPCs novas: security definer + search_path vazio');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM pg_proc WHERE proname = 'profile_set_birthdate')
              AND (SELECT count(*) = 1 FROM pg_proc WHERE proname = 'ficha_salvar_minha'), 'uma assinatura por RPC');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
