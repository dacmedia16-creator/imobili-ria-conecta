-- Ensaio SQL da regra de excluir/cancelar venda (migration 20260929090000). Somente Postgres local
-- descartável. Tudo em transação + ROLLBACK; cada tentativa de escrita roda em subtransação desfeita.
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA ecv_test;
CREATE TABLE ecv_test.results (n serial, label text, ok boolean);
GRANT USAGE ON SCHEMA ecv_test TO authenticated;
GRANT ALL ON ecv_test.results TO authenticated;
GRANT ALL ON SEQUENCE ecv_test.results_n_seq TO authenticated;
CREATE FUNCTION ecv_test.check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO ecv_test.results(label,ok) VALUES(label,coalesce(ok,false)) $$;
CREATE FUNCTION ecv_test.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true); END $$;
CREATE FUNCTION ecv_test.dry(q text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE n bigint; BEGIN
  BEGIN
   EXECUTE q; GET DIAGNOSTICS n = ROW_COUNT;
   RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = n::text;
  EXCEPTION WHEN SQLSTATE 'P0999' THEN RETURN 'ok:' || SQLERRM;
   WHEN OTHERS THEN RETURN 'erro:' || SQLSTATE; END;
 END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ecv_test TO authenticated;

-- Usuários sintéticos: cr (criador/corretor), p (participante vendedor), g (gestor da equipe de cr),
-- tl (team leader da equipe de cr), g2 (gestor de outra equipe), ad (admin), sa (super_admin),
-- f (financeiro), j (jurídico), st (staff), pa (dono da plataforma: mesmos papéis de Denis).
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('ec000000-0000-4000-8000-000000000001','cr.ecv@example.test','{"nome":"Criador"}','{}'),
 ('ec000000-0000-4000-8000-000000000002','p.ecv@example.test','{"nome":"Participante"}','{}'),
 ('ec000000-0000-4000-8000-000000000003','g.ecv@example.test','{"nome":"Gestor"}','{}'),
 ('ec000000-0000-4000-8000-000000000004','tl.ecv@example.test','{"nome":"Team Leader"}','{}'),
 ('ec000000-0000-4000-8000-000000000005','g2.ecv@example.test','{"nome":"Gestor 2"}','{}'),
 ('ec000000-0000-4000-8000-000000000006','ad.ecv@example.test','{"nome":"Admin"}','{}'),
 ('ec000000-0000-4000-8000-000000000007','sa.ecv@example.test','{"nome":"Super Admin"}','{}'),
 ('ec000000-0000-4000-8000-000000000008','f.ecv@example.test','{"nome":"Financeiro"}','{}'),
 ('ec000000-0000-4000-8000-000000000009','j.ecv@example.test','{"nome":"Juridico"}','{}'),
 ('ec000000-0000-4000-8000-00000000000a','st.ecv@example.test','{"nome":"Staff"}','{}'),
 ('ec000000-0000-4000-8000-00000000000b','pa.ecv@example.test','{"nome":"Plataforma"}','{}');
INSERT INTO public.profiles (id, nome, ativo)
SELECT id, raw_user_meta_data->>'nome', true FROM auth.users WHERE email LIKE '%.ecv@example.test'
ON CONFLICT (id) DO UPDATE SET ativo = true;
INSERT INTO public.user_roles(user_id,role) VALUES
 ('ec000000-0000-4000-8000-000000000001','corretor'),
 ('ec000000-0000-4000-8000-000000000002','corretor'),
 ('ec000000-0000-4000-8000-000000000003','gestor'),
 ('ec000000-0000-4000-8000-000000000004','team_leader'),
 ('ec000000-0000-4000-8000-000000000005','gestor'),
 ('ec000000-0000-4000-8000-000000000006','admin'),
 ('ec000000-0000-4000-8000-000000000007','super_admin'),
 ('ec000000-0000-4000-8000-000000000008','financeiro'),
 ('ec000000-0000-4000-8000-000000000009','juridico'),
 ('ec000000-0000-4000-8000-00000000000a','staff'),
 ('ec000000-0000-4000-8000-00000000000b','corretor'),('ec000000-0000-4000-8000-00000000000b','gestor'),
 ('ec000000-0000-4000-8000-00000000000b','juridico'),('ec000000-0000-4000-8000-00000000000b','financeiro'),
 ('ec000000-0000-4000-8000-00000000000b','admin'),('ec000000-0000-4000-8000-00000000000b','super_admin')
ON CONFLICT DO NOTHING;
INSERT INTO public.teams(id,lider_id,nome) VALUES
 ('ec0a0000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000003','Equipe ECV'),
 ('ec0a0000-0000-4000-8000-000000000002','ec000000-0000-4000-8000-000000000005','Outra ECV');
INSERT INTO public.team_co_leaders(team_id,user_id) VALUES
 ('ec0a0000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000004');
INSERT INTO public.team_members(team_id,membro_id,tipo) VALUES
 ('ec0a0000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000001','corretor');

-- Uma venda do criador em cada etapa (exceto cancelada/arquivada), com participante vendedor.
CREATE TABLE ecv_test.vendas (st text PRIMARY KEY, id uuid);
GRANT SELECT ON ecv_test.vendas TO authenticated;
DO $$ DECLARE st text; i int := 0; sid uuid; BEGIN
  FOR st IN SELECT unnest(enum_range(NULL::public.sale_status))::text
            EXCEPT SELECT unnest(ARRAY['cancelada','arquivada']) LOOP
    i := i + 1;
    sid := ('ec05ffff-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    INSERT INTO public.sales(id,corretor_id,corretor_vendedor_id,imovel_id,status)
      VALUES (sid,'ec000000-0000-4000-8000-000000000001','ec000000-0000-4000-8000-000000000002',
              'ECV-' || st, st::public.sale_status);
    INSERT INTO ecv_test.vendas VALUES (st, sid);
  END LOOP;
END $$;
-- Sem a migration a tabela não existe: cria só dentro desta transação (desfeita) para a suíte rodar
-- também ANTES e mostrar quais casos a regra antiga viola.
CREATE TABLE IF NOT EXISTS public.platform_admins (user_id uuid PRIMARY KEY, created_at timestamptz DEFAULT now());
INSERT INTO public.platform_admins(user_id) VALUES ('ec000000-0000-4000-8000-00000000000b');

CREATE TABLE ecv_test.quem (k text PRIMARY KEY, u uuid, exclui_rascunho boolean, cancela boolean);
INSERT INTO ecv_test.quem VALUES
 ('criador',                 'ec000000-0000-4000-8000-000000000001', true,  false),
 ('participante nao criador','ec000000-0000-4000-8000-000000000002', false, false),
 ('gestor da equipe',        'ec000000-0000-4000-8000-000000000003', true,  false),
 ('team leader da equipe',   'ec000000-0000-4000-8000-000000000004', true,  false),
 ('gestor de outra equipe',  'ec000000-0000-4000-8000-000000000005', false, false),
 ('admin',                   'ec000000-0000-4000-8000-000000000006', true,  false),
 ('super_admin',             'ec000000-0000-4000-8000-000000000007', true,  false),
 ('financeiro',              'ec000000-0000-4000-8000-000000000008', false, false),
 ('juridico',                'ec000000-0000-4000-8000-000000000009', false, false),
 ('staff',                   'ec000000-0000-4000-8000-00000000000a', false, false),
 ('dono da plataforma',      'ec000000-0000-4000-8000-00000000000b', true,  true);
GRANT SELECT ON ecv_test.quem TO authenticated;

-- Matriz perfil × etapa, excluir e cancelar.
DO $$ DECLARE q record; v record; r text; esperado text; BEGIN
  FOR q IN SELECT * FROM ecv_test.quem LOOP
    FOR v IN SELECT * FROM ecv_test.vendas LOOP
      PERFORM ecv_test.as_user(q.u);
      r := ecv_test.dry(format('DELETE FROM public.sales WHERE id = %L', v.id));
      RESET ROLE;
      esperado := CASE WHEN v.st = 'rascunho' AND q.exclui_rascunho THEN 'ok:1' ELSE 'ok:0' END;
      PERFORM ecv_test.check(format('excluir %s: %s -> %s (obtido %s)', v.st, q.k, esperado, r), r = esperado);

      PERFORM ecv_test.as_user(q.u);
      r := ecv_test.dry(format('SELECT public.change_sale_status(%L,%L,%L)', v.id, 'cancelada', 'teste ecv'));
      RESET ROLE;
      esperado := CASE WHEN v.st <> 'rascunho' AND q.cancela THEN 'ok:1' ELSE 'erro' END;
      PERFORM ecv_test.check(format('cancelar %s: %s -> %s (obtido %s)', v.st, q.k, esperado, r),
        CASE WHEN esperado = 'erro' THEN r LIKE 'erro:%' ELSE r LIKE 'ok:%' END);
    END LOOP;
  END LOOP;
END $$;

-- Cancelar sem motivo continua recusado, mesmo para o dono da plataforma.
SELECT ecv_test.as_user('ec000000-0000-4000-8000-00000000000b');
SELECT ecv_test.check('cancelar sem motivo: recusado (23514)',
  ecv_test.dry(format('SELECT public.change_sale_status(%L,%L,NULL)',
    (SELECT id FROM ecv_test.vendas WHERE st='enviada_revisao'), 'cancelada')) = 'erro:23514');
RESET ROLE;
-- Auditoria: o cancelamento grava histórico (autor, motivo) e activity_logs na mesma transação.
DO $$ DECLARE sid uuid := (SELECT id FROM ecv_test.vendas WHERE st='aguardando_assinatura'); BEGIN
  PERFORM ecv_test.as_user('ec000000-0000-4000-8000-00000000000b');
  PERFORM public.change_sale_status(sid, 'cancelada', 'motivo ecv');
  RESET ROLE;
  PERFORM ecv_test.check('auditoria: sale_status_history com autor, motivo e data',
    EXISTS (SELECT 1 FROM public.sale_status_history WHERE sale_id = sid AND para = 'cancelada'
            AND autor_id = 'ec000000-0000-4000-8000-00000000000b' AND motivo = 'motivo ecv' AND created_at IS NOT NULL));
  PERFORM ecv_test.check('auditoria: activity_logs status_change com motivo',
    EXISTS (SELECT 1 FROM public.activity_logs WHERE sale_id = sid AND acao = 'status_change'
            AND autor_id = 'ec000000-0000-4000-8000-00000000000b' AND payload->>'motivo' = 'motivo ecv'));
END $$;

-- Regressões: arquivar e demais transições seguem como antes.
SELECT ecv_test.as_user('ec000000-0000-4000-8000-000000000006');
SELECT ecv_test.check('admin ainda arquiva',
  ecv_test.dry(format('SELECT public.change_sale_status(%L,%L,%L)', (SELECT id FROM ecv_test.vendas WHERE st='ocorrencia_pendente'), 'arquivada', 'x')) LIKE 'ok:%');
RESET ROLE;
SELECT ecv_test.as_user('ec000000-0000-4000-8000-000000000003');
SELECT ecv_test.check('gestor da equipe ainda arquiva na etapa dele',
  ecv_test.dry(format('SELECT public.change_sale_status(%L,%L,%L)', (SELECT id FROM ecv_test.vendas WHERE st='enviada_revisao'), 'arquivada', 'x')) LIKE 'ok:%');
-- Transições comuns: a regra de permissão (42501) não pode barrar. Outros gatilhos de consistência
-- (23514, venda sintética incompleta) são independentes desta migration e aceitos aqui.
SELECT ecv_test.check('gestor da equipe ainda aprova (enviada_revisao -> aprovada_gestor): ' || r, r NOT LIKE 'erro:42501')
  FROM (SELECT ecv_test.dry(format('SELECT public.change_sale_status(%L,%L,NULL)', (SELECT id FROM ecv_test.vendas WHERE st='enviada_revisao'), 'aprovada_gestor')) r) x;
RESET ROLE;
SELECT ecv_test.as_user('ec000000-0000-4000-8000-000000000001');
SELECT ecv_test.check('criador ainda envia rascunho para revisao: ' || r, r NOT LIKE 'erro:42501')
  FROM (SELECT ecv_test.dry(format('SELECT public.change_sale_status(%L,%L,NULL)', (SELECT id FROM ecv_test.vendas WHERE st='rascunho'), 'enviada_revisao')) r) x;
RESET ROLE;
-- A mesma transição por quem não tem papel continua barrada pela regra (42501).
SELECT ecv_test.as_user('ec000000-0000-4000-8000-00000000000a');
SELECT ecv_test.check('staff continua sem aprovar: ' || r, r LIKE 'erro:%')
  FROM (SELECT ecv_test.dry(format('SELECT public.change_sale_status(%L,%L,NULL)', (SELECT id FROM ecv_test.vendas WHERE st='enviada_revisao'), 'aprovada_gestor')) r) x;
RESET ROLE;
-- Tabela e função novas: sem acesso direto de anon/authenticated à tabela.
SELECT ecv_test.check('platform_admins sem SELECT para authenticated/anon',
  NOT has_table_privilege('authenticated','public.platform_admins','SELECT')
  AND NOT has_table_privilege('anon','public.platform_admins','SELECT'));
-- Via EXECUTE: antes da migration a função não existe e o caso só marca falha (sem abortar a suíte).
DO $$ DECLARE ok boolean; BEGIN
  IF to_regprocedure('public.is_platform_super_admin(uuid)') IS NULL THEN
    PERFORM ecv_test.check('is_platform_super_admin existe', false);
    RETURN;
  END IF;
  PERFORM ecv_test.check('is_platform_super_admin: authenticated executa, anon não',
    has_function_privilege('authenticated','public.is_platform_super_admin(uuid)','EXECUTE')
    AND NOT has_function_privilege('anon','public.is_platform_super_admin(uuid)','EXECUTE'));
  PERFORM ecv_test.as_user('ec000000-0000-4000-8000-000000000006');
  EXECUTE 'SELECT public.is_platform_super_admin()' INTO ok;
  RESET ROLE;
  PERFORM ecv_test.check('RPC is_platform_super_admin: admin comum = false', ok = false);
  PERFORM ecv_test.as_user('ec000000-0000-4000-8000-00000000000b');
  EXECUTE 'SELECT public.is_platform_super_admin()' INTO ok;
  RESET ROLE;
  PERFORM ecv_test.check('RPC is_platform_super_admin: dono da plataforma = true', ok = true);
END $$;

SELECT set_config('request.jwt.claims','',true);
SELECT 'FALHA: ' || label FROM ecv_test.results WHERE NOT ok ORDER BY n;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM ecv_test.results;
ROLLBACK;
