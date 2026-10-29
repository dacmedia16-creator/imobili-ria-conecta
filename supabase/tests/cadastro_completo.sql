-- Suíte do cadastro completo no aviso/trava da ficha (migration 20261029160000, t_b98f3e4b).
-- Roda DENTRO de transação revertida (run-cadastro-completo.sh), em banco local descartável; nunca
-- em produção. Dados 100% fictícios. CPFs de exemplo válidos: 529.982.247-25 e 111.444.777-35.
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
CREATE FUNCTION pg_temp.ficha_ok() RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.ficha_salvar_minha(_qtd_filhos => 1, _tem_plano_saude => false, _plano_saude => NULL,
    _emergencia_nome => 'Maria Exemplo', _emergencia_parentesco => 'Mae',
    _emergencia_telefone => '(15) 99123-4567', _hospital_preferencia => 'Hospital Exemplo',
    _religiao => NULL, _data_nascimento => DATE '1990-05-17', _ciente => true) $$;
CREATE FUNCTION pg_temp.pend() RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.ficha_minha_situacao()->'cadastro_pendente' $$;

\set org_a 'a0000000-0000-4000-8000-0000000000a0'
\set org_b 'b0000000-0000-4000-8000-0000000000b0'
\set admin 'a0000000-0000-4000-8000-000000000001'
\set gestor 'a0000000-0000-4000-8000-000000000002'
\set tl 'a0000000-0000-4000-8000-000000000003'
\set c1 'a0000000-0000-4000-8000-000000000004'
\set c2 'a0000000-0000-4000-8000-000000000005'
\set staff 'a0000000-0000-4000-8000-000000000006'
\set cb 'b0000000-0000-4000-8000-000000000002'
\set plat 'f0000000-0000-4000-8000-000000000001'
\set sid_imp 'd0000000-0000-4000-8000-000000000001'
\set sid_c1 'd0000000-0000-4000-8000-000000000002'

-- Montagem ------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid, not_after timestamptz);
INSERT INTO auth.sessions (id, user_id) VALUES (:'sid_imp', :'c1'), (:'sid_c1', :'c1') ON CONFLICT DO NOTHING;
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'org_a', 'teste-cad-a', 'Imobiliaria Exemplo A', 'ativa', '00000000000191', '#112233', '#445566'),
  (:'org_b', 'teste-cad-b', 'Imobiliaria Exemplo B', 'ativa', '00000000000272', '#112233', '#445566');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'gestor', :'tl', :'c1', :'c2', :'staff', :'cb', :'plat']::uuid[]);
-- Admin: tudo certo menos telefone. Staff: sem CPF/ID (não deve ser cobrado). C2: ID antigo fora do padrão.
-- CB (outra imobiliária): ID 630111222 (para testar o duplicado entre imobiliárias).
INSERT INTO public.profiles (id, nome, email, ativo, organization_id, telefone, cpf, remax_id) VALUES
  (:'admin', 'Dona Exemplo', 'dona@exemplo.test', true, :'org_a', NULL, NULL, NULL),
  (:'gestor', 'Gestor Exemplo', 'gestor@exemplo.test', true, :'org_a', '15991234567', '529.982.247-25', '630000001'),
  (:'tl', 'Lider Exemplo', 'tl@exemplo.test', true, :'org_a', '15991234567', NULL, NULL),
  (:'c1', 'Carlos', 'c1@exemplo.test', true, :'org_a', NULL, NULL, NULL),
  (:'c2', 'Bruna Dois', 'c2@exemplo.test', true, :'org_a', '15991234567', '111.444.777-35', '900000001'),
  (:'staff', 'Sara Staff', 'staff@exemplo.test', true, :'org_a', '15991234567', NULL, NULL),
  (:'cb', 'Corretor B', 'cb@exemplo.test', true, :'org_b', '15991234567', NULL, '630111222'),
  (:'plat', 'Dono Plataforma', 'plat@exemplo.test', true, :'org_a', NULL, NULL, NULL);
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org_a', :'admin', true), (:'org_a', :'gestor', true), (:'org_a', :'tl', true), (:'org_a', :'c1', true),
  (:'org_a', :'c2', true), (:'org_a', :'staff', true), (:'org_b', :'cb', true), (:'org_a', :'plat', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'gestor', 'gestor', :'org_a'), (:'tl', 'team_leader', :'org_a'),
  (:'c1', 'corretor', :'org_a'), (:'c2', 'corretor', :'org_a'), (:'staff', 'staff', :'org_a'),
  (:'cb', 'corretor', :'org_b'), (:'plat', 'super_admin', :'org_a');
INSERT INTO public.platform_admins (user_id) VALUES (:'plat');
INSERT INTO public.operational_impersonation_sessions (actor_user_id, target_user_id, auth_session_id, status, started_at, organization_id)
  VALUES (:'plat', :'c1', :'sid_imp', 'active', now(), :'org_a');
SET LOCAL session_replication_role = origin;
INSERT INTO public.ficha_config (organization_id, obrigatoria_a_partir_de) VALUES (:'org_a', now() + interval '1 day');

-- 1) Quem é cobrado de quê ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1', :'sid_c1');
SELECT pg_temp.ok(pg_temp.pend() @> '["nome","telefone","cpf","remax_id"]'::jsonb, 'corretor sem nada: cobra nome, telefone, CPF e ID RE/MAX');
SELECT pg_temp.ok(NOT pg_temp.pend() ? 'creci', 'CRECI nao e cobrado');
SELECT pg_temp.ok((public.ficha_minha_situacao()->>'cadastro_exige_registro')::boolean, 'corretor: exige registro');
SELECT pg_temp.as_user(:'staff');
SELECT pg_temp.ok(pg_temp.pend() = '[]'::jsonb, 'staff sem CPF/ID: NAO e cobrado');
SELECT pg_temp.ok(NOT (public.ficha_minha_situacao()->>'cadastro_exige_registro')::boolean, 'staff: nao exige registro');
SELECT pg_temp.ok(public.ficha_minha_situacao()->'cadastro'->>'cpf' IS NULL, 'staff: cpf nem vem na resposta');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.pend() = '["telefone"]'::jsonb, 'admin: so o telefone (sem CPF/ID)');
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(pg_temp.pend() = '["cpf","remax_id"]'::jsonb, 'team leader: cobra CPF e ID');
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(pg_temp.pend() = '[]'::jsonb, 'gestor com tudo certo: sem pendencia de cadastro');
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(pg_temp.pend() = '["remax_id_invalido"]'::jsonb, 'ID antigo fora do padrao: cobrado a corrigir (nao apagado)');

-- 2) Prazo: antes libera com "Preencher depois"; depois trava; ficha completa + cadastro pendente também
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok((pg_temp.ficha_ok()->>'completa')::boolean, 'gestor completa a ficha');
SELECT pg_temp.ok(NOT (public.ficha_minha_situacao()->>'bloqueia')::boolean, 'gestor completo: nao bloqueia');
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok((pg_temp.ficha_ok()->>'completa')::boolean, 'C2 completa a ficha');
SELECT pg_temp.ok(NOT (public.ficha_minha_situacao()->>'cadastro_completo')::boolean, 'C2 ficha completa mas cadastro pendente');
SELECT pg_temp.ok(NOT (public.ficha_minha_situacao()->>'bloqueia')::boolean, 'antes do prazo: nao bloqueia (Preencher depois)');
RESET ROLE;
UPDATE public.ficha_config SET obrigatoria_a_partir_de = now() - interval '1 minute' WHERE organization_id = :'org_a';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok((public.ficha_minha_situacao()->>'bloqueia')::boolean, 'depois do prazo: ficha completa + ID errado BLOQUEIA');
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(NOT (public.ficha_minha_situacao()->>'bloqueia')::boolean, 'depois do prazo: gestor completo nao bloqueia');
SELECT pg_temp.as_user(:'staff');
SELECT pg_temp.ok((pg_temp.ficha_ok()->>'completa')::boolean, 'staff completa a ficha');
SELECT pg_temp.ok(NOT (public.ficha_minha_situacao()->>'bloqueia')::boolean, 'staff com ficha completa e sem CPF/ID: libera');

-- 3) Validação do ID RE/MAX e do CPF no servidor --------------------------------------------------------
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.cadastro_salvar_meu(NULL, NULL, NULL, '63060127')$q$) LIKE '22023%', 'ID com 8 digitos: recusa');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.cadastro_salvar_meu(NULL, NULL, NULL, '123456789')$q$) LIKE '22023%', 'ID sem 630: recusa');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.cadastro_salvar_meu(NULL, NULL, NULL, '6306012720')$q$) LIKE '22023%', 'ID com 10 digitos: recusa');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.cadastro_salvar_meu(NULL, NULL, NULL, '630000001')$q$) LIKE '23505%', 'ID de outro corretor (mesma imobiliaria): recusa');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.cadastro_salvar_meu(NULL, NULL, NULL, '630111222')$q$) LIKE '23505%', 'ID de corretor de OUTRA imobiliaria: recusa');
SELECT pg_temp.ok(pg_temp.err($q$UPDATE public.profiles SET remax_id = '123456789' WHERE id = auth.uid()$q$) LIKE '22023%', 'UPDATE direto com ID sem 630: recusado pelo gatilho');
SELECT pg_temp.ok(pg_temp.err($q$UPDATE public.profiles SET remax_id = '630000001' WHERE id = auth.uid()$q$) LIKE '23505%', 'UPDATE direto com ID duplicado: recusado pelo indice');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.cadastro_salvar_meu(NULL, NULL, '111.444.777-36', NULL)$q$) LIKE '22023%', 'CPF com digito errado: recusa');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.cadastro_salvar_meu(NULL, NULL, '111.111.111-11', NULL)$q$) LIKE '22023%', 'CPF repetido 111...: recusa');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.cadastro_salvar_meu('Bruna', NULL, NULL, NULL)$q$) LIKE '22023%', 'nome de uma palavra: recusa');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.cadastro_salvar_meu(NULL, '1599', NULL, NULL)$q$) LIKE '22023%', 'telefone curto: recusa');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.cadastro_salvar_meu(E'\tBruna ', NULL, NULL, NULL)$q$) LIKE '22023%', 'nome de uma palavra com tab: recusa');
-- Perfil INATIVO com o mesmo ID não prende quem está ativo.
RESET ROLE;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id) VALUES ('c0000000-0000-4000-8000-000000000009');
INSERT INTO public.profiles (id, nome, email, ativo, organization_id, remax_id)
  VALUES ('c0000000-0000-4000-8000-000000000009', 'Conta Antiga', 'antiga@exemplo.test', false, :'org_b', '630777888');
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok((public.cadastro_salvar_meu(NULL, NULL, '52998224725', '630777888')->'cadastro_pendente') = '[]'::jsonb, 'ID igual ao de perfil INATIVO: aceito');
SELECT pg_temp.as_user(:'c2');
-- Antiga edição de outro campo do perfil com ID antigo fora do padrão continua funcionando.
SELECT pg_temp.ok(pg_temp.err($q$UPDATE public.profiles SET telefone = '15991230000' WHERE id = auth.uid()$q$) IS NULL, 'ID antigo errado nao trava a edicao de outro campo');
SELECT pg_temp.ok((public.cadastro_salvar_meu(NULL, NULL, NULL, '630-601-272')->>'bloqueia') = 'false', 'C2 corrige o ID (com pontuacao) e libera');
SELECT pg_temp.ok(public.ficha_minha_situacao()->'cadastro'->>'remax_id' = '630601272', 'ID gravado so com digitos');

-- 4) Corretor C1 preenche tudo pelo aviso e libera ---------------------------------------------------
SELECT pg_temp.as_user(:'c1', :'sid_c1');
SELECT pg_temp.ok((public.ficha_minha_situacao()->>'bloqueia')::boolean, 'C1 depois do prazo: bloqueado');
SELECT pg_temp.ok((pg_temp.ficha_ok()->>'bloqueia')::boolean, 'C1 so com a ficha: continua bloqueado (cadastro pendente)');
SELECT pg_temp.ok((public.cadastro_salvar_meu('Carlos Um', '(15) 99876-5432', '52998224725', '630222333')->>'bloqueia') = 'false', 'C1 salva cadastro completo: libera');
SELECT pg_temp.ok(public.ficha_minha_situacao()->'cadastro'->>'cpf' = '529.982.247-25', 'CPF gravado no formato do banco');

-- 5) Staff: CPF/ID enviados por quem não é corretor são ignorados ---------------------------------------
SELECT pg_temp.as_user(:'staff');
SELECT public.cadastro_salvar_meu(NULL, NULL, '52998224725', '630444555');
RESET ROLE;
SELECT pg_temp.ok((SELECT cpf IS NULL AND remax_id IS NULL FROM public.profiles WHERE id = :'staff'), 'staff: CPF/ID ignorados (nao grava)');
SET LOCAL ROLE authenticated;

-- 6) Lista do staff: cadastro_pendente por pessoa, só chaves -------------------------------------------
SELECT pg_temp.as_user(:'staff');
CREATE TEMP TABLE lst ON COMMIT DROP AS SELECT public.ficha_colaboradores_listar() AS j;
SELECT pg_temp.ok((SELECT e->'cadastro_pendente' FROM lst, jsonb_array_elements(j->'colaboradores') e WHERE e->>'user_id' = :'admin') = '["telefone"]'::jsonb, 'lista: admin com telefone pendente (sem CPF/ID)');
SELECT pg_temp.ok((SELECT e->'cadastro_pendente' FROM lst, jsonb_array_elements(j->'colaboradores') e WHERE e->>'user_id' = :'tl') = '[]'::jsonb, 'lista: TL depois de salvar CPF e ID: sem pendencia');
SELECT pg_temp.ok((SELECT e->'cadastro_pendente' FROM lst, jsonb_array_elements(j->'colaboradores') e WHERE e->>'user_id' = :'c1') = '[]'::jsonb, 'lista: C1 sem pendencia');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM lst, jsonb_array_elements(j->'colaboradores') e WHERE e ? 'cpf' OR e ? 'remax_id'), 'lista nao expoe CPF nem ID');
SELECT pg_temp.as_user(:'c1', :'sid_c1');
SELECT pg_temp.ok(pg_temp.err('SELECT public.ficha_colaboradores_listar()') LIKE '42501%', 'corretor continua sem ver a lista');

-- 7) "Entrar como", plataforma, sem login, anon ----------------------------------------------------
SELECT pg_temp.as_user(:'c1', :'sid_imp');
SELECT pg_temp.ok(NOT (public.ficha_minha_situacao()->>'aplica')::boolean, 'Entrar como: aviso nao aparece');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.cadastro_salvar_meu('Outro Nome', NULL, NULL, NULL)$q$) LIKE '42501%', 'Entrar como: nao grava cadastro');
SELECT pg_temp.as_user(:'plat');
SELECT pg_temp.ok(NOT (public.ficha_minha_situacao()->>'aplica')::boolean, 'dono da plataforma: nao se aplica');
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.cadastro_salvar_meu(NULL, NULL, NULL, NULL)$q$) LIKE '42501%', 'sem login: recusa');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.cadastro_salvar_meu(NULL, NULL, NULL, NULL)$q$) LIKE '42501%', 'anon: sem execute');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.err($q$SET LOCAL ROLE authenticated; SELECT public.cadastro_pendencias(auth.uid(), NULL)$q$) LIKE '42501%', 'helper interno sem execute para authenticated');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
