-- Suíte "plano assinado só leitura" (migration 20261209140000, t_850a0d39). Transação revertida, homologação ou
-- banco descartável; nunca produção. Dados fictícios. Precisa de 20261209120000 (trava de valores) e
-- 20261209130000 (reabrir) aplicadas antes (o runner aplica).
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
-- Linhas afetadas por um UPDATE/DELETE direto (RLS que esconde a linha = 0, sem erro).
CREATE FUNCTION pg_temp.n(_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE c int; BEGIN EXECUTE _sql; GET DIAGNOSTICS c = ROW_COUNT; RETURN c;
EXCEPTION WHEN others THEN RETURN -1; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;

\set org_a 'a3000000-0000-4000-8000-0000000000a0'
\set org_b 'b3000000-0000-4000-8000-0000000000b0'
\set admin 'a3000000-0000-4000-8000-000000000001'
\set gestor 'a3000000-0000-4000-8000-000000000002'
\set c1 'a3000000-0000-4000-8000-000000000005'
\set c2 'a3000000-0000-4000-8000-000000000006'
\set c3 'a3000000-0000-4000-8000-000000000007'
\set c4 'a3000000-0000-4000-8000-000000000008'
\set cb 'b3000000-0000-4000-8000-000000000003'
\set msg '%Plano assinado. Para mudar, peça ao seu gestor para reabrir.%'

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status) VALUES
  (:'org_a', 'teste-trava-ass-a', 'Imobiliaria Trava A', 'ativa'),
  (:'org_b', 'teste-trava-ass-b', 'Imobiliaria Trava B', 'ativa');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'gestor', :'c1', :'c2', :'c3', :'c4', :'cb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'admin', 'Dona Trava', 'dona@trava.test', true, :'org_a'),
  (:'gestor', 'Gil Trava', 'gestor@trava.test', true, :'org_a'),
  (:'c1', 'Ana Assinada', 'c1@trava.test', true, :'org_a'),
  (:'c2', 'Bia Preenchendo', 'c2@trava.test', true, :'org_a'),
  (:'c3', 'Caio Reaberto', 'c3@trava.test', true, :'org_a'),
  (:'c4', 'Duda Antiga', 'c4@trava.test', true, :'org_a'),
  (:'cb', 'Corretor B', 'cb@trava.test', true, :'org_b');
INSERT INTO public.organization_members (organization_id, user_id, ativo)
  SELECT :'org_a'::uuid, unnest(ARRAY[:'admin', :'gestor', :'c1', :'c2', :'c3', :'c4']::uuid[]), true
  UNION ALL SELECT :'org_b'::uuid, :'cb'::uuid, true;
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'gestor', 'gestor', :'org_a'), (:'c1', 'corretor', :'org_a'),
  (:'c2', 'corretor', :'org_a'), (:'c3', 'corretor', :'org_a'), (:'c4', 'corretor', :'org_a'),
  (:'cb', 'corretor', :'org_b');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'meu_plano_2027', true), (:'org_b', 'meu_plano_2027', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
-- c1: assinado, meta gravada logo depois (caso comum). c3: assinado, será reaberto. c4: assinado há dias e SEM
-- meta (como 2 planos reais). c2: em preenchimento. cb: assinado em outra imobiliária.
INSERT INTO public.carreira_plano (organization_id, user_id, ano, trilha, respostas, assinado_corretor_em,
                                   meta_oficial, meta_oficial_em) VALUES
  (:'org_a', :'c1', 2027, 'planejamento',
   '{"mt.tCapt":"12","mt.tVenda":"10","mt.comMedia":"15.000,00","pq.frase":"da Ana","ms.lig":30,"ac.0.0":"5","ui.ult":"p32"}',
   now() - interval '2 days', '{"meta_comissao":330000,"meta_vendas":22}', now() - interval '2 days' + interval '1 second'),
  (:'org_a', :'c2', 2027, NULL, '{"mt.tCapt":"8","mt.tVenda":"6","mt.comMedia":"12000","pq.frase":"da Bia"}', NULL, NULL, NULL),
  (:'org_a', :'c3', 2027, NULL, '{"mt.tCapt":"9","mt.tVenda":"9","mt.comMedia":"10000","pq.frase":"do Caio"}',
   now() - interval '1 day', '{"meta_comissao":180000,"meta_vendas":18}', now() - interval '1 day' + interval '1 second'),
  (:'org_a', :'c4', 2027, NULL, '{"mt.tCapt":"5","mt.tVenda":"5","mt.comMedia":"10000"}', now() - interval '3 days', NULL, NULL),
  (:'org_b', :'cb', 2027, NULL, '{"mt.tCapt":"5","pq.frase":"de B"}', now() - interval '1 day', NULL, NULL);
INSERT INTO public.minhas_metas (organization_id, user_id, periodo, inicio, meta_comissao, meta_vendas) VALUES
  (:'org_a', :'c1', 'ano', '2027-01-01', 330000, 22),
  (:'org_a', :'c3', 'ano', '2027-01-01', 180000, 18);
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE antes AS
  SELECT user_id, md5(public.carreira_plano_parte_travada(respostas)::text) AS trav, md5(coalesce(meta_oficial::text, '')) AS meta,
         meta_oficial_em, assinado_corretor_em, trilha, ativacao_inicio
    FROM public.carreira_plano WHERE organization_id IN (:'org_a', :'org_b');
CREATE TEMP TABLE metas_antes AS SELECT user_id, md5(to_jsonb(m)::text) AS h FROM public.minhas_metas m
  WHERE m.organization_id = :'org_a';
GRANT SELECT ON antes, metas_antes TO authenticated;

SET LOCAL ROLE authenticated;
\set salvar 'SELECT public.carreira_plano_salvar(2027, %L::jsonb)'

-- 1) Plano ASSINADO: campos de meta/cálculo recusados pela RPC -------------------------------------------------
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(pg_temp.err(format(:'salvar', '{"mt.tCapt":"99"}')) LIKE '55000' || :'msg', 'assinado: salvar meta (mt.tCapt) recusado com a mensagem clara');
SELECT pg_temp.ok(pg_temp.err(format(:'salvar', '{"m.ticket":"900000"}')) LIKE '55000%', 'assinado: salvar ticket (m.*) recusado');
SELECT pg_temp.ok(pg_temp.err(format(:'salvar', '{"fu.v2cre":"80"}')) LIKE '55000%', 'assinado: taxa do funil (fu.*) recusada');
SELECT pg_temp.ok(pg_temp.err(format(:'salvar', '{"mt.mes.com.3":"50000"}')) LIKE '55000%', 'assinado: distribuicao mes a mes (mt.mes.*) recusada');
SELECT pg_temp.ok(pg_temp.err(format(:'salvar', '{"ms.lig":31}')) LIKE '55000%', 'assinado: copia ms.* (salvamento automatico) recusada');
SELECT pg_temp.ok(pg_temp.err(format(:'salvar', '{"pq.frase":"outra"}')) LIKE '55000%', 'assinado: texto do plano (pq.*) recusado');
SELECT pg_temp.ok(pg_temp.err(format(:'salvar', '{"pa.c.0":"novo compromisso"}')) LIKE '55000%', 'assinado: compromisso do pacto recusado');
SELECT pg_temp.ok(pg_temp.err(format(:'salvar', '{"mt.tCapt":null}')) LIKE '55000%', 'assinado: APAGAR campo de meta recusado');
SELECT pg_temp.ok(pg_temp.err(format(:'salvar', '{"zz.novo":"x"}')) LIKE '55000%', 'assinado: prefixo novo/desconhecido nasce travado');
SELECT pg_temp.ok(pg_temp.err(format(:'salvar', '{"ac.1.1":"7","mt.tCapt":"99"}')) LIKE '55000%', 'assinado: lote misto (livre + travado) recusado inteiro');
SELECT pg_temp.ok((SELECT NOT (respostas ? 'ac.1.1') FROM public.carreira_plano WHERE user_id = :'c1'), 'lote misto recusado nao gravou nem a parte livre');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"mt.tCapt":"12"}') IS NOT NULL, 'assinado: regravar o MESMO valor nao da erro (nada muda)');

-- 2) Plano ASSINADO: acompanhamento e navegação seguem livres -----------------------------------------------------
SELECT pg_temp.ok(public.carreira_plano_salvar(2027,
  '{"ac.0.1":"3","ac.mes":"jan/2027","pm.1.comissao":"25000","pm.1.trans":"2","sem.0.0":true,"mc.c.0":true,"mc.dataCapt":"2027-01-10","ui.ult":"p44","ui.pag":"44"}') IS NOT NULL,
  'assinado: anotacoes ac/pm/sem/mc/ui gravam');
SELECT pg_temp.ok((SELECT respostas->>'pm.1.comissao' = '25000' AND respostas->>'ac.0.1' = '3' AND (respostas->>'sem.0.0')::bool
                     AND respostas->>'ui.ult' = 'p44' FROM public.carreira_plano WHERE user_id = :'c1'), 'anotacoes ficaram gravadas');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"ac.0.0":null,"pm.1.trans":null}') IS NOT NULL, 'assinado: apagar anotacao funciona');

-- 3) Outras RPCs que mudam o plano assinado ------------------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_trilha(2027, 'ativacao')$$) LIKE '55000%', 'assinado: trocar trilha recusado');
SELECT pg_temp.ok(public.carreira_plano_trilha(2027, 'planejamento') IS NULL, 'assinado: trilha igual nao da erro');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_usar_meta(2027, 999000, NULL, 40, 30, true)$$) LIKE '55000%',
  'assinado: regravar meta oficial (usar_meta substituir) recusado');
SELECT pg_temp.ok((public.carreira_plano_usar_meta(2027, 999000, NULL, 40, 30, false))->>'status' = 'existe',
  'assinado: usar_meta sem substituir so informa (nao grava)');
SELECT pg_temp.ok(public.carreira_plano_assinar(2027) IS NOT NULL, 'assinado: assinar de novo nao da erro e nao muda a data');

-- 4) Burlar pela tabela (sem RPC) -------------------------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.n(format($$UPDATE public.carreira_plano SET respostas = respostas || '{"mt.tCapt":"99"}' WHERE user_id = %L$$, :'c1')) = -1,
  'UPDATE direto em carreira_plano: sem permissao');
SELECT pg_temp.ok(pg_temp.n(format($$UPDATE public.minhas_metas SET meta_comissao = 1 WHERE user_id = %L AND periodo = 'ano'$$, :'c1')) = 0,
  'UPDATE direto da meta ANUAL 2027 com plano assinado: 0 linhas');
SELECT pg_temp.ok(pg_temp.n(format($$DELETE FROM public.minhas_metas WHERE user_id = %L AND periodo = 'ano'$$, :'c1')) = 0,
  'DELETE direto da meta ANUAL 2027 com plano assinado: 0 linhas');
SELECT pg_temp.ok((SELECT count(*) FROM public.minhas_metas WHERE user_id = :'c1' AND periodo = 'ano') = 1,
  'dono continua LENDO a propria meta anual');
SELECT pg_temp.ok(pg_temp.n(format($$INSERT INTO public.minhas_metas (organization_id, user_id, periodo, inicio, meta_comissao)
  VALUES (%L, %L, 'mes', '2027-02-01', 30000)$$, :'org_a', :'c1')) = 1, 'meta de MES continua livre (insert ok)');
SELECT pg_temp.ok(pg_temp.n(format($$INSERT INTO public.minhas_metas (organization_id, user_id, periodo, inicio, meta_comissao)
  VALUES (%L, %L, 'ano', '2028-01-01', 30000)$$, :'org_a', :'c1')) = 1, 'meta de OUTRO ano continua livre');
SELECT pg_temp.ok(public.carreira_plano_assinado(:'org_a', :'c3', 2027) = false, 'funcao auxiliar nao revela plano de outra pessoa');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.err(format($$UPDATE public.carreira_plano SET respostas = respostas || '{"mt.tCapt":"99"}' WHERE user_id = %L$$, :'c1')) LIKE '55000%',
  'nem o service/postgres muda o plano assinado direto (gatilho)');
SELECT pg_temp.ok(pg_temp.err(format($$UPDATE public.carreira_plano SET meta_oficial = '{"meta_comissao":1}' WHERE user_id = %L$$, :'c1')) LIKE '55000%',
  'nem o service/postgres muda a meta oficial do plano assinado');
SELECT pg_temp.ok(pg_temp.err(format($$UPDATE public.carreira_plano SET assinado_corretor_em = now() WHERE user_id = %L$$, :'c1')) LIKE '55000%',
  'data da assinatura nao pode ser trocada');
SET LOCAL ROLE authenticated;

-- 5) Plano assinado há dias SEM meta: a meta não é gravada fora da janela da assinatura --------------------------------
SELECT pg_temp.as_user(:'c4');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_usar_meta(2027, 100000, NULL, 10, 10, true)$$) LIKE '55000%',
  'assinado antigo sem meta: usar_meta recusado (so reabrindo)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.minhas_metas WHERE user_id = :'c4'), 'e nada foi para minhas_metas');

-- 6) Plano em PREENCHIMENTO: nada muda --------------------------------------------------------------------------
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"mt.tCapt":"10","fu.v2cre":"55","ms.lig":20,"pq.frase":"nova"}') IS NOT NULL,
  'preenchimento: salva campos de meta normalmente');
SELECT pg_temp.ok(public.carreira_plano_trilha(2027, 'ativacao') IS NOT NULL, 'preenchimento: troca trilha');
SELECT pg_temp.ok((public.carreira_plano_usar_meta(2027, 192000, NULL, 16, 20, true))->>'status' = 'gravada', 'preenchimento: usar_meta grava');
SELECT pg_temp.ok((public.carreira_plano_usar_meta(2027, 190000, NULL, 16, 20, true))->>'status' = 'gravada', 'preenchimento: usar_meta regrava');
SELECT pg_temp.ok(pg_temp.n(format($$UPDATE public.minhas_metas SET meta_vgv = 1 WHERE user_id = %L AND periodo = 'ano'$$, :'c2')) = 1,
  'preenchimento: meta anual direta continua editavel');
-- ... e assina: a gravação da meta logo depois da assinatura passa UMA vez, depois trava.
-- (Na transação de teste now() não anda: a meta do preenchimento volta 1 h, como seria numa chamada anterior.)
RESET ROLE;
UPDATE public.carreira_plano SET meta_oficial_em = meta_oficial_em - interval '1 hour' WHERE user_id = :'c2';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok(public.carreira_plano_assinar(2027) IS NOT NULL, 'c2 assina');
SELECT pg_temp.ok((public.carreira_plano_usar_meta(2027, 192000, NULL, 16, 20, true))->>'status' = 'gravada',
  'logo apos assinar: a meta oficial da assinatura grava');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_usar_meta(2027, 500000, NULL, 30, 20, true)$$) LIKE '55000%',
  'segunda gravacao de meta depois de assinar: recusada');
SELECT pg_temp.ok(pg_temp.err(format(:'salvar', '{"mt.tCapt":"11"}')) LIKE '55000%', 'c2 recem-assinado: campos travados');
SELECT pg_temp.ok((SELECT (meta_oficial->>'meta_comissao')::numeric = 192000 FROM public.carreira_plano WHERE user_id = :'c2'),
  'meta oficial de c2 = a da assinatura');

-- 7) Reaberto pelo botão: edita, assina de novo e trava de novo ----------------------------------------------------
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok((public.carreira_plano_reabrir(:'c3', 2027, 'Corrigir transações')->>'status') = 'reaberto', 'admin reabre c3');
SELECT pg_temp.as_user(:'c3');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"mt.tCapt":"10","mt.tVenda":"10"}') IS NOT NULL, 'reaberto: edita os campos de meta');
SELECT pg_temp.ok(public.carreira_plano_assinar(2027) IS NOT NULL, 'reaberto: assina de novo');
SELECT pg_temp.ok((public.carreira_plano_usar_meta(2027, 200000, NULL, 20, 20, true))->>'status' = 'gravada',
  'reassinado: meta nova da assinatura grava (minhas_metas + meta_oficial)');
SELECT pg_temp.ok((SELECT meta_comissao = 200000 FROM public.minhas_metas WHERE user_id = :'c3' AND periodo = 'ano'),
  'minhas_metas de c3 = meta da nova assinatura');
SELECT pg_temp.ok(pg_temp.err(format(:'salvar', '{"mt.tCapt":"11"}')) LIKE '55000%', 'reassinado: trava de novo');
SELECT pg_temp.ok(pg_temp.err($$SELECT public.carreira_plano_usar_meta(2027, 300000, NULL, 25, 20, true)$$) LIKE '55000%',
  'reassinado: meta trava de novo');

-- 8) Gestor/admin seguem iguais: assinar como broker e ver a equipe ------------------------------------------------
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(public.carreira_plano_assinar_broker(:'c1', 2027) IS NOT NULL, 'gestor assina como broker o plano travado');
SELECT pg_temp.ok((SELECT count(*) FROM public.carreira_plano_equipe(2027) WHERE assinado_corretor_em IS NOT NULL) = 4,
  'lista da equipe do gestor ve os 4 assinados (c1, c2, c3, c4)');
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok((public.carreira_plano_reabrir(:'c1', 2027, 'Reabrir com broker')->>'status') = 'reaberto',
  'reabrir plano que tem assinatura do broker funciona com a trava');
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(public.carreira_plano_salvar(2027, '{"mt.tCapt":"12"}') IS NOT NULL, 'c1 reaberto edita');

-- 9) Conferências como postgres ----------------------------------------------------------------------------------
RESET ROLE;
SELECT pg_temp.ok((SELECT a.trav = md5(public.carreira_plano_parte_travada(p.respostas)::text) AND a.meta = md5(coalesce(p.meta_oficial::text, ''))
                     AND p.meta_oficial_em = a.meta_oficial_em
                     FROM public.carreira_plano p JOIN antes a USING (user_id) WHERE p.user_id = :'c1'),
  'c1: parte travada e meta oficial IDENTICAS apos todas as tentativas');
SELECT pg_temp.ok((SELECT a.trav = md5(public.carreira_plano_parte_travada(p.respostas)::text) AND p.meta_oficial IS NULL
                     FROM public.carreira_plano p JOIN antes a USING (user_id) WHERE p.user_id = :'c4'), 'c4 intacto');
SELECT pg_temp.ok((SELECT h FROM metas_antes WHERE user_id = :'c1') =
                  (SELECT md5(to_jsonb(m)::text) FROM public.minhas_metas m WHERE user_id = :'c1' AND periodo = 'ano' AND inicio = '2027-01-01'),
  'minhas_metas 2027 de c1 intacta');
SELECT pg_temp.ok((SELECT a.trav = md5(public.carreira_plano_parte_travada(p.respostas)::text)
                     AND p.assinado_corretor_em = a.assinado_corretor_em
                     FROM public.carreira_plano p JOIN antes a USING (user_id) WHERE p.user_id = :'cb'), 'outra imobiliaria intacta');
SELECT pg_temp.ok(public.carreira_plano_parte_travada('{"ac.1":"x","pm.1.trans":"2","sem.0.0":true,"mc.c.1":true,"ui.ult":"p1","mt.tCapt":"3","ms.lig":1,"acx.0":"y"}')
                  = '{"mt.tCapt":"3","ms.lig":1,"acx.0":"y"}'::jsonb, 'lista exata: so ac/pm/sem/mc/ui ficam fora da parte travada');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' FALHAS=' || count(*) FILTER (WHERE NOT ok) FROM r;
