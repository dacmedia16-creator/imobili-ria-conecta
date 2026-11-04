-- Suíte do "Você comemora aniversário?" (migration 20261104150000, t_2d5f0ab6). Transação revertida,
-- banco local descartável; nunca produção. Dados fictícios. Montagem copiada de ficha_filhos_faixas.sql.
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

-- Data já cadastrada ANTES da migration (simulada sem a coluna: default) → fica "Sim".
INSERT INTO public.profile_birthdates (user_id, data_nascimento) VALUES (:'c2', pg_temp.nasc(1985));
SELECT pg_temp.ok((SELECT comemora_aniversario FROM public.profile_birthdates WHERE user_id = :'c2'),
  'data existente: comemora = Sim por padrão');
SELECT pg_temp.ok((SELECT is_nullable = 'NO' AND column_default = 'true' FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'profile_birthdates'
                      AND column_name = 'comemora_aniversario'), 'coluna NOT NULL DEFAULT true');

SET LOCAL ROLE authenticated;
-- Mural: C2 (Sim) aparece.
SELECT pg_temp.as_user(:'c1', :'sid_c1');
SELECT pg_temp.ok(pg_temp.no_mural(:'c2'::uuid), 'Sim: aparece nos Aniversariantes do mês');

-- 1) Própria pessoa (Meu perfil / 1º acesso).
SELECT public.profile_set_birthdate(pg_temp.nasc(1991), false);
SELECT pg_temp.ok((SELECT NOT comemora_aniversario AND data_nascimento = pg_temp.nasc(1991)
                     FROM public.profile_birthdates WHERE user_id = :'c1'), 'propria pessoa grava data + Nao');
SELECT pg_temp.ok(NOT pg_temp.no_mural(:'c1'::uuid), 'Nao: fora dos Aniversariantes do mês');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.profile_birthdates WHERE user_id = :'c1'),
  'Nao: a propria pessoa continua lendo a data');
-- Chamada antiga (só a data, tela publicada antes) NÃO muda a escolha.
SELECT public.profile_set_birthdate(pg_temp.nasc(1992));
SELECT pg_temp.ok((SELECT NOT comemora_aniversario FROM public.profile_birthdates WHERE user_id = :'c1'),
  'chamada antiga (sem a escolha) mantem Nao');
SELECT public.profile_set_birthdate(pg_temp.nasc(1992), true);
SELECT pg_temp.ok(pg_temp.no_mural(:'c1'::uuid), 'volta para Sim: reaparece no mural');
-- Apagar a data apaga a escolha; registro novo sem escolha nasce Sim.
SELECT public.profile_set_birthdate(NULL);
SELECT public.profile_set_birthdate(pg_temp.nasc(1992));
SELECT pg_temp.ok((SELECT comemora_aniversario FROM public.profile_birthdates WHERE user_id = :'c1'),
  'registro novo sem escolha nasce Sim');
-- Corretor não lê a escolha de outro (tabela continua "só o dono lê").
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.profile_birthdates WHERE user_id = :'c2'),
  'corretor nao le a linha de outro');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.profile_birthdate_info_for_user('a0000000-0000-4000-8000-000000000005')$q$) LIKE '42501%',
  'corretor nao usa a RPC de gestao');
-- Escrita direta na tabela continua proibida.
SELECT pg_temp.ok(pg_temp.err($q$UPDATE public.profile_birthdates SET comemora_aniversario = false$q$) LIKE '42501%',
  'UPDATE direto na tabela recusado');

-- 2) Gestão (Editar/Novo usuário): gestor de A no corretor C2.
SELECT pg_temp.as_user(:'gestor');
SELECT public.profile_birthdate_set_for_user(:'c2', pg_temp.nasc(1985), false);
SELECT pg_temp.ok(public.profile_birthdate_info_for_user(:'c2')
                  = jsonb_build_object('data_nascimento', pg_temp.nasc(1985), 'comemora_aniversario', false),
  'gestao grava Nao e continua vendo a data + escolha');
SELECT pg_temp.ok(NOT pg_temp.no_mural(:'c2'::uuid), 'gestao marcou Nao: fora do mural');
SELECT public.profile_birthdate_set_for_user(:'c2', pg_temp.nasc(1985));
SELECT pg_temp.ok((public.profile_birthdate_info_for_user(:'c2')->>'comemora_aniversario')::boolean = false,
  'gestao: chamada antiga (sem escolha) mantem Nao');
SELECT pg_temp.ok(public.profile_birthdate_get_for_user(:'c2') = pg_temp.nasc(1985), 'RPC antiga de leitura intacta');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.profile_birthdate_info_for_user('a0000000-0000-4000-8000-000000000001')$q$) LIKE '42501%',
  'gestor nao le data/escolha de admin');
SELECT pg_temp.ok(public.profile_birthdate_info_for_user(:'c1')->>'comemora_aniversario' = 'true', 'gestao le Sim do C1');
-- Sem data cadastrada: data null, escolha padrão Sim.
SELECT public.profile_birthdate_set_for_user(:'c1', NULL);
SELECT pg_temp.ok(public.profile_birthdate_info_for_user(:'c1')
                  = '{"data_nascimento": null, "comemora_aniversario": true}'::jsonb, 'sem data: null + Sim');
-- Outra imobiliária.
SELECT pg_temp.as_user(:'ab');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.profile_birthdate_info_for_user('a0000000-0000-4000-8000-000000000005')$q$) LIKE '42501%',
  'admin de B nao le escolha de corretor de A');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.profile_birthdate_set_for_user('a0000000-0000-4000-8000-000000000005', '1980-01-01', true)$q$) LIKE '42501%',
  'admin de B nao grava escolha de corretor de A');

-- 3) Ficha do colaborador (grava data própria).
SELECT pg_temp.as_user(:'c1', :'sid_c1');
SELECT pg_temp.ok((pg_temp.salvar_ficha(false)->>'comemora_aniversario')::boolean = false, 'ficha grava Nao e devolve na situacao');
SELECT pg_temp.ok(NOT pg_temp.no_mural(:'c1'::uuid), 'ficha Nao: fora do mural');
SELECT pg_temp.ok((pg_temp.salvar_ficha(NULL)->>'comemora_aniversario')::boolean = false, 'ficha sem escolha (tela antiga) mantem Nao');
SELECT pg_temp.ok((pg_temp.salvar_ficha(true)->>'comemora_aniversario')::boolean = true, 'ficha volta para Sim');
SELECT pg_temp.ok(pg_temp.no_mural(:'c1'::uuid), 'ficha Sim: no mural');
-- Situação de quem não tem data: Sim por padrão.
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok((public.ficha_minha_situacao()->>'comemora_aniversario')::boolean, 'situacao sem data: Sim por padrão');
-- Staff vê a escolha na Ficha dos colaboradores.
SELECT pg_temp.as_user(:'staff');
SELECT pg_temp.ok((SELECT c->'comemora_aniversario' FROM jsonb_array_elements(public.ficha_colaboradores_listar()->'colaboradores') c
                    WHERE c->>'user_id' = :'c2') = 'false'::jsonb, 'staff ve Nao do C2');
SELECT pg_temp.ok((SELECT c->'comemora_aniversario' FROM jsonb_array_elements(public.ficha_colaboradores_listar()->'colaboradores') c
                    WHERE c->>'user_id' = :'tl') = 'null'::jsonb, 'staff: sem data = escolha null');
SELECT pg_temp.ok((SELECT c->>'data_nascimento' FROM jsonb_array_elements(public.ficha_colaboradores_listar()->'colaboradores') c
                    WHERE c->>'user_id' = :'c2') = pg_temp.nasc(1985)::text, 'staff continua vendo a data de quem disse Nao');
RESET ROLE;

-- Auditoria e permissões.
SELECT pg_temp.ok((SELECT bool_and(NOT (payload::text ~ '[0-9]{4}-[0-9]{2}-[0-9]{2}')) AND count(*) >= 2
                     FROM public.activity_logs WHERE acao = 'user_birthdate_set' AND payload->>'target_user' = :'c2'),
  'auditoria sem a data');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.activity_logs WHERE acao = 'user_birthdate_set'
                     AND payload->>'target_user' = :'c2' AND payload->>'comemora_aniversario' = 'false'),
  'auditoria registra a escolha');
SELECT pg_temp.ok(NOT (has_function_privilege('anon', 'public.profile_set_birthdate(date,boolean)', 'EXECUTE')
                    OR has_function_privilege('anon', 'public.profile_birthdate_set_for_user(uuid,date,boolean)', 'EXECUTE')
                    OR has_function_privilege('anon', 'public.profile_birthdate_info_for_user(uuid)', 'EXECUTE')
                    OR has_function_privilege('anon', 'public.achievement_birthdays(integer)', 'EXECUTE')),
  'anon: sem execute');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM pg_proc WHERE proname = 'profile_set_birthdate')
              AND (SELECT count(*) = 1 FROM pg_proc WHERE proname = 'profile_birthdate_set_for_user')
              AND (SELECT count(*) = 1 FROM pg_proc WHERE proname = 'ficha_salvar_minha'), 'uma assinatura por RPC (sem ambiguidade)');
SELECT pg_temp.ok((SELECT string_agg(policyname, ',') = 'profile_birthdates_self' FROM pg_policies
                    WHERE schemaname = 'public' AND tablename = 'profile_birthdates'), 'politica continua "so o dono le"');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
