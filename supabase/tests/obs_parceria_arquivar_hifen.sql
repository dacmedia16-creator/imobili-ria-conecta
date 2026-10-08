-- Ensaio da migration 20261008120000 (observações da parceria, arquivar antes da assinatura, hífen no
-- código interno). Somente Postgres local descartável/clone. Tudo em transação + ROLLBACK; cada
-- tentativa de escrita roda numa subtransação desfeita (oat_test.dry).
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA oat_test;
CREATE TABLE oat_test.results (n serial, label text, ok boolean);
GRANT USAGE ON SCHEMA oat_test TO authenticated;
GRANT ALL ON oat_test.results TO authenticated;
GRANT ALL ON SEQUENCE oat_test.results_n_seq TO authenticated;
CREATE FUNCTION oat_test.check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO oat_test.results(label,ok) VALUES(label,coalesce(ok,false)) $$;
CREATE FUNCTION oat_test.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM set_config('mt.ctx','',true);
 PERFORM set_config('role','authenticated',true); END $$;
CREATE FUNCTION oat_test.dry(q text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE n bigint; BEGIN
  BEGIN
   EXECUTE q; GET DIAGNOSTICS n = ROW_COUNT;
   RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = n::text;
  EXCEPTION WHEN SQLSTATE 'P0999' THEN RETURN 'ok:' || SQLERRM;
   WHEN OTHERS THEN RETURN 'erro:' || SQLSTATE; END;
 END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA oat_test TO authenticated;

-- Organização única do clone.
CREATE TABLE oat_test.cfg AS SELECT '00000000-0000-4000-8000-000000000001'::uuid AS org;
GRANT SELECT ON oat_test.cfg TO authenticated;

-- Usuários sintéticos: cr (corretor dono), p (participante vendedor), g (gestor da equipe de cr),
-- tl (team leader co-líder da equipe), g2 (gestor de outra equipe), f (financeiro), j (jurídico),
-- ad (admin), sa (super_admin), st (staff, sem acesso), pa (dono da plataforma).
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('0a700000-0000-4000-8000-000000000001','cr.oat@example.test','{"nome":"Corretor"}','{}'),
 ('0a700000-0000-4000-8000-000000000002','p.oat@example.test','{"nome":"Participante"}','{}'),
 ('0a700000-0000-4000-8000-000000000003','g.oat@example.test','{"nome":"Gestor"}','{}'),
 ('0a700000-0000-4000-8000-000000000004','tl.oat@example.test','{"nome":"Team Leader"}','{}'),
 ('0a700000-0000-4000-8000-000000000005','g2.oat@example.test','{"nome":"Gestor 2"}','{}'),
 ('0a700000-0000-4000-8000-000000000006','f.oat@example.test','{"nome":"Financeiro"}','{}'),
 ('0a700000-0000-4000-8000-000000000007','j.oat@example.test','{"nome":"Juridico"}','{}'),
 ('0a700000-0000-4000-8000-000000000008','ad.oat@example.test','{"nome":"Admin"}','{}'),
 ('0a700000-0000-4000-8000-000000000009','sa.oat@example.test','{"nome":"Super Admin"}','{}'),
 ('0a700000-0000-4000-8000-00000000000a','st.oat@example.test','{"nome":"Staff"}','{}'),
 ('0a700000-0000-4000-8000-00000000000b','pa.oat@example.test','{"nome":"Plataforma"}','{}');
INSERT INTO public.profiles (id, nome, ativo, organization_id)
SELECT id, raw_user_meta_data->>'nome', true, (SELECT org FROM oat_test.cfg) FROM auth.users WHERE email LIKE '%.oat@example.test'
ON CONFLICT (id) DO UPDATE SET ativo = true, organization_id = EXCLUDED.organization_id;
INSERT INTO public.organization_members (organization_id, user_id, ativo)
SELECT (SELECT org FROM oat_test.cfg), id, true FROM auth.users WHERE email LIKE '%.oat@example.test'
ON CONFLICT DO NOTHING;
DELETE FROM public.user_roles WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE '%.oat@example.test');
INSERT INTO public.user_roles(user_id,role,organization_id)
SELECT u, r::public.app_role, (SELECT org FROM oat_test.cfg) FROM (VALUES
 ('0a700000-0000-4000-8000-000000000001'::uuid,'corretor'),
 ('0a700000-0000-4000-8000-000000000002','corretor'),
 ('0a700000-0000-4000-8000-000000000003','gestor'),
 ('0a700000-0000-4000-8000-000000000004','team_leader'),
 ('0a700000-0000-4000-8000-000000000005','gestor'),
 ('0a700000-0000-4000-8000-000000000006','financeiro'),
 ('0a700000-0000-4000-8000-000000000007','juridico'),
 ('0a700000-0000-4000-8000-000000000008','admin'),
 ('0a700000-0000-4000-8000-000000000009','super_admin'),
 ('0a700000-0000-4000-8000-00000000000a','staff'),
 ('0a700000-0000-4000-8000-00000000000b','corretor'),('0a700000-0000-4000-8000-00000000000b','gestor'),
 ('0a700000-0000-4000-8000-00000000000b','admin'),('0a700000-0000-4000-8000-00000000000b','super_admin')) v(u,r);
INSERT INTO public.teams(id,lider_id,nome,organization_id) VALUES
 ('0a7a0000-0000-4000-8000-000000000001','0a700000-0000-4000-8000-000000000003','Equipe OAT',(SELECT org FROM oat_test.cfg)),
 ('0a7a0000-0000-4000-8000-000000000002','0a700000-0000-4000-8000-000000000005','Outra OAT',(SELECT org FROM oat_test.cfg));
INSERT INTO public.team_co_leaders(team_id,user_id,organization_id) VALUES
 ('0a7a0000-0000-4000-8000-000000000001','0a700000-0000-4000-8000-000000000004',(SELECT org FROM oat_test.cfg));
INSERT INTO public.team_members(team_id,membro_id,tipo,organization_id) VALUES
 ('0a7a0000-0000-4000-8000-000000000001','0a700000-0000-4000-8000-000000000001','corretor',(SELECT org FROM oat_test.cfg));
INSERT INTO public.platform_admins(user_id) VALUES ('0a700000-0000-4000-8000-00000000000b') ON CONFLICT DO NOTHING;

-- Uma venda do corretor em cada etapa (exceto cancelada/arquivada), com participante vendedor.
CREATE TABLE oat_test.vendas (st text PRIMARY KEY, id uuid);
GRANT SELECT ON oat_test.vendas TO authenticated;
DO $$ DECLARE st text; i int := 0; sid uuid; BEGIN
  FOR st IN SELECT unnest(enum_range(NULL::public.sale_status))::text
            EXCEPT SELECT unnest(ARRAY['cancelada','arquivada']) LOOP
    i := i + 1;
    sid := ('0a75ffff-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    INSERT INTO public.sales(id,organization_id,corretor_id,corretor_captador_id,corretor_vendedor_id,imovel_id,status)
      VALUES (sid,(SELECT org FROM oat_test.cfg),'0a700000-0000-4000-8000-000000000001','0a700000-0000-4000-8000-000000000001',
              '0a700000-0000-4000-8000-000000000002','OAT-' || st, st::public.sale_status);
    INSERT INTO oat_test.vendas VALUES (st, sid);
  END LOOP;
END $$;

-- Quem vê a venda hoje (can_view_sale): todos exceto gestor de outra equipe e staff; jurídico só a
-- partir de aprovada_gestor. Admin/super_admin/plataforma: arquivam em qualquer etapa (inalterado).
CREATE TABLE oat_test.quem (k text PRIMARY KEY, u uuid, admin boolean, juridico boolean, ve boolean);
INSERT INTO oat_test.quem VALUES
 ('corretor dono',          '0a700000-0000-4000-8000-000000000001', false, false, true),
 ('participante vendedor',  '0a700000-0000-4000-8000-000000000002', false, false, true),
 ('gestor da equipe',       '0a700000-0000-4000-8000-000000000003', false, false, true),
 ('team leader da equipe',  '0a700000-0000-4000-8000-000000000004', false, false, true),
 ('gestor de outra equipe', '0a700000-0000-4000-8000-000000000005', false, false, false),
 ('financeiro',             '0a700000-0000-4000-8000-000000000006', false, false, true),
 ('juridico',               '0a700000-0000-4000-8000-000000000007', false, true,  true),
 ('admin',                  '0a700000-0000-4000-8000-000000000008', true,  false, true),
 ('super_admin',            '0a700000-0000-4000-8000-000000000009', true,  false, true),
 ('staff',                  '0a700000-0000-4000-8000-00000000000a', false, false, false),
 ('dono da plataforma',     '0a700000-0000-4000-8000-00000000000b', true,  false, true);
GRANT SELECT ON oat_test.quem TO authenticated;
CREATE TABLE oat_test.antes_assinatura (st text PRIMARY KEY);
INSERT INTO oat_test.antes_assinatura VALUES ('rascunho'),('enviada_revisao'),('devolvida_ajuste'),
 ('aprovada_gestor'),('enviada_juridico'),('em_elaboracao_contrato'),('contrato_conferencia_gestor'),
 ('contrato_conferencia_corretor'),('contrato_ok_corretor'),('aguardando_assinatura');
GRANT SELECT ON oat_test.antes_assinatura TO authenticated;

-- Matriz perfil × etapa: arquivar (com motivo) e cancelar.
DO $$ DECLARE q record; v record; r text; pode boolean; antes boolean; ve boolean; BEGIN
  FOR q IN SELECT * FROM oat_test.quem LOOP
    FOR v IN SELECT * FROM oat_test.vendas LOOP
      antes := EXISTS (SELECT 1 FROM oat_test.antes_assinatura a WHERE a.st = v.st);
      ve := q.ve AND (NOT q.juridico OR v.st NOT IN ('rascunho','enviada_revisao','devolvida_ajuste'));
      pode := q.admin OR (antes AND ve);
      PERFORM oat_test.as_user(q.u);
      r := oat_test.dry(format('SELECT public.change_sale_status(%L,%L,%L)', v.id, 'arquivada', 'teste oat'));
      RESET ROLE;
      PERFORM oat_test.check(format('arquivar %s: %s -> %s (obtido %s)', v.st, q.k,
        CASE WHEN pode THEN 'ok' ELSE 'erro' END, r),
        CASE WHEN pode THEN r LIKE 'ok:%' ELSE r LIKE 'erro:%' END);

      PERFORM oat_test.as_user(q.u);
      r := oat_test.dry(format('SELECT public.change_sale_status(%L,%L,%L)', v.id, 'cancelada', 'teste oat'));
      RESET ROLE;
      PERFORM oat_test.check(format('cancelar %s: %s -> %s (obtido %s)', v.st, q.k,
        CASE WHEN q.k = 'dono da plataforma' AND v.st <> 'rascunho' THEN 'erro(platform_cancel_sale)' ELSE 'erro' END, r),
        r LIKE 'erro:%');
    END LOOP;
  END LOOP;
END $$;

-- Cancelar continua exclusivo do dono da plataforma pela RPC própria.
SELECT oat_test.as_user('0a700000-0000-4000-8000-00000000000b');
SELECT oat_test.check('cancelar: dono da plataforma via platform_cancel_sale -> ok (' || r || ')', r LIKE 'ok:%')
  FROM (SELECT oat_test.dry(format('SELECT public.platform_cancel_sale(%L,%L)', (SELECT id FROM oat_test.vendas WHERE st='enviada_revisao'), 'teste oat')) r) x;
RESET ROLE;
SELECT oat_test.as_user('0a700000-0000-4000-8000-000000000008');
SELECT oat_test.check('cancelar: admin comum via platform_cancel_sale -> erro (' || r || ')', r LIKE 'erro:%')
  FROM (SELECT oat_test.dry(format('SELECT public.platform_cancel_sale(%L,%L)', (SELECT id FROM oat_test.vendas WHERE st='enviada_revisao'), 'teste oat')) r) x;
RESET ROLE;

-- Arquivar sem motivo: recusado (23514) mesmo para quem pode.
SELECT oat_test.as_user('0a700000-0000-4000-8000-000000000001');
SELECT oat_test.check('arquivar sem motivo (corretor): 23514 (' || r || ')', r = 'erro:23514')
  FROM (SELECT oat_test.dry(format('SELECT public.change_sale_status(%L,%L,NULL)', (SELECT id FROM oat_test.vendas WHERE st='enviada_revisao'), 'arquivada')) r) x;
SELECT oat_test.check('arquivar com motivo em branco (corretor): 23514 (' || r || ')', r = 'erro:23514')
  FROM (SELECT oat_test.dry(format('SELECT public.change_sale_status(%L,%L,%L)', (SELECT id FROM oat_test.vendas WHERE st='enviada_revisao'), 'arquivada', '   ')) r) x;
-- UPDATE direto de status (sem RPC) também passa pelo gatilho: depois da assinatura, recusado.
SELECT oat_test.check('UPDATE direto arquivada em contrato_assinado (corretor): recusado (' || r || ')', r <> 'ok:1')
  FROM (SELECT oat_test.dry(format('UPDATE public.sales SET status=%L WHERE id=%L', 'arquivada', (SELECT id FROM oat_test.vendas WHERE st='contrato_assinado'))) r) x;
RESET ROLE;

-- Auditoria do arquivamento pelo corretor: histórico com autor/motivo e activity_logs.
DO $$ DECLARE sid uuid := (SELECT id FROM oat_test.vendas WHERE st='aguardando_assinatura'); BEGIN
  PERFORM oat_test.as_user('0a700000-0000-4000-8000-000000000001');
  PERFORM public.change_sale_status(sid, 'arquivada', 'motivo oat');
  RESET ROLE;
  PERFORM oat_test.check('auditoria: venda ficou arquivada',
    (SELECT status::text FROM public.sales WHERE id = sid) = 'arquivada');
  PERFORM oat_test.check('auditoria: sale_status_history com autor, motivo e data',
    EXISTS (SELECT 1 FROM public.sale_status_history WHERE sale_id = sid AND de = 'aguardando_assinatura'
            AND para = 'arquivada' AND autor_id = '0a700000-0000-4000-8000-000000000001'
            AND motivo = 'motivo oat' AND created_at IS NOT NULL));
  PERFORM oat_test.check('auditoria: activity_logs status_change com motivo',
    EXISTS (SELECT 1 FROM public.activity_logs WHERE sale_id = sid AND acao = 'status_change'
            AND autor_id = '0a700000-0000-4000-8000-000000000001' AND payload->>'motivo' = 'motivo oat'));
END $$;

-- Regressões: transições comuns seguem passando pela regra (42501 não pode aparecer).
SELECT oat_test.as_user('0a700000-0000-4000-8000-000000000001');
SELECT oat_test.check('corretor ainda envia rascunho para revisao: ' || r, r NOT LIKE 'erro:42501')
  FROM (SELECT oat_test.dry(format('SELECT public.change_sale_status(%L,%L,NULL)', (SELECT id FROM oat_test.vendas WHERE st='rascunho'), 'enviada_revisao')) r) x;
SELECT oat_test.check('corretor continua sem aprovar a própria venda: ' || r, r LIKE 'erro:%')
  FROM (SELECT oat_test.dry(format('SELECT public.change_sale_status(%L,%L,NULL)', (SELECT id FROM oat_test.vendas WHERE st='enviada_revisao'), 'aprovada_gestor')) r) x;
RESET ROLE;
SELECT oat_test.as_user('0a700000-0000-4000-8000-000000000003');
SELECT oat_test.check('gestor da equipe ainda aprova: ' || r, r NOT LIKE 'erro:42501')
  FROM (SELECT oat_test.dry(format('SELECT public.change_sale_status(%L,%L,NULL)', (SELECT id FROM oat_test.vendas WHERE st='enviada_revisao'), 'aprovada_gestor')) r) x;
RESET ROLE;
SELECT oat_test.as_user('0a700000-0000-4000-8000-00000000000a');
SELECT oat_test.check('staff continua sem aprovar: ' || r, r LIKE 'erro:%')
  FROM (SELECT oat_test.dry(format('SELECT public.change_sale_status(%L,%L,NULL)', (SELECT id FROM oat_test.vendas WHERE st='enviada_revisao'), 'aprovada_gestor')) r) x;
RESET ROLE;

-- 3. Código interno: CHECK no banco (a coluna só existe depois da migration).
DO $$ DECLARE sid uuid := (SELECT id FROM oat_test.vendas WHERE st='rascunho'); r text; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_codigo_interno_formato') THEN
    PERFORM oat_test.check('CHECK sales_codigo_interno_formato existe', false); RETURN;
  END IF;
  PERFORM oat_test.check('CHECK codigo_interno validada (convalidated)',
    (SELECT convalidated FROM pg_constraint WHERE conname = 'sales_codigo_interno_formato'));
  FOR r IN SELECT unnest(ARRAY['630591023-665','630591298-1','630591261-43']) LOOP
    PERFORM oat_test.check('codigo valido aceito: ' || r,
      oat_test.dry(format('UPDATE public.sales SET codigo_interno=%L WHERE id=%L', r, sid)) = 'ok:1');
  END LOOP;
  FOR r IN SELECT unnest(ARRAY['63059126143','.630591260-24','630591023-6654','63059102-665','630591023-','abc','630591023 665']) LOOP
    PERFORM oat_test.check('codigo invalido recusado (23514): ' || r,
      oat_test.dry(format('UPDATE public.sales SET codigo_interno=%L WHERE id=%L', r, sid)) = 'erro:23514');
  END LOOP;
  PERFORM oat_test.check('codigo nulo aceito',
    oat_test.dry(format('UPDATE public.sales SET codigo_interno=NULL WHERE id=%L', sid)) = 'ok:1');
  PERFORM oat_test.check('nenhum codigo_interno real fora do padrão',
    NOT EXISTS (SELECT 1 FROM public.sales WHERE codigo_interno IS NOT NULL AND codigo_interno !~ '^[0-9]{9}-[0-9]{1,3}$'));
END $$;

-- 1. Observações da parceria: corretor grava no rascunho (mesmo UPDATE do Resumo), quem vê lê,
-- quem não vê não lê, sem efeito em comissão.
DO $$ DECLARE sid uuid := (SELECT id FROM oat_test.vendas WHERE st='rascunho'); r text; d0 jsonb; d1 jsonb; BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='parceria_observacoes') THEN
    PERFORM oat_test.check('coluna sales.parceria_observacoes existe', false); RETURN;
  END IF;
  d0 := public.calcular_distribuicao_venda(sid);
  PERFORM oat_test.as_user('0a700000-0000-4000-8000-000000000001');
  r := oat_test.dry(format('UPDATE public.sales SET parceria_observacoes=%L WHERE id=%L', 'Parceiro paga ITBI', sid));
  RESET ROLE;
  PERFORM oat_test.check('corretor grava observações no rascunho: ' || r, r = 'ok:1');
  UPDATE public.sales SET parceria_observacoes = 'Parceiro paga ITBI' WHERE id = sid;
  d1 := public.calcular_distribuicao_venda(sid);
  PERFORM oat_test.check('observações não alteram calcular_distribuicao_venda', d0 = d1);
  PERFORM oat_test.as_user('0a700000-0000-4000-8000-000000000003');
  PERFORM oat_test.check('gestor da equipe lê observações',
    (SELECT parceria_observacoes FROM public.sales WHERE id = sid) = 'Parceiro paga ITBI');
  RESET ROLE;
  PERFORM oat_test.as_user('0a700000-0000-4000-8000-000000000005');
  PERFORM oat_test.check('gestor de outra equipe não lê a venda',
    NOT EXISTS (SELECT 1 FROM public.sales WHERE id = sid));
  RESET ROLE;
  PERFORM oat_test.check('observações acima de 2000 caracteres recusadas',
    oat_test.dry(format('UPDATE public.sales SET parceria_observacoes=%L WHERE id=%L', repeat('x', 2001), sid)) = 'erro:23514');
  -- corretor não edita fora da etapa dele (contrato_assinado), como o restante do Resumo.
  PERFORM oat_test.as_user('0a700000-0000-4000-8000-000000000001');
  r := oat_test.dry(format('UPDATE public.sales SET parceria_observacoes=%L WHERE id=%L', 'x', (SELECT id FROM oat_test.vendas WHERE st='contrato_assinado')));
  RESET ROLE;
  PERFORM oat_test.check('corretor não grava observações em contrato_assinado: ' || r, r <> 'ok:1');
END $$;

-- Impressão: o RPC devolve parceria_observacoes no objeto sale.
DO $$ DECLARE sid uuid := '336d7b5c-6e64-4714-a6ec-fc9c7ace2a7f'; doc jsonb; BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='parceria_observacoes') THEN
    PERFORM oat_test.check('impressão devolve parceria_observacoes', false); RETURN;
  END IF;
  UPDATE public.sales SET parceria_observacoes = 'obs impressão oat' WHERE id = sid;
  PERFORM oat_test.as_user('0a700000-0000-4000-8000-00000000000b');
  doc := public.imprimir_ocorrencias_concluidas(ARRAY[sid]);
  RESET ROLE;
  PERFORM oat_test.check('impressão devolve parceria_observacoes',
    doc->0->'sale'->>'parceria_observacoes' = 'obs impressão oat');
END $$;

SELECT set_config('request.jwt.claims','',true);
SELECT 'FALHA: ' || label FROM oat_test.results WHERE NOT ok ORDER BY n;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM oat_test.results;
ROLLBACK;
