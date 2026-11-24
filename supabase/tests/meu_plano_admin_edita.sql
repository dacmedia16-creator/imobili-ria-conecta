-- Suíte "administrador abre e edita o plano de outra pessoa" (migration 20270101120000, t_c9b0f633).
-- Transação revertida, homologação ou banco descartável; nunca produção. Dados fictícios.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true),
         set_config('app.meu_plano_admin_alvo', '', true) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

\set org_a 'a4000000-0000-4000-8000-0000000000a0'
\set org_b 'b4000000-0000-4000-8000-0000000000b0'
\set admin 'a4000000-0000-4000-8000-000000000001'
\set gestor 'a4000000-0000-4000-8000-000000000002'
\set tl 'a4000000-0000-4000-8000-000000000003'
\set c1 'a4000000-0000-4000-8000-000000000005'
\set c2 'a4000000-0000-4000-8000-000000000006'
\set c3 'a4000000-0000-4000-8000-000000000007'
\set c4 'a4000000-0000-4000-8000-000000000009'
\set c5 'a4000000-0000-4000-8000-00000000000a'
\set ab 'b4000000-0000-4000-8000-000000000001'
\set cb 'b4000000-0000-4000-8000-000000000003'
\set eq1 'a4000000-0000-4000-8000-00000000e001'
\set eq2 'a4000000-0000-4000-8000-00000000e002'

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status) VALUES
  (:'org_a', 'teste-admin-edita-a', 'Imobiliaria Admin Edita A', 'ativa'),
  (:'org_b', 'teste-admin-edita-b', 'Imobiliaria Admin Edita B', 'ativa');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'gestor', :'tl', :'c1', :'c2', :'c3', :'c4', :'c5', :'ab', :'cb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'admin', 'Dona Edita', 'dona@edita.test', true, :'org_a'),
  (:'gestor', 'Gil Gestor', 'gestor@edita.test', true, :'org_a'),
  (:'tl', 'Lia Lider', 'tl@edita.test', true, :'org_a'),
  (:'c1', 'Ana Assinada', 'c1@edita.test', true, :'org_a'),
  (:'c2', 'Bia Preenchendo', 'c2@edita.test', true, :'org_a'),
  (:'c3', 'Caio Sem Plano', 'c3@edita.test', true, :'org_a'),
  (:'c4', 'Duda Saiu', 'c4@edita.test', true, :'org_a'),
  (:'c5', 'Edu Valor Alto', 'c5@edita.test', true, :'org_a'),
  (:'ab', 'Admin B', 'ab@edita.test', true, :'org_b'),
  (:'cb', 'Corretor B', 'cb@edita.test', true, :'org_b');
INSERT INTO public.organization_members (organization_id, user_id, ativo)
  SELECT :'org_a'::uuid, unnest(ARRAY[:'admin', :'gestor', :'tl', :'c1', :'c2', :'c3', :'c5']::uuid[]), true
  UNION ALL SELECT :'org_a'::uuid, :'c4'::uuid, false
  UNION ALL SELECT :'org_b'::uuid, unnest(ARRAY[:'ab', :'cb']::uuid[]), true;
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'gestor', 'gestor', :'org_a'), (:'tl', 'team_leader', :'org_a'),
  (:'c1', 'corretor', :'org_a'), (:'c2', 'corretor', :'org_a'), (:'c3', 'corretor', :'org_a'),
  (:'c4', 'corretor', :'org_a'), (:'c5', 'corretor', :'org_a'),
  (:'ab', 'admin', :'org_b'), (:'cb', 'corretor', :'org_b');
-- Equipe 1 (líder Lia, gestor Gil como co-líder pela equipe-mãe não é usado: Gil lidera a equipe 2).
INSERT INTO public.teams (id, nome, organization_id, lider_id) VALUES
  (:'eq1', 'Equipe Edita 1', :'org_a', :'tl'), (:'eq2', 'Equipe Edita 2', :'org_a', :'gestor');
INSERT INTO public.team_members (team_id, membro_id, organization_id) VALUES
  (:'eq1', :'c1', :'org_a'), (:'eq1', :'tl', :'org_a'), (:'eq2', :'c2', :'org_a');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'meu_plano_2027', true), (:'org_b', 'meu_plano_2027', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
-- c1 assinado há 2 dias com meta oficial; c2 em preenchimento; cb assinado em outra imobiliária; admin com plano.
INSERT INTO public.carreira_plano (organization_id, user_id, ano, trilha, respostas, assinado_corretor_em,
                                   meta_oficial, meta_oficial_em) VALUES
  (:'org_a', :'c1', 2027, NULL, '{"mt.tCapt":"12","mt.tVenda":"10","mt.comMedia":"15000","pq.frase":"da Ana","ac.0.0":"5"}',
   now() - interval '2 days', '{"meta_comissao":330000,"meta_vendas":22}', now() - interval '2 days' + interval '1 second'),
  (:'org_a', :'c2', 2027, NULL, '{"mt.tCapt":"8","mt.tVenda":"6","mt.comMedia":"12000","pq.frase":"da Bia"}', NULL, NULL, NULL),
  (:'org_a', :'admin', 2027, NULL, '{"pq.frase":"da Dona"}', NULL, NULL, NULL),
  (:'org_a', :'c4', 2027, NULL, '{"pq.frase":"da Duda"}', NULL, NULL, NULL),
  -- c5: plano que JÁ estava com valor a conferir (600 transações de captação).
  (:'org_a', :'c5', 2027, NULL, '{"mt.tCapt":"600","mt.tVenda":"10","mt.comMedia":"15000"}', NULL, NULL, NULL),
  (:'org_b', :'cb', 2027, NULL, '{"mt.tCapt":"5","pq.frase":"de B"}', now() - interval '1 day', NULL, NULL);
INSERT INTO public.minhas_metas (organization_id, user_id, periodo, inicio, meta_comissao, meta_vendas) VALUES
  (:'org_a', :'c1', 'ano', '2027-01-01', 330000, 22);
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE antes AS SELECT user_id, md5(to_jsonb(p)::text) AS h, assinado_corretor_em
  FROM public.carreira_plano p WHERE organization_id IN (:'org_a', :'org_b');
GRANT SELECT ON antes TO authenticated;

SET LOCAL ROLE authenticated;
\set asalvar 'SELECT public.carreira_plano_admin_salvar(%L::uuid, 2027, %L::jsonb)'

-- 1) Quem abre e em que modo ----------------------------------------------------------------------------------
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(public.carreira_plano_acesso(:'c1')->>'modo' = 'editar', 'admin da imobiliaria: modo editar');
SELECT pg_temp.ok(public.carreira_plano_acesso(:'c1')->>'nome' = 'Ana Assinada', 'acesso devolve o nome da pessoa');
SELECT pg_temp.ok(public.carreira_plano_acesso(:'admin')->>'modo' = 'proprio', 'o proprio plano: modo proprio');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano WHERE user_id = :'c1') = 1, 'admin le o plano de c1 (RLS)');
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(public.carreira_plano_acesso(:'c1')->>'modo' = 'ver', 'lider: plano da propria equipe so leitura');
SELECT pg_temp.ok(pg_temp.err(format($$SELECT public.carreira_plano_acesso(%L)$$, :'c2')) LIKE '42501%',
  'lider: plano de fora da equipe recusado');
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(public.carreira_plano_acesso(:'c2')->>'modo' = 'ver', 'gestor: plano da propria equipe so leitura');
SELECT pg_temp.ok(pg_temp.err(format($$SELECT public.carreira_plano_acesso(%L)$$, :'c1')) LIKE '42501%',
  'gestor: plano de fora da equipe recusado');
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(pg_temp.err(format($$SELECT public.carreira_plano_acesso(%L)$$, :'c1')) LIKE '42501%',
  'NEGATIVO corretor comum: abrir o plano de outro recusado (42501)');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano WHERE user_id = :'c1') = 0,
  'NEGATIVO corretor comum: a tabela nao devolve o plano de outro (RLS)');
SELECT pg_temp.as_user(:'ab');
SELECT pg_temp.ok(pg_temp.err(format($$SELECT public.carreira_plano_acesso(%L)$$, :'c1')) LIKE '42501%',
  'NEGATIVO admin de OUTRA imobiliaria: abrir recusado (42501)');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano WHERE user_id = :'c1') = 0,
  'NEGATIVO admin de outra imobiliaria: a tabela nao devolve o plano (RLS)');

-- 2) Salvar: só o administrador -----------------------------------------------------------------------------------
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(pg_temp.err(format(:'asalvar', :'c1', '{"mt.tCapt":"11"}')) LIKE '42501%',
  'NEGATIVO corretor comum: salvar plano de outro recusado');
SELECT pg_temp.ok(pg_temp.err(format($$SELECT public.carreira_plano_admin_usar_meta(%L, 2027, 1000, NULL, 1, 1, true)$$, :'c1')) LIKE '42501%',
  'NEGATIVO corretor comum: gravar meta de outro recusado');
SELECT pg_temp.as_user(:'ab');
SELECT pg_temp.ok(pg_temp.err(format(:'asalvar', :'c1', '{"mt.tCapt":"11"}')) LIKE '42501%',
  'NEGATIVO admin de outra imobiliaria: salvar recusado');
SELECT pg_temp.ok(pg_temp.err(format($$SELECT public.carreira_plano_admin_usar_meta(%L, 2027, 1000, NULL, 1, 1, true)$$, :'c1')) LIKE '42501%',
  'NEGATIVO admin de outra imobiliaria: gravar meta recusado');
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(pg_temp.err(format(:'asalvar', :'c2', '{"mt.tCapt":"9"}')) LIKE '42501%',
  'gestor (mesmo da equipe) NAO edita');
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(pg_temp.err(format(:'asalvar', :'c1', '{"mt.tCapt":"9"}')) LIKE '42501%',
  'lider (mesmo da equipe) NAO edita');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.err(format(:'asalvar', :'admin', '{"pq.frase":"x"}')) LIKE '42501%',
  'admin nao usa a edicao de admin no proprio plano');
SELECT pg_temp.ok(pg_temp.err(format(:'asalvar', :'cb', '{"pq.frase":"x"}')) LIKE '42501%',
  'admin nao edita pessoa de outra imobiliaria passando o id');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM antes a JOIN public.carreira_plano p USING (user_id)
                    WHERE a.h <> md5(to_jsonb(p)::text)) = 0, 'nenhuma tentativa recusada mudou plano algum');
SET LOCAL ROLE authenticated;

-- 3) Administrador edita plano ASSINADO: continua assinado + histórico antes/depois ----------------------------
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(public.carreira_plano_admin_salvar(:'c1', 2027, '{"mt.tCapt":"11","pq.frase":"da Ana (corrigido)","mt.tVenda":"10"}') IS NOT NULL,
  'admin edita o plano assinado de c1');
RESET ROLE;
SELECT pg_temp.ok((SELECT p.respostas->>'mt.tCapt' = '11' AND p.respostas->>'pq.frase' = 'da Ana (corrigido)'
                          AND p.respostas->>'ac.0.0' = '5'
                     FROM public.carreira_plano p WHERE user_id = :'c1'), 'valores gravados e o resto ficou');
SELECT pg_temp.ok((SELECT p.assinado_corretor_em = a.assinado_corretor_em FROM public.carreira_plano p JOIN antes a USING (user_id)
                    WHERE user_id = :'c1'), 'plano CONTINUA assinado (mesma data)');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.activity_logs WHERE acao = 'meu_plano_editado_admin'
                    AND organization_id = :'org_a' AND autor_id = :'admin' AND payload->>'corretor_id' = :'c1'
                    AND payload->'campos'->'mt.tCapt'->>'antes' = '12' AND payload->'campos'->'mt.tCapt'->>'depois' = '11'
                    AND payload->'campos' ? 'pq.frase' AND NOT payload->'campos' ? 'mt.tVenda'
                    AND (payload->>'assinado')::bool AND payload->>'ator_id' = :'admin'
                    AND payload->>'ator_plataforma' = 'false' AND created_at IS NOT NULL),
  'historico: quem, quando, campo antes/depois (so o que mudou)');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(public.carreira_plano_admin_salvar(:'c1', 2027, '{"mt.tCapt":"11"}') IS NOT NULL, 'regravar o mesmo valor nao da erro');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.activity_logs WHERE acao = 'meu_plano_editado_admin' AND payload->>'corretor_id' = :'c1') = 1,
  'sem mudanca: nenhum historico novo');
SET LOCAL ROLE authenticated;

-- 4) Mesmas travas de valor (inteiros, limite 500, R$ 5 mi) ------------------------------------------------------
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.err(format(:'asalvar', :'c2', '{"mt.tCapt":"600"}')) LIKE '22023%máximo de 500%', 'trava: acima de 500 recusado');
SELECT pg_temp.ok(pg_temp.err(format(:'asalvar', :'c2', '{"mt.tCapt":"8,5"}')) LIKE '22023%inteiro%', 'trava: nao inteiro recusado');
SELECT pg_temp.ok(pg_temp.err(format(:'asalvar', :'c2', '{"mt.comMedia":"900000"}')) LIKE '22023%5 milhões%', 'trava: comissao acima de R$ 5 mi recusada');
SELECT pg_temp.ok(pg_temp.err(format(:'asalvar', :'c2', '{"Campo Ruim":"1"}')) LIKE '22023%Campo inválido%', 'campo com nome invalido recusado');
SELECT pg_temp.ok(pg_temp.err(format($$SELECT public.carreira_plano_admin_usar_meta(%L, 2027, 6000000, NULL, 10, 10, true)$$, :'c2')) LIKE '22023%5 milhões%',
  'meta: comissao acima de R$ 5 mi recusada');
SELECT pg_temp.ok(pg_temp.err(format($$SELECT public.carreira_plano_admin_usar_meta(%L, 2027, 100000, NULL, 2000, 10, true)$$, :'c2')) LIKE '22023%1.000%',
  'meta: mais de 1.000 transacoes recusada');
SELECT pg_temp.ok((SELECT respostas->>'mt.tCapt' = '8' FROM public.carreira_plano WHERE user_id = :'c2'), 'c2 intacto apos recusas');
-- Plano que já tinha valor a conferir: aceita mexer em outra coisa e corrigir; NÃO aceita um problema novo.
SELECT pg_temp.ok(public.carreira_plano_admin_salvar(:'c5', 2027, '{"pq.frase":"corrigindo"}') IS NOT NULL,
  'plano ja a conferir: editar outro campo e aceito (mesmo motivo)');
SELECT pg_temp.ok(pg_temp.err(format(:'asalvar', :'c5', '{"mt.comMedia":"999999999"}')) LIKE '22023%',
  'plano ja a conferir: NAO aceita piorar (valor absurdo novo) — revisao t_c9b0f633');
SELECT pg_temp.ok(pg_temp.err(format($$SELECT public.carreira_plano_admin_usar_meta(%L, 2027, 100000, NULL, 10, 10, true)$$, :'c5')) LIKE '22023%fora do limite%',
  'plano ja a conferir: meta oficial recusada ate corrigir');
SELECT pg_temp.ok(pg_temp.err(format(:'asalvar', :'c5', '{"mt.tCapt":"650"}')) LIKE '22023%',
  'plano ja a conferir: NAO aceita subir o valor errado');
SELECT pg_temp.ok(public.carreira_plano_admin_salvar(:'c5', 2027, '{"mt.tCapt":"12"}') IS NOT NULL,
  'plano ja a conferir: admin corrige o valor');
-- Dois problemas (transações em reais + comissão média absurda): corrige um de cada vez, na ordem que quiser.
RESET ROLE;
UPDATE public.carreira_plano SET respostas = respostas || '{"mt.tCapt":"600","mt.comMedia":"999999"}' WHERE user_id = :'c5';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(public.carreira_plano_admin_salvar(:'c5', 2027, '{"mt.tCapt":"12"}') IS NOT NULL,
  '2 problemas: corrigir as transacoes primeiro e aceito (o outro continua a conferir)');
SELECT pg_temp.ok(public.carreira_plano_admin_salvar(:'c5', 2027, '{"mt.comMedia":"15000"}') IS NOT NULL,
  '2 problemas: depois corrige a comissao media');
RESET ROLE;
SELECT pg_temp.ok(public.carreira_plano_trava((SELECT respostas FROM public.carreira_plano WHERE user_id = :'c5')) IS NULL,
  '2 problemas: plano limpo no fim');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok(pg_temp.err(format(:'asalvar', :'c5', '{"mt.tCapt":"700"}')) LIKE '22023%máximo de 500%',
  'depois de corrigido: volta a recusar valor fora do limite');
-- Quem saiu da imobiliária (membro inativo): nem abre nem edita.
SELECT pg_temp.ok(pg_temp.err(format($$SELECT public.carreira_plano_acesso(%L)$$, :'c4')) LIKE '42501%',
  'pessoa que saiu (membro inativo): admin nao abre para editar');
SELECT pg_temp.ok(pg_temp.err(format(:'asalvar', :'c4', '{"pq.frase":"x"}')) LIKE '42501%',
  'pessoa que saiu (membro inativo): admin nao edita');

-- 5) Meta oficial pelo administrador (mesma regra do usar_meta) ---------------------------------------------------
SELECT pg_temp.ok((public.carreira_plano_admin_usar_meta(:'c1', 2027, 300000, NULL, 21, 12, false))->>'status' = 'existe',
  'meta: sem substituir so informa');
SELECT pg_temp.ok((public.carreira_plano_admin_usar_meta(:'c1', 2027, 315000, NULL, 21, 12, true))->>'status' = 'gravada',
  'meta: admin regrava a meta do plano assinado');
RESET ROLE;
SELECT pg_temp.ok((SELECT (meta_oficial->>'meta_comissao')::numeric = 315000 AND assinado_corretor_em IS NOT NULL
                     FROM public.carreira_plano WHERE user_id = :'c1'), 'meta oficial nova e plano assinado');
SELECT pg_temp.ok((SELECT meta_comissao = 315000 AND meta_vendas = 21 FROM public.minhas_metas WHERE user_id = :'c1' AND periodo = 'ano'),
  'minhas_metas segue a meta oficial');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.activity_logs WHERE acao = 'meu_plano_meta_admin' AND payload->>'corretor_id' = :'c1'
                    AND (payload->'meta_oficial_antes'->>'meta_comissao')::numeric = 330000
                    AND (payload->'minhas_metas_antes'->>'meta_comissao')::numeric = 330000
                    AND (payload->'meta_oficial_depois'->>'meta_comissao')::numeric = 315000),
  'historico da meta: antes e depois');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok((public.carreira_plano_admin_usar_meta(:'c2', 2027, 192000, NULL, 14, 8, true))->>'status' = 'gravada',
  'meta: plano em preenchimento tambem grava');
SELECT pg_temp.ok(pg_temp.err(format($$SELECT public.carreira_plano_admin_usar_meta(%L, 2027, 1000, NULL, 1, 1, true)$$, :'c3')) LIKE 'P0002%',
  'meta: pessoa sem plano recusada (nada a calcular)');
SELECT pg_temp.ok(public.carreira_plano_admin_salvar(:'c3', 2027, '{"pq.frase":"comecado pelo admin"}') IS NOT NULL,
  'admin comeca o plano de quem nao tinha');
RESET ROLE;
SELECT pg_temp.ok((SELECT organization_id = :'org_a' AND assinado_corretor_em IS NULL FROM public.carreira_plano WHERE user_id = :'c3'),
  'plano novo na imobiliaria certa e sem assinatura');
SELECT pg_temp.ok((SELECT assinado_corretor_em IS NULL FROM public.carreira_plano WHERE user_id = :'c2'),
  'admin NAO assina pela pessoa (c2 continua sem assinatura)');
SET LOCAL ROLE authenticated;

-- 6) Ninguém burla a exceção do gatilho ---------------------------------------------------------------------------
SELECT pg_temp.as_user(:'c1');
SELECT set_config('app.meu_plano_admin_alvo', :'c1', true);
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_salvar(2027, '{"mt.tCapt":"99"}'::jsonb)$$) LIKE 'PT409%',
  'NEGATIVO corretor com o marcador forjado: o proprio plano assinado continua travado');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_usar_meta(2027, 999000, NULL, 40, 30, true)$$) LIKE 'PT409%',
  'NEGATIVO corretor com o marcador forjado: meta continua travada');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_admin_log('a4000000-0000-4000-8000-0000000000a0', 'x', '{}')$$) LIKE '42501%',
  'funcao de historico fechada para o app');
RESET ROLE;
SELECT set_config('app.meu_plano_admin_alvo', :'c1', true);
SELECT pg_temp.ok(pg_temp.err(format($$UPDATE public.carreira_plano SET respostas = respostas || '{"mt.tCapt":"77"}' WHERE user_id = %L$$, :'c1')) LIKE 'PT409%',
  'UPDATE direto (sem papel de admin) com marcador: continua travado');
SELECT set_config('app.meu_plano_admin_alvo', '', true);
SELECT pg_temp.ok(pg_temp.err(format($$UPDATE public.carreira_plano SET assinado_corretor_em = now() WHERE user_id = %L$$, :'c1')) LIKE 'PT409%',
  'data da assinatura nao pode ser trocada');
SELECT pg_temp.ok((SELECT respostas->>'mt.tCapt' = '11' FROM public.carreira_plano WHERE user_id = :'c1'), 'c1 com o valor do admin, nao o forjado');
SELECT pg_temp.ok((SELECT h FROM antes WHERE user_id = :'cb') = (SELECT md5(to_jsonb(p)::text) FROM public.carreira_plano p WHERE user_id = :'cb'),
  'plano da outra imobiliaria intacto');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
