-- Suíte dos depoimentos (migration 20261102120000, t_c7cfaf00).
-- Roda DENTRO de transação revertida (run-depoimentos.sh), em banco local descartável ou
-- homologação; nunca em produção. Dados 100% fictícios, criados aqui.
-- Imobiliária A: veterana (C1, 30 dias + ação), novata (C2, 3 dias), sem uso (C3, 30 dias sem ação),
-- gestor (30 dias + ação). Imobiliária B: corretor B (30 dias + ação). Plataforma: dono (moderador).
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
CREATE TEMP TABLE ids(nome text PRIMARY KEY, id uuid);
GRANT ALL ON ids TO authenticated, anon;

\set org_a 'a0000000-0000-4000-8000-0000000000a0'
\set org_b 'b0000000-0000-4000-8000-0000000000b0'
\set c1 'a0000000-0000-4000-8000-000000000004'
\set c2 'a0000000-0000-4000-8000-000000000005'
\set c3 'a0000000-0000-4000-8000-000000000007'
\set gestor 'a0000000-0000-4000-8000-000000000002'
\set cb 'b0000000-0000-4000-8000-000000000002'
\set plat 'f0000000-0000-4000-8000-000000000001'
\set sid_imp 'd0000000-0000-4000-8000-000000000001'

-- Montagem (sem gatilhos, só nesta transação) -----------------------------------------------------
CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid, not_after timestamptz);
INSERT INTO auth.sessions (id, user_id) VALUES (:'sid_imp', :'c1') ON CONFLICT DO NOTHING;
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria, cidade) VALUES
  (:'org_a', 'teste-dep-a', 'RE/MAX Exemplo A', 'ativa', '00000000000191', '#112233', '#445566', 'Sorocaba'),
  (:'org_b', 'teste-dep-b', 'RE/MAX Exemplo B', 'ativa', '00000000000272', '#112233', '#445566', NULL);
INSERT INTO auth.users (id, created_at) VALUES
  (:'c1', now() - interval '30 days'), (:'c2', now() - interval '3 days'), (:'c3', now() - interval '30 days'),
  (:'gestor', now() - interval '60 days'), (:'cb', now() - interval '40 days'), (:'plat', now() - interval '400 days');
INSERT INTO public.profiles (id, nome, email, telefone, cpf, remax_id, avatar_url, ativo, organization_id) VALUES
  (:'c1', 'Maria Aparecida da Silva', 'maria@exemplo.test', '15991234567', '529.982.247-25', '630000013', 'https://exemplo.test/avatars/c1.jpg', true, :'org_a'),
  (:'c2', 'Bruna Dois', 'c2@exemplo.test', '15991234567', '529.982.247-25', '630000014', NULL, true, :'org_a'),
  (:'c3', 'Carlos Tres', 'c3@exemplo.test', '15991234567', NULL, NULL, NULL, true, :'org_a'),
  (:'gestor', 'Gestor Exemplo', 'gestor@exemplo.test', '15991234567', NULL, NULL, NULL, true, :'org_a'),
  (:'cb', 'Joao de Souza', 'cb@exemplo.test', '15991234567', '529.982.247-25', '630000015', NULL, true, :'org_b'),
  (:'plat', 'Dono Plataforma', 'plat@exemplo.test', NULL, NULL, NULL, NULL, true, :'org_a');
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org_a', :'c1', true), (:'org_a', :'c2', true), (:'org_a', :'c3', true), (:'org_a', :'gestor', true),
  (:'org_b', :'cb', true), (:'org_a', :'plat', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'c1', 'corretor', :'org_a'), (:'c2', 'corretor', :'org_a'), (:'c3', 'corretor', :'org_a'),
  (:'gestor', 'gestor', :'org_a'), (:'cb', 'corretor', :'org_b'), (:'plat', 'super_admin', :'org_a');
INSERT INTO public.platform_admins (user_id) VALUES (:'plat');
INSERT INTO public.activity_logs (autor_id, acao, payload, organization_id) VALUES
  (:'c1', 'document_uploaded', '{}', :'org_a'), (:'c2', 'document_uploaded', '{}', :'org_a'),
  (:'c3', 'sale_viewed', '{}', :'org_a'), (:'gestor', 'status_change', '{}', :'org_a'),
  (:'cb', 'status_change', '{}', :'org_b');
INSERT INTO public.operational_impersonation_sessions (actor_user_id, target_user_id, auth_session_id, status, started_at, organization_id)
  VALUES (:'plat', :'c1', :'sid_imp', 'active', now(), :'org_a');
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
-- 1) Público do convite ----------------------------------------------------------------------------
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok((public.depoimento_minha_situacao()->>'convite')::boolean, 'C1 (30 dias + documento enviado): convite abre');
SELECT pg_temp.ok(public.depoimento_minha_situacao()->'previa'->>'nome_exibicao' = 'Maria S.', 'previa: nome abreviado "Maria S."');
SELECT pg_temp.ok(public.depoimento_minha_situacao()->'previa'->>'foto_url' = 'https://exemplo.test/avatars/c1.jpg', 'previa: foto do cadastro');
SELECT pg_temp.ok(public.depoimento_minha_situacao()->'previa'->>'cidade' = 'Sorocaba', 'previa: cidade da imobiliaria');
SELECT pg_temp.ok(public.depoimento_minha_situacao()->'previa'->>'papel' = 'Corretor(a)', 'previa: papel');
SELECT pg_temp.ok(public.depoimento_minha_situacao()->'termo'->>'versao' = 'v1-2026-11-02', 'termo vigente v1');
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(NOT (public.depoimento_minha_situacao()->>'convite')::boolean
                  AND public.depoimento_minha_situacao()->>'motivo' = 'conta_nova', 'C2 (conta de 3 dias): sem convite');
SELECT pg_temp.ok((public.depoimento_minha_situacao()->>'pode_enviar')::boolean, 'C2: pelo link pode enviar mesmo sem convite');
SELECT pg_temp.as_user(:'c3');
SELECT pg_temp.ok(public.depoimento_minha_situacao()->>'motivo' = 'sem_uso', 'C3 (30 dias, so visualizou): sem convite');
SELECT pg_temp.as_user(:'plat');
SELECT pg_temp.ok(NOT (public.depoimento_minha_situacao()->>'pode_enviar')::boolean, 'dono da plataforma: nao envia');
SELECT pg_temp.as_user(:'c1', :'sid_imp');
SELECT pg_temp.ok(public.depoimento_minha_situacao()->>'motivo' = 'sessao_restrita', '"Entrar como" C1: sem convite');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.depoimento_enviar(5, 'Mudou muito meu trabalho', NULL, NULL, NULL, true, 'v1-2026-11-02')$q$) LIKE '42501%', '"Entrar como": nao envia em nome da pessoa');

-- 2) Agora não / Não quero -------------------------------------------------------------------------
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok((public.depoimento_minha_situacao()->>'convite')::boolean, 'gestor elegivel');
SELECT public.depoimento_responder_convite('agora_nao');
SELECT pg_temp.ok(public.depoimento_minha_situacao()->>'motivo' = 'adiado', '"Agora nao": some por 30 dias');
RESET ROLE;
UPDATE public.depoimento_convites SET adiado_ate = now() - interval '1 minute' WHERE user_id = :'gestor';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok((public.depoimento_minha_situacao()->>'convite')::boolean, 'passados os 30 dias: volta a perguntar');
SELECT public.depoimento_responder_convite('nao_quero');
SELECT pg_temp.ok(public.depoimento_minha_situacao()->>'motivo' = 'recusou', '"Nao quero": nao pergunta mais');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.depoimento_responder_convite('talvez')$q$) LIKE '22023%', 'resposta invalida recusada');

-- 3) Nota baixa = feedback interno -----------------------------------------------------------------
SELECT pg_temp.as_user(:'cb');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.depoimento_enviar(2, NULL, NULL, NULL, '', false, NULL)$q$) LIKE '22023%', 'nota 2 sem dizer o que melhorar: recusa');
INSERT INTO ids SELECT 'cb_baixa', (public.depoimento_enviar(3, 'Texto que nao deve ir', NULL, 'Frase', 'Melhorar a busca de vendas', true, 'v1-2026-11-02')->>'id')::uuid;
SELECT pg_temp.ok(public.depoimento_minha_situacao()->'meus'->0->>'status' = 'interno', 'nota 3 COM autorizacao marcada: vira interno mesmo assim');
SELECT pg_temp.ok(public.depoimento_minha_situacao()->'meus'->0->>'mudou' IS NULL, 'nota 3: respostas de depoimento descartadas');
SELECT pg_temp.ok(NOT (public.depoimento_minha_situacao()->'meus'->0->>'consentimento')::boolean, 'nota 3: consentimento nao gravado');

-- 4) Nota alta sem autorização = interno; com autorização = pendente ---------------------------------
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.depoimento_enviar(5, 'curto', NULL, NULL, NULL, true, 'v1-2026-11-02')$q$) LIKE '22023%', 'nota 5 com "o que mudou" curto demais: recusa');
INSERT INTO ids SELECT 'c2_sem_aut', (public.depoimento_enviar(5, 'Organizou todas as minhas vendas', NULL, 'Recomendo', NULL, false, NULL, 'link')->>'id')::uuid;
SELECT pg_temp.ok(public.depoimento_minha_situacao()->'meus'->0->>'status' = 'interno', 'nota 5 SEM autorizacao: interno');
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.depoimento_enviar(5, 'Organizou todas as minhas vendas', NULL, NULL, NULL, true, 'v0-velha')$q$) LIKE '22023%', 'versao do termo diferente da vigente: recusa');
INSERT INTO ids SELECT 'c1', (public.depoimento_enviar(5, 'Hoje acompanho todas as vendas num lugar so', 'Subir documentos', 'Facil e rapido, recomendo', NULL, true, 'v1-2026-11-02')->>'id')::uuid;
SELECT pg_temp.ok(public.depoimento_minha_situacao()->'meus'->0->>'status' = 'pendente', 'C1 nota 5 + autorizacao: pendente');
SELECT pg_temp.ok(public.depoimento_minha_situacao()->>'motivo' = 'ja_enviou', 'depois de enviar: convite nao volta');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.depoimento_enviar(4, 'Outro depoimento qualquer aqui', NULL, NULL, NULL, true, 'v1-2026-11-02')$q$) LIKE '23505%', 'segundo depoimento ativo: recusa');

-- 5) Acesso direto às tabelas e lista de moderação ---------------------------------------------------
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.depoimentos') LIKE '42501%', 'corretor: SELECT direto recusado');
SELECT pg_temp.ok(pg_temp.err($q$UPDATE public.depoimentos SET status = 'aprovado'$q$) LIKE '42501%', 'corretor: UPDATE direto recusado (nao se autoaprova)');
SELECT pg_temp.ok(pg_temp.err('SELECT public.depoimento_moderacao_listar()') LIKE '42501%', 'corretor: nao ve a moderacao');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.depoimento_moderar((SELECT id FROM ids WHERE nome='c1'), 'aprovar')$q$) LIKE '42501%', 'corretor: nao aprova o proprio');
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(pg_temp.err('SELECT public.depoimento_moderacao_listar()') LIKE '42501%', 'gestor: nao modera');
SELECT pg_temp.ok(jsonb_array_length(public.depoimento_minha_situacao()->'meus') = 0, 'gestor nao ve depoimento de outro');
SELECT pg_temp.ok((SELECT count(*) FROM public.depoimentos_publicos()) = 0, 'vitrine vazia antes da aprovacao');

-- 6) Moderação --------------------------------------------------------------------------------------
SELECT pg_temp.as_user(:'plat');
SELECT pg_temp.ok(public.depoimento_eh_moderador(), 'dono da plataforma e moderador');
SELECT pg_temp.ok(jsonb_array_length(public.depoimento_moderacao_listar()) = 3, 'moderacao lista os 3 (interno incluso)');
SELECT pg_temp.ok(public.depoimento_moderacao_listar()->0->>'status' = 'pendente', 'pendente aparece primeiro');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.depoimento_moderar((SELECT id FROM ids WHERE nome='cb_baixa'), 'aprovar')$q$) LIKE '22023%', 'feedback interno (nota 3): nao pode ser aprovado');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.depoimento_moderar((SELECT id FROM ids WHERE nome='c2_sem_aut'), 'aprovar')$q$) LIKE '22023%', 'sem autorizacao: nao pode ser aprovado');
SELECT public.depoimento_moderar((SELECT id FROM ids WHERE nome='c1'), 'aprovar');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.ok((SELECT count(*) FROM public.depoimentos_publicos()) = 1, 'anon: vitrine mostra o aprovado');
SELECT pg_temp.ok((SELECT nome FROM public.depoimentos_publicos()) = 'Maria S.', 'vitrine: nome abreviado');
SELECT pg_temp.ok((SELECT frase FROM public.depoimentos_publicos()) = 'Facil e rapido, recomendo', 'vitrine: frase de destaque');
SELECT pg_temp.ok((SELECT imobiliaria || '|' || cidade || '|' || papel || '|' || nota FROM public.depoimentos_publicos()) = 'RE/MAX Exemplo A|Sorocaba|Corretor(a)|5', 'vitrine: imobiliaria, cidade, papel, nota');
-- Nada de dado pessoal fora da lista: colunas exatas e nenhum valor sensível no JSON da linha.
SELECT pg_temp.ok((SELECT string_agg(k, ',' ORDER BY k) FROM public.depoimentos_publicos() p, jsonb_object_keys(to_jsonb(p)) k)
                  = 'cidade,foto_url,frase,imobiliaria,nome,nota,papel,publicado_em,tarefa,texto', 'vitrine: so as colunas permitidas');
SELECT pg_temp.ok((SELECT to_jsonb(p)::text FROM public.depoimentos_publicos() p) !~* '(maria@|15991234567|529\.982|630000013|aparecida|a0000000)', 'vitrine: sem e-mail, telefone, CPF, ID RE/MAX, nome completo ou id');
SELECT pg_temp.ok(pg_temp.err('SELECT count(*) FROM public.depoimentos') LIKE '42501%', 'anon: tabela direta recusada');
SELECT pg_temp.ok(pg_temp.err('SELECT public.depoimento_minha_situacao()') LIKE '42501%', 'anon: sem execute nas RPCs internas');
SELECT pg_temp.ok(pg_temp.err('SELECT public.depoimento_moderacao_listar()') LIKE '42501%', 'anon: sem moderacao');
RESET ROLE;
SET LOCAL ROLE authenticated;

-- 7) Correção de digitação (original preservado + registro) -----------------------------------------
SELECT pg_temp.as_user(:'plat');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.depoimento_corrigir((SELECT id FROM ids WHERE nome='c1'), 'Texto completamente diferente e muito maior do que o original escrito pela pessoa', NULL, NULL)$q$) LIKE '22023%', 'reescrever o texto: recusa (so digitacao)');
SELECT public.depoimento_corrigir((SELECT id FROM ids WHERE nome='c1'), NULL, NULL, 'Fácil e rápido, recomendo');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.ok((SELECT frase FROM public.depoimentos_publicos()) = 'Fácil e rápido, recomendo', 'vitrine usa a frase corrigida');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'plat');
SELECT pg_temp.ok((SELECT d->>'frase' FROM jsonb_array_elements(public.depoimento_moderacao_listar()) d WHERE d->>'id' = (SELECT id::text FROM ids WHERE nome='c1')) = 'Facil e rapido, recomendo', 'original do autor intacto');
SELECT pg_temp.ok((SELECT d->>'corrigido_em' FROM jsonb_array_elements(public.depoimento_moderacao_listar()) d WHERE d->>'id' = (SELECT id::text FROM ids WHERE nome='c1')) IS NOT NULL, 'registro de que houve ajuste');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.depoimento_eventos WHERE acao = 'corrigido') = 1, 'evento "corrigido" gravado');
SET LOCAL ROLE authenticated;

-- 8) Remover / recusar refletem na vitrine; retirada pelo autor ------------------------------------
SELECT pg_temp.as_user(:'plat');
SELECT public.depoimento_moderar((SELECT id FROM ids WHERE nome='c1'), 'remover', 'teste');
SELECT pg_temp.ok((SELECT count(*) FROM public.depoimentos_publicos()) = 0, 'remover: sai da vitrine');
SELECT public.depoimento_moderar((SELECT id FROM ids WHERE nome='c1'), 'aprovar');
SELECT pg_temp.ok((SELECT count(*) FROM public.depoimentos_publicos()) = 1, 'reaprovar: volta');
SELECT public.depoimento_moderar((SELECT id FROM ids WHERE nome='c1'), 'recusar');
SELECT pg_temp.ok((SELECT count(*) FROM public.depoimentos_publicos()) = 0, 'recusar: sai da vitrine');
SELECT public.depoimento_moderar((SELECT id FROM ids WHERE nome='c1'), 'aprovar');
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.depoimento_retirar((SELECT id FROM ids WHERE nome='c1'))$q$) LIKE 'P0002%', 'C2 nao retira o depoimento da C1');
SELECT pg_temp.as_user(:'c1', :'sid_imp');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.depoimento_retirar((SELECT id FROM ids WHERE nome='c1'))$q$) LIKE '42501%', '"Entrar como": nao retira em nome da pessoa');
SELECT pg_temp.as_user(:'c1');
SELECT public.depoimento_retirar((SELECT id FROM ids WHERE nome='c1'));
SELECT pg_temp.ok((SELECT count(*) FROM public.depoimentos_publicos()) = 0, 'autor retirou: sai da vitrine na hora');
SELECT pg_temp.ok(public.depoimento_minha_situacao()->'meus'->0->>'status' = 'removido', 'retirado = removido');
SELECT pg_temp.as_user(:'plat');
SELECT pg_temp.ok(pg_temp.err($q$SELECT public.depoimento_moderar((SELECT id FROM ids WHERE nome='c1'), 'aprovar')$q$) LIKE '22023%', 'retirado pelo autor: moderador nao reaprova');
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok((public.depoimento_enviar(4, 'Depois de retirar posso mandar outro', NULL, NULL, NULL, true, 'v1-2026-11-02')->>'status') = 'pendente', 'depois de retirar: pode enviar um novo');

-- 9) Constraint de segurança: nem o banco aceita aprovar nota baixa ---------------------------------
RESET ROLE;
SELECT pg_temp.ok(pg_temp.err($q$UPDATE public.depoimentos SET status = 'aprovado', aprovado_em = now() WHERE id = (SELECT id FROM ids WHERE nome='cb_baixa')$q$) LIKE '23514%', 'constraint: nota 3 nunca aprovada (nem pelo dono do banco)');
SELECT pg_temp.ok(pg_temp.err($q$UPDATE public.depoimentos SET status = 'pendente' WHERE id = (SELECT id FROM ids WHERE nome='c2_sem_aut')$q$) LIKE '23514%', 'constraint: sem consentimento nunca vira pendente/aprovado');
SELECT pg_temp.ok(public.depoimento_nome_abreviado('ana') = 'Ana' AND public.depoimento_nome_abreviado('') = 'Usuário ADM MAX'
                  AND public.depoimento_nome_abreviado('JOSE DOS SANTOS') = 'Jose S.', 'nome abreviado: casos de borda');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.depoimento_enviar(integer, text, text, text, text, boolean, text, text)', 'execute')
                  AND NOT has_function_privilege('anon', 'public.depoimento_moderar(uuid, text, text)', 'execute')
                  AND has_function_privilege('anon', 'public.depoimentos_publicos()', 'execute'), 'anon: so a vitrine e executavel');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.depoimento_tem_uso_real(uuid)', 'execute')
                  AND NOT has_function_privilege('authenticated', 'public.depoimento_papel(uuid, uuid)', 'execute'), 'helpers internos fechados');

DELETE FROM r WHERE msg = 'noop';
SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
