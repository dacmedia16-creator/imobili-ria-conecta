-- Ensaio 2f: regra final de Denis (28/09/2026) para excluir e cancelar venda.
--  * EXCLUIR: só 'rascunho'; só criador (sales.corretor_id), gestor/team_leader líder da equipe do
--    criador, admin e super_admin da agência. Nunca: participante que não criou, financeiro, jurídico,
--    lançamento que não criou, staff, outra agência.
--  * CANCELAR: só o dono da plataforma (platform_admins), em qualquer agência, depois do rascunho, pela
--    RPC platform_cancel_sale com motivo; auditoria gravada. Ninguém mais; ninguém em rascunho.
-- Tudo em transação + ROLLBACK; tentativas rodam em subtransação desfeita (nada persiste).
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA mt_2f_test;
CREATE TABLE mt_2f_test.results (n serial, label text, ok boolean);
GRANT USAGE ON SCHEMA mt_2f_test TO service_role, authenticated;
GRANT ALL ON mt_2f_test.results TO service_role, authenticated;
GRANT ALL ON SEQUENCE mt_2f_test.results_n_seq TO service_role, authenticated;
CREATE FUNCTION mt_2f_test.check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO mt_2f_test.results(label,ok) VALUES(label,coalesce(ok,false)) $$;
CREATE FUNCTION mt_2f_test.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true); END $$;
-- Executa SQL e DESFAZ: 'ok:<linhas>' / 'ok' ou 'erro:<SQLSTATE>'.
CREATE FUNCTION mt_2f_test.dry(q text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE n bigint; BEGIN
  BEGIN
   EXECUTE q; GET DIAGNOSTICS n = ROW_COUNT;
   RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = n::text;
  EXCEPTION WHEN SQLSTATE 'P0999' THEN RETURN 'ok:' || SQLERRM;
   WHEN OTHERS THEN RETURN 'erro:' || SQLSTATE; END;
 END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mt_2f_test TO service_role, authenticated;
CREATE FUNCTION mt_2f_test.run(u uuid, q text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE r text; BEGIN
  PERFORM mt_2f_test.as_user(u); r := mt_2f_test.dry(q); RESET ROLE;
  PERFORM set_config('request.jwt.claims','',true); RETURN r; END $$;
CREATE FUNCTION mt_2f_test.del(u uuid, sale uuid) RETURNS text LANGUAGE sql AS $$
 SELECT mt_2f_test.run(u, format('DELETE FROM public.sales WHERE id = %L', sale)) $$;
-- Cancelar pelos três caminhos possíveis: RPC da plataforma, RPC antiga e UPDATE direto.
CREATE FUNCTION mt_2f_test.cancel_platform(u uuid, sale uuid, motivo text DEFAULT 'teste 2f') RETURNS text LANGUAGE sql AS $$
 SELECT mt_2f_test.run(u, format('SELECT public.platform_cancel_sale(%L,%L)', sale, motivo)) $$;
CREATE FUNCTION mt_2f_test.cancel_old(u uuid, sale uuid) RETURNS text LANGUAGE sql AS $$
 SELECT mt_2f_test.run(u, format('SELECT public.change_sale_status(%L,%L,%L)', sale, 'cancelada', 'teste 2f')) $$;
CREATE FUNCTION mt_2f_test.cancel_update(u uuid, sale uuid) RETURNS text LANGUAGE sql AS $$
 SELECT mt_2f_test.run(u, format($q$UPDATE public.sales SET status='cancelada' WHERE id = %L$q$, sale)) $$;

-- ---------- Preparação (dados sintéticos) ----------
-- Agência A (histórica): P dono da plataforma (sem papel), gestor g (lidera equipe 1: c1 e lançamento
-- l), team_leader tl (lidera equipe 2: c2), financeiro f, jurídico j, staff s, admin ad, super_admin
-- da agência sa. Agência B: admin ab e corretor cb.
INSERT INTO public.organizations(id,slug,nome) VALUES
 ('2f000000-0000-4000-8000-0000000000b0','mt-2f-b','Agencia B 2f');
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('2f000000-0000-4000-8000-0000000000a0','p.2f@example.test','{"nome":"Plataforma 2f"}','{}'),
 ('2f000000-0000-4000-8000-0000000000a1','g.2f@example.test','{"nome":"A Gestor"}','{}'),
 ('2f000000-0000-4000-8000-0000000000a2','tl.2f@example.test','{"nome":"A Team Leader"}','{}'),
 ('2f000000-0000-4000-8000-0000000000a3','c1.2f@example.test','{"nome":"A Corretor 1"}','{}'),
 ('2f000000-0000-4000-8000-0000000000a4','c2.2f@example.test','{"nome":"A Corretor 2"}','{}'),
 ('2f000000-0000-4000-8000-0000000000a5','f.2f@example.test','{"nome":"A Financeiro"}','{}'),
 ('2f000000-0000-4000-8000-0000000000a6','s.2f@example.test','{"nome":"A Staff"}','{}'),
 ('2f000000-0000-4000-8000-0000000000a7','ad.2f@example.test','{"nome":"A Admin"}','{}'),
 ('2f000000-0000-4000-8000-0000000000a8','j.2f@example.test','{"nome":"A Juridico"}','{}'),
 ('2f000000-0000-4000-8000-0000000000a9','sa.2f@example.test','{"nome":"A Super Admin agencia"}','{}'),
 ('2f000000-0000-4000-8000-0000000000aa','l.2f@example.test','{"nome":"A Lancamento"}','{}'),
 ('2f000000-0000-4000-8000-0000000000ab','l2.2f@example.test','{"nome":"A Lancamento 2"}','{}'),
 ('2f000000-0000-4000-8000-0000000000b1','ab.2f@example.test','{"nome":"B Admin"}','{"organization_id":"2f000000-0000-4000-8000-0000000000b0"}'),
 ('2f000000-0000-4000-8000-0000000000b2','cb.2f@example.test','{"nome":"B Corretor"}','{"organization_id":"2f000000-0000-4000-8000-0000000000b0"}');
INSERT INTO public.platform_admins(user_id) VALUES ('2f000000-0000-4000-8000-0000000000a0');
INSERT INTO public.user_roles(user_id,role) VALUES
 ('2f000000-0000-4000-8000-0000000000a1','gestor'),
 ('2f000000-0000-4000-8000-0000000000a2','team_leader'),
 ('2f000000-0000-4000-8000-0000000000a3','corretor'),
 ('2f000000-0000-4000-8000-0000000000a4','corretor'),
 ('2f000000-0000-4000-8000-0000000000a5','financeiro'),
 ('2f000000-0000-4000-8000-0000000000a6','staff'),
 ('2f000000-0000-4000-8000-0000000000a7','admin'),
 ('2f000000-0000-4000-8000-0000000000a8','juridico'),
 ('2f000000-0000-4000-8000-0000000000a9','super_admin'),
 ('2f000000-0000-4000-8000-0000000000aa','lancamento'),
 ('2f000000-0000-4000-8000-0000000000ab','lancamento'),
 ('2f000000-0000-4000-8000-0000000000b1','admin'),
 ('2f000000-0000-4000-8000-0000000000b2','corretor')
ON CONFLICT DO NOTHING;
INSERT INTO public.teams(id,lider_id,nome,organization_id) VALUES
 ('2f0a0000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-0000000000a1','Equipe 1 2f','00000000-0000-4000-8000-000000000001'),
 ('2f0a0000-0000-4000-8000-000000000002','2f000000-0000-4000-8000-0000000000a2','Equipe 2 2f','00000000-0000-4000-8000-000000000001');
INSERT INTO public.team_members(team_id,membro_id,tipo) VALUES
 ('2f0a0000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-0000000000a3','corretor'),
 ('2f0a0000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-0000000000aa','corretor'),
 ('2f0a0000-0000-4000-8000-000000000002','2f000000-0000-4000-8000-0000000000a4','corretor');

-- Rascunhos: r1 criado por c1 (c2 é vendedor/participante); r2 criado por c2 (equipe do tl);
-- r3 criado pelo lançamento l; rb da agência B.
INSERT INTO public.sales(id,corretor_id,corretor_vendedor_id,imovel_id,status,organization_id) VALUES
 ('2f050000-0000-4000-8000-000000000001','2f000000-0000-4000-8000-0000000000a3','2f000000-0000-4000-8000-0000000000a4','2F-R1','rascunho','00000000-0000-4000-8000-000000000001'),
 ('2f050000-0000-4000-8000-000000000002','2f000000-0000-4000-8000-0000000000a4',NULL,'2F-R2','rascunho','00000000-0000-4000-8000-000000000001'),
 ('2f050000-0000-4000-8000-000000000003','2f000000-0000-4000-8000-0000000000aa',NULL,'2F-R3','rascunho','00000000-0000-4000-8000-000000000001'),
 ('2f050000-0000-4000-8000-0000000000b1','2f000000-0000-4000-8000-0000000000b2',NULL,'2F-RB','rascunho','2f000000-0000-4000-8000-0000000000b0');
-- Uma venda em cada etapa depois do rascunho (A) e duas em B.
DO $$ DECLARE st text; i int := 0; BEGIN
  FOR st IN SELECT unnest(enum_range(NULL::public.sale_status))::text EXCEPT SELECT unnest(ARRAY['rascunho','cancelada']) LOOP
    i := i + 1;
    INSERT INTO public.sales(id,corretor_id,imovel_id,status,organization_id)
      VALUES (('2f05ffff-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,'2f000000-0000-4000-8000-0000000000a3',
              '2F-ST-' || st, st::public.sale_status,'00000000-0000-4000-8000-000000000001');
  END LOOP;
END $$;
INSERT INTO public.sales(id,corretor_id,imovel_id,status,organization_id) VALUES
 ('2f050000-0000-4000-8000-0000000000b2','2f000000-0000-4000-8000-0000000000b2','2F-B-REV','enviada_revisao','2f000000-0000-4000-8000-0000000000b0'),
 ('2f050000-0000-4000-8000-0000000000b3','2f000000-0000-4000-8000-0000000000b2','2F-B-CONCL','ocorrencia_concluida','2f000000-0000-4000-8000-0000000000b0');
CREATE TABLE mt_2f_test.st AS SELECT id, status::text AS st FROM public.sales WHERE imovel_id LIKE '2F-ST-%';
GRANT SELECT ON mt_2f_test.st TO authenticated;

-- ---------- 1. Excluir em rascunho ----------
SELECT mt_2f_test.check('excluir rascunho: ' || v.who || CASE WHEN v.exp = 'ok:1' THEN ' exclui' ELSE ' NAO exclui' END,
  mt_2f_test.del(v.u::uuid, v.sale::uuid) = v.exp)
  FROM (VALUES
   ('criador (corretor c1)',            '2f000000-0000-4000-8000-0000000000a3','2f050000-0000-4000-8000-000000000001','ok:1'),
   ('gestor lider da equipe do criador','2f000000-0000-4000-8000-0000000000a1','2f050000-0000-4000-8000-000000000001','ok:1'),
   ('team_leader lider da equipe',      '2f000000-0000-4000-8000-0000000000a2','2f050000-0000-4000-8000-000000000002','ok:1'),
   ('admin da agencia',                 '2f000000-0000-4000-8000-0000000000a7','2f050000-0000-4000-8000-000000000001','ok:1'),
   ('super_admin da agencia',           '2f000000-0000-4000-8000-0000000000a9','2f050000-0000-4000-8000-000000000001','ok:1'),
   ('lancamento criador',               '2f000000-0000-4000-8000-0000000000aa','2f050000-0000-4000-8000-000000000003','ok:1'),
   ('gestor lider do lancamento criador','2f000000-0000-4000-8000-0000000000a1','2f050000-0000-4000-8000-000000000003','ok:1'),
   ('participante que nao criou (c2)',  '2f000000-0000-4000-8000-0000000000a4','2f050000-0000-4000-8000-000000000001','ok:0'),
   ('team_leader de outra equipe',      '2f000000-0000-4000-8000-0000000000a2','2f050000-0000-4000-8000-000000000001','ok:0'),
   ('gestor de outra equipe',           '2f000000-0000-4000-8000-0000000000a1','2f050000-0000-4000-8000-000000000002','ok:0'),
   ('financeiro',                       '2f000000-0000-4000-8000-0000000000a5','2f050000-0000-4000-8000-000000000001','ok:0'),
   ('juridico',                         '2f000000-0000-4000-8000-0000000000a8','2f050000-0000-4000-8000-000000000001','ok:0'),
   ('staff',                            '2f000000-0000-4000-8000-0000000000a6','2f050000-0000-4000-8000-000000000001','ok:0'),
   ('lancamento que nao criou',         '2f000000-0000-4000-8000-0000000000ab','2f050000-0000-4000-8000-000000000003','ok:0'),
   ('dono da plataforma (sem papel na agencia)','2f000000-0000-4000-8000-0000000000a0','2f050000-0000-4000-8000-000000000001','ok:0'),
   ('admin da agencia B em venda de A', '2f000000-0000-4000-8000-0000000000b1','2f050000-0000-4000-8000-000000000001','ok:0'),
   ('admin de A em venda de B',         '2f000000-0000-4000-8000-0000000000a7','2f050000-0000-4000-8000-0000000000b1','ok:0'),
   ('admin da agencia B em venda de B', '2f000000-0000-4000-8000-0000000000b1','2f050000-0000-4000-8000-0000000000b1','ok:1')
  ) v(who,u,sale,exp);

-- ---------- 2. Excluir depois do rascunho: ninguém ----------
SELECT mt_2f_test.check('excluir ' || s.st || ': ' || w.who || ' NAO exclui',
  mt_2f_test.del(w.u::uuid, s.id) = 'ok:0')
  FROM mt_2f_test.st s CROSS JOIN (VALUES
   ('criador','2f000000-0000-4000-8000-0000000000a3'),('gestor lider','2f000000-0000-4000-8000-0000000000a1'),
   ('admin','2f000000-0000-4000-8000-0000000000a7'),('super_admin agencia','2f000000-0000-4000-8000-0000000000a9'),
   ('financeiro','2f000000-0000-4000-8000-0000000000a5')) w(who,u);

-- ---------- 3. Cancelar: só o dono da plataforma, depois do rascunho ----------
SELECT mt_2f_test.check('cancelar ' || s.st || ': dono da plataforma cancela (A)',
  mt_2f_test.cancel_platform('2f000000-0000-4000-8000-0000000000a0', s.id) = 'ok:1')
  FROM mt_2f_test.st s;
SELECT mt_2f_test.check('cancelar ' || v.st || ': dono da plataforma cancela venda da agencia B',
  mt_2f_test.cancel_platform('2f000000-0000-4000-8000-0000000000a0', v.id::uuid) = 'ok:1')
  FROM (VALUES ('enviada_revisao','2f050000-0000-4000-8000-0000000000b2'),('ocorrencia_concluida','2f050000-0000-4000-8000-0000000000b3')) v(st,id);
-- Ninguém mais cancela, por nenhum caminho, em nenhuma etapa.
SELECT mt_2f_test.check('cancelar ' || s.st || ': ' || w.who || ' NAO cancela (' || c.via || ')',
  CASE c.via WHEN 'plataforma' THEN mt_2f_test.cancel_platform(w.u::uuid, s.id)
             WHEN 'change_sale_status' THEN mt_2f_test.cancel_old(w.u::uuid, s.id)
             ELSE mt_2f_test.cancel_update(w.u::uuid, s.id) END <> 'ok:1')
  FROM mt_2f_test.st s
  CROSS JOIN (VALUES
   ('super_admin da agencia','2f000000-0000-4000-8000-0000000000a9'),('admin','2f000000-0000-4000-8000-0000000000a7'),
   ('gestor lider','2f000000-0000-4000-8000-0000000000a1'),('team_leader','2f000000-0000-4000-8000-0000000000a2'),
   ('financeiro','2f000000-0000-4000-8000-0000000000a5'),('corretor criador','2f000000-0000-4000-8000-0000000000a3'),
   ('juridico','2f000000-0000-4000-8000-0000000000a8'),('staff','2f000000-0000-4000-8000-0000000000a6')) w(who,u)
  CROSS JOIN (VALUES ('plataforma'),('change_sale_status'),('update')) c(via);
SELECT mt_2f_test.check('dono da plataforma NAO cancela pela RPC antiga (' || s.st || ')',
  mt_2f_test.cancel_old('2f000000-0000-4000-8000-0000000000a0', s.id) <> 'ok:1')
  FROM mt_2f_test.st s WHERE s.st IN ('enviada_revisao','ocorrencia_concluida');
SELECT mt_2f_test.check('dono da plataforma NAO cancela por UPDATE direto',
  mt_2f_test.cancel_update('2f000000-0000-4000-8000-0000000000a0', s.id) <> 'ok:1')
  FROM mt_2f_test.st s WHERE s.st = 'enviada_revisao';
-- Rascunho: ninguém cancela, nem o dono da plataforma.
SELECT mt_2f_test.check('rascunho: ' || w.who || ' NAO cancela',
  mt_2f_test.cancel_platform(w.u::uuid, w.sale::uuid) <> 'ok:1'
  AND mt_2f_test.cancel_old(w.u::uuid, w.sale::uuid) <> 'ok:1')
  FROM (VALUES
   ('dono da plataforma (A)','2f000000-0000-4000-8000-0000000000a0','2f050000-0000-4000-8000-000000000001'),
   ('dono da plataforma (B)','2f000000-0000-4000-8000-0000000000a0','2f050000-0000-4000-8000-0000000000b1'),
   ('super_admin da agencia','2f000000-0000-4000-8000-0000000000a9','2f050000-0000-4000-8000-000000000001'),
   ('admin','2f000000-0000-4000-8000-0000000000a7','2f050000-0000-4000-8000-000000000001'),
   ('gestor lider','2f000000-0000-4000-8000-0000000000a1','2f050000-0000-4000-8000-000000000001')) w(who,u,sale);
SELECT mt_2f_test.check('dono da plataforma: motivo obrigatorio',
  mt_2f_test.cancel_platform('2f000000-0000-4000-8000-0000000000a0', s.id, '  ') = 'erro:23514')
  FROM mt_2f_test.st s WHERE s.st = 'enviada_revisao';
SELECT mt_2f_test.check('dono da plataforma: venda inexistente falha',
  mt_2f_test.cancel_platform('2f000000-0000-4000-8000-0000000000a0', '2f05eeee-0000-4000-8000-000000000000') = 'erro:P0002');
SELECT mt_2f_test.check('anon nao executa platform_cancel_sale nem le a auditoria',
  to_regprocedure('public.platform_cancel_sale(uuid,text)') IS NOT NULL
  AND to_regclass('public.platform_sale_cancellations') IS NOT NULL
  AND NOT has_function_privilege('anon',to_regprocedure('public.platform_cancel_sale(uuid,text)'),'EXECUTE')
  AND NOT has_table_privilege('anon',to_regclass('public.platform_sale_cancellations'),'SELECT')
  AND NOT has_table_privilege('authenticated',to_regclass('public.platform_sale_cancellations'),'INSERT'));
-- Não abre leitura geral entre agências: o dono da plataforma continua sem ler vendas de B.
SELECT mt_2f_test.check('dono da plataforma NAO le vendas da agencia B',
  mt_2f_test.run('2f000000-0000-4000-8000-0000000000a0',
    $$SELECT 1 FROM public.sales WHERE organization_id = '2f000000-0000-4000-8000-0000000000b0'$$) = 'ok:0');

-- ---------- 4. Auditoria (execução real dentro da transação do teste, desfeita no ROLLBACK) ----------
-- Sem a 2f a RPC não existe: registra falha em vez de abortar o arquivo.
DO $$ BEGIN
  IF to_regclass('public.platform_sale_cancellations') IS NULL THEN
    PERFORM mt_2f_test.check('auditoria: tabela platform_sale_cancellations existe', false);
    CREATE TABLE public.platform_sale_cancellations (sale_id uuid, sale_organization_id uuid, actor_user_id uuid,
      status_anterior text, motivo text, created_at timestamptz);
    GRANT SELECT ON public.platform_sale_cancellations TO authenticated;
    RETURN;
  END IF;
  PERFORM mt_2f_test.as_user('2f000000-0000-4000-8000-0000000000a0');
  PERFORM public.platform_cancel_sale('2f050000-0000-4000-8000-0000000000b2', 'Venda duplicada (teste 2f)');
  PERFORM public.platform_cancel_sale(s.id, 'Cliente desistiu (teste 2f)') FROM mt_2f_test.st s WHERE s.st = 'aprovada_gestor';
  PERFORM mt_2f_test.check('auditoria: dono da plataforma le os proprios registros',
    (SELECT count(*) FROM public.platform_sale_cancellations WHERE motivo LIKE '%(teste 2f)') = 2);
  RESET ROLE; PERFORM set_config('request.jwt.claims','',true);
END $$;
SELECT mt_2f_test.check('auditoria: quem, quando, venda, agencia, etapa e motivo (B)',
  EXISTS (SELECT 1 FROM public.platform_sale_cancellations WHERE sale_id = '2f050000-0000-4000-8000-0000000000b2'
    AND actor_user_id = '2f000000-0000-4000-8000-0000000000a0' AND sale_organization_id = '2f000000-0000-4000-8000-0000000000b0'
    AND status_anterior = 'enviada_revisao' AND motivo = 'Venda duplicada (teste 2f)' AND created_at IS NOT NULL));
SELECT mt_2f_test.check('auditoria: venda de B ficou cancelada e historico da venda gravado na agencia B',
  (SELECT status::text FROM public.sales WHERE id = '2f050000-0000-4000-8000-0000000000b2') = 'cancelada'
  AND EXISTS (SELECT 1 FROM public.sale_status_history WHERE sale_id = '2f050000-0000-4000-8000-0000000000b2'
    AND para = 'cancelada' AND de = 'enviada_revisao' AND organization_id = '2f000000-0000-4000-8000-0000000000b0'
    AND motivo = '[Plataforma] Venda duplicada (teste 2f)')
  AND EXISTS (SELECT 1 FROM public.activity_logs WHERE sale_id = '2f050000-0000-4000-8000-0000000000b2'
    AND payload->>'origem' = 'plataforma' AND organization_id = '2f000000-0000-4000-8000-0000000000b0'));
SELECT mt_2f_test.check('auditoria: agencia A registrada no cancelamento de A',
  EXISTS (SELECT 1 FROM public.platform_sale_cancellations c JOIN mt_2f_test.st s ON s.id = c.sale_id
    WHERE s.st = 'aprovada_gestor' AND c.sale_organization_id = '00000000-0000-4000-8000-000000000001'));
SELECT mt_2f_test.check('auditoria: admin da agencia B NAO le a auditoria da plataforma',
  mt_2f_test.run('2f000000-0000-4000-8000-0000000000b1', 'SELECT 1 FROM public.platform_sale_cancellations') = 'ok:0');
SELECT mt_2f_test.check('auditoria: super_admin da agencia A NAO le a auditoria da plataforma',
  mt_2f_test.run('2f000000-0000-4000-8000-0000000000a9', 'SELECT 1 FROM public.platform_sale_cancellations') = 'ok:0');
SELECT mt_2f_test.check('auditoria: ninguem grava direto',
  mt_2f_test.run('2f000000-0000-4000-8000-0000000000a0',
    $$INSERT INTO public.platform_sale_cancellations(sale_id,sale_organization_id,actor_user_id,status_anterior,motivo)
      VALUES ('2f050000-0000-4000-8000-0000000000b3','2f000000-0000-4000-8000-0000000000b0','2f000000-0000-4000-8000-0000000000a0','x','x')$$) LIKE 'erro:%');
SELECT mt_2f_test.check('cancelada de novo: falha',
  mt_2f_test.cancel_platform('2f000000-0000-4000-8000-0000000000a0', '2f050000-0000-4000-8000-0000000000b2') = 'erro:23514');
SELECT mt_2f_test.check('arquivar continua para admin (sem mudanca)',
  mt_2f_test.run('2f000000-0000-4000-8000-0000000000a7',
    format('SELECT public.change_sale_status(%L,%L,%L)', (SELECT id FROM mt_2f_test.st WHERE st='enviada_revisao'), 'arquivada', 'teste 2f')) = 'ok:1');

SELECT set_config('request.jwt.claims','',true);
SELECT 'FALHA: ' || label FROM mt_2f_test.results WHERE NOT ok ORDER BY n;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM mt_2f_test.results;
ROLLBACK;
