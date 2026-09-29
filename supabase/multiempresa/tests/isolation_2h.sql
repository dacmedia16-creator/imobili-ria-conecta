-- Ensaio 2h: reservas de sala (decisão de Denis, 29/09/2026).
--  * Gestor e Team Leader veem e cancelam só as próprias e as da própria equipe (inclui equipe-filha e
--    co-liderança), sempre dentro da própria imobiliária.
--  * Admin e staff: todas da imobiliária. Corretor: só as próprias (vê também onde é participante).
--  * Outra agência: nada. Grade de ocupação (sala/horário/quem) continua para todos da agência.
-- Tudo em transação + ROLLBACK; cancelamentos rodam em subtransação desfeita (nada persiste).
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA mt_2h_test;
CREATE TABLE mt_2h_test.results (n serial, label text, ok boolean);
GRANT USAGE ON SCHEMA mt_2h_test TO service_role, authenticated;
GRANT ALL ON mt_2h_test.results TO service_role, authenticated;
GRANT ALL ON SEQUENCE mt_2h_test.results_n_seq TO service_role, authenticated;
CREATE FUNCTION mt_2h_test.check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO mt_2h_test.results(label,ok) VALUES(label,coalesce(ok,false)) $$;
CREATE FUNCTION mt_2h_test.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true); END $$;
-- RPC com efeito, desfeita: 'ok' ou 'erro:<SQLSTATE>'.
CREATE FUNCTION mt_2h_test.dry_rpc(q text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN
  BEGIN
   EXECUTE q;
   RAISE EXCEPTION USING ERRCODE = 'P0999';
  EXCEPTION WHEN SQLSTATE 'P0999' THEN RETURN 'ok';
   WHEN OTHERS THEN RETURN 'erro:' || SQLSTATE; END;
 END $$;
-- UPDATE direto (caminho da policy), desfeito: número de linhas ou erro.
CREATE FUNCTION mt_2h_test.dry_upd(id uuid) RETURNS text LANGUAGE plpgsql AS $$ DECLARE n bigint; BEGIN
  BEGIN
   UPDATE public.room_reservations SET notes = 'x2h' WHERE room_reservations.id = dry_upd.id;
   GET DIAGNOSTICS n = ROW_COUNT;
   RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = n::text;
  EXCEPTION WHEN SQLSTATE 'P0999' THEN RETURN 'ok:' || SQLERRM;
   WHEN OTHERS THEN RETURN 'erro:' || SQLSTATE; END;
 END $$;
CREATE FUNCTION mt_2h_test.sees(id uuid) RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS (SELECT 1 FROM public.room_reservations r WHERE r.id = sees.id) $$;
CREATE FUNCTION mt_2h_test.grid(id uuid) RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS (SELECT 1 FROM public.list_room_occupancy() o WHERE o.id = grid.id) $$;
CREATE FUNCTION mt_2h_test.cancel(id uuid) RETURNS text LANGUAGE sql AS $$
 SELECT mt_2h_test.dry_rpc(format('SELECT * FROM public.cancel_room_reservation(%L)', id)) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mt_2h_test TO service_role, authenticated;

-- ---------- Preparação (dados sintéticos) ----------
-- Agência A: gestor g lidera equipe G (c1) e a equipe-filha G2 (c3); team_leader tl lidera equipe T (c2);
-- co-líder cl (team_leader) co-lidera a equipe T; corretor c4 sem equipe; admin ad; staff s.
-- Agência B: gestor gb (equipe com cb), admin adb, corretor cb.
INSERT INTO public.organizations(id,slug,nome) VALUES ('2b000000-0000-4000-8000-0000000000b0','mt-2h-b','Agencia B 2h');
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('2b000000-0000-4000-8000-0000000000a1','g.2h@example.test','{"nome":"A Gestor 2h"}','{}'),
 ('2b000000-0000-4000-8000-0000000000a2','tl.2h@example.test','{"nome":"A TL 2h"}','{}'),
 ('2b000000-0000-4000-8000-0000000000a3','c1.2h@example.test','{"nome":"A C1 2h"}','{}'),
 ('2b000000-0000-4000-8000-0000000000a4','c2.2h@example.test','{"nome":"A C2 2h"}','{}'),
 ('2b000000-0000-4000-8000-0000000000a5','c3.2h@example.test','{"nome":"A C3 2h"}','{}'),
 ('2b000000-0000-4000-8000-0000000000a6','c4.2h@example.test','{"nome":"A C4 2h"}','{}'),
 ('2b000000-0000-4000-8000-0000000000a7','cl.2h@example.test','{"nome":"A CoLider 2h"}','{}'),
 ('2b000000-0000-4000-8000-0000000000a8','ad.2h@example.test','{"nome":"A Admin 2h"}','{}'),
 ('2b000000-0000-4000-8000-0000000000a9','s.2h@example.test','{"nome":"A Staff 2h"}','{}'),
 ('2b000000-0000-4000-8000-0000000000b1','gb.2h@example.test','{"nome":"B Gestor 2h"}','{"organization_id":"2b000000-0000-4000-8000-0000000000b0"}'),
 ('2b000000-0000-4000-8000-0000000000b2','cb.2h@example.test','{"nome":"B C 2h"}','{"organization_id":"2b000000-0000-4000-8000-0000000000b0"}'),
 ('2b000000-0000-4000-8000-0000000000b3','adb.2h@example.test','{"nome":"B Admin 2h"}','{"organization_id":"2b000000-0000-4000-8000-0000000000b0"}');
INSERT INTO public.user_roles(user_id,role) VALUES
 ('2b000000-0000-4000-8000-0000000000a1','gestor'),
 ('2b000000-0000-4000-8000-0000000000a2','team_leader'),
 ('2b000000-0000-4000-8000-0000000000a7','team_leader'),
 ('2b000000-0000-4000-8000-0000000000a8','admin'),
 ('2b000000-0000-4000-8000-0000000000a9','staff'),
 ('2b000000-0000-4000-8000-0000000000b1','gestor'),
 ('2b000000-0000-4000-8000-0000000000b3','admin');
INSERT INTO public.teams(id,lider_id,nome,organization_id,parent_team_id) VALUES
 ('2b0a0000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-0000000000a1','Equipe G 2h','00000000-0000-4000-8000-000000000001',NULL),
 ('2b0a0000-0000-4000-8000-000000000003','2b000000-0000-4000-8000-0000000000a2','Equipe T 2h','00000000-0000-4000-8000-000000000001',NULL),
 ('2b0a0000-0000-4000-8000-0000000000b1','2b000000-0000-4000-8000-0000000000b1','Equipe B 2h','2b000000-0000-4000-8000-0000000000b0',NULL);
-- Equipe-filha G2 (mãe = G): líder é outro team_leader (tl2), para provar que o gestor g enxerga pela
-- equipe-mãe e que o tl2 não enxerga a equipe-mãe.
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('2b000000-0000-4000-8000-0000000000aa','tl2.2h@example.test','{"nome":"A TL2 2h"}','{}');
INSERT INTO public.user_roles(user_id,role) VALUES ('2b000000-0000-4000-8000-0000000000aa','team_leader');
INSERT INTO public.teams(id,lider_id,nome,organization_id,parent_team_id) VALUES
 ('2b0a0000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-0000000000aa','Equipe G2 2h','00000000-0000-4000-8000-000000000001','2b0a0000-0000-4000-8000-000000000001');
INSERT INTO public.team_members(team_id,membro_id,tipo) VALUES
 ('2b0a0000-0000-4000-8000-000000000001','2b000000-0000-4000-8000-0000000000a3','corretor'),
 ('2b0a0000-0000-4000-8000-000000000002','2b000000-0000-4000-8000-0000000000a5','corretor'),
 ('2b0a0000-0000-4000-8000-000000000003','2b000000-0000-4000-8000-0000000000a4','corretor'),
 ('2b0a0000-0000-4000-8000-0000000000b1','2b000000-0000-4000-8000-0000000000b2','corretor');
INSERT INTO public.team_co_leaders(team_id,user_id) VALUES
 ('2b0a0000-0000-4000-8000-000000000003','2b000000-0000-4000-8000-0000000000a7');

-- Reservas (Campolim, 06h–07h, datas distantes: não colidem com dados reais).
-- rg=gestor, rt=tl, r1=c1 (equipe G), r3=c3 (equipe-filha G2), r2=c2 (equipe T), r4=c4 (sem equipe),
-- r4p=c4 com c1 participante, rb=cb (agência B).
INSERT INTO public.room_reservations(id,room,reserved_date,start_time,end_time,responsible_id,responsible_name,purpose,organization_id,participant_user_ids) VALUES
 ('2b070000-0000-4000-8000-0000000000a1','Campolim Sala 1',current_date+50,'06:00','06:30','2b000000-0000-4000-8000-0000000000a1','A Gestor 2h','Reunião de equipe','00000000-0000-4000-8000-000000000001','{}'),
 ('2b070000-0000-4000-8000-0000000000a2','Campolim Sala 2',current_date+50,'06:00','06:30','2b000000-0000-4000-8000-0000000000a2','A TL 2h','Reunião de equipe','00000000-0000-4000-8000-000000000001','{}'),
 ('2b070000-0000-4000-8000-0000000000a3','Campolim Sala 1',current_date+51,'06:00','06:30','2b000000-0000-4000-8000-0000000000a3','A C1 2h','Reunião com cliente','00000000-0000-4000-8000-000000000001','{}'),
 ('2b070000-0000-4000-8000-0000000000a5','Campolim Sala 2',current_date+51,'06:00','06:30','2b000000-0000-4000-8000-0000000000a5','A C3 2h','Reunião com cliente','00000000-0000-4000-8000-000000000001','{}'),
 ('2b070000-0000-4000-8000-0000000000a4','Campolim Sala 1',current_date+52,'06:00','06:30','2b000000-0000-4000-8000-0000000000a4','A C2 2h','Reunião com cliente','00000000-0000-4000-8000-000000000001','{}'),
 ('2b070000-0000-4000-8000-0000000000a6','Campolim Sala 2',current_date+52,'06:00','06:30','2b000000-0000-4000-8000-0000000000a6','A C4 2h','Reunião com cliente','00000000-0000-4000-8000-000000000001','{}'),
 ('2b070000-0000-4000-8000-0000000000a7','Campolim Sala 1',current_date+53,'06:00','06:30','2b000000-0000-4000-8000-0000000000a6','A C4 2h','Reunião com cliente','00000000-0000-4000-8000-000000000001','{2b000000-0000-4000-8000-0000000000a3}'),
 ('2b070000-0000-4000-8000-0000000000b2','Campolim Sala 1',current_date+50,'06:00','06:30','2b000000-0000-4000-8000-0000000000b2','B C 2h','Reunião com cliente','2b000000-0000-4000-8000-0000000000b0','{}');

-- Matriz: (ator, reserva, vê detalhe?, cancela?)
CREATE TABLE mt_2h_test.m (who text, u uuid, r text, rid uuid, ver boolean, can boolean);
INSERT INTO mt_2h_test.m
SELECT w.who, w.u::uuid, x.r, x.rid::uuid, x.ver, x.can
  FROM (VALUES
   -- gestor
   ('gestor','2b000000-0000-4000-8000-0000000000a1','propria','2b070000-0000-4000-8000-0000000000a1',true,true),
   ('gestor','2b000000-0000-4000-8000-0000000000a1','equipe(c1)','2b070000-0000-4000-8000-0000000000a3',true,true),
   ('gestor','2b000000-0000-4000-8000-0000000000a1','equipe-filha(c3)','2b070000-0000-4000-8000-0000000000a5',true,true),
   ('gestor','2b000000-0000-4000-8000-0000000000a1','outra equipe(c2)','2b070000-0000-4000-8000-0000000000a4',false,false),
   ('gestor','2b000000-0000-4000-8000-0000000000a1','do team leader','2b070000-0000-4000-8000-0000000000a2',false,false),
   ('gestor','2b000000-0000-4000-8000-0000000000a1','sem equipe(c4)','2b070000-0000-4000-8000-0000000000a6',false,false),
   ('gestor','2b000000-0000-4000-8000-0000000000a1','c4 com c1 participante','2b070000-0000-4000-8000-0000000000a7',false,false),
   ('gestor','2b000000-0000-4000-8000-0000000000a1','agencia B','2b070000-0000-4000-8000-0000000000b2',false,false),
   -- team leader
   ('team_leader','2b000000-0000-4000-8000-0000000000a2','propria','2b070000-0000-4000-8000-0000000000a2',true,true),
   ('team_leader','2b000000-0000-4000-8000-0000000000a2','equipe(c2)','2b070000-0000-4000-8000-0000000000a4',true,true),
   ('team_leader','2b000000-0000-4000-8000-0000000000a2','outra equipe(c1)','2b070000-0000-4000-8000-0000000000a3',false,false),
   ('team_leader','2b000000-0000-4000-8000-0000000000a2','do gestor','2b070000-0000-4000-8000-0000000000a1',false,false),
   ('team_leader','2b000000-0000-4000-8000-0000000000a2','sem equipe(c4)','2b070000-0000-4000-8000-0000000000a6',false,false),
   ('team_leader','2b000000-0000-4000-8000-0000000000a2','agencia B','2b070000-0000-4000-8000-0000000000b2',false,false),
   -- team leader da equipe-filha G2
   ('tl equipe-filha','2b000000-0000-4000-8000-0000000000aa','equipe(c3)','2b070000-0000-4000-8000-0000000000a5',true,true),
   ('tl equipe-filha','2b000000-0000-4000-8000-0000000000aa','equipe-mae(c1)','2b070000-0000-4000-8000-0000000000a3',false,false),
   ('tl equipe-filha','2b000000-0000-4000-8000-0000000000aa','do gestor da mae','2b070000-0000-4000-8000-0000000000a1',false,false),
   -- co-líder (team_leader) da equipe T
   ('co-lider','2b000000-0000-4000-8000-0000000000a7','equipe co-liderada(c2)','2b070000-0000-4000-8000-0000000000a4',true,true),
   ('co-lider','2b000000-0000-4000-8000-0000000000a7','outra equipe(c1)','2b070000-0000-4000-8000-0000000000a3',false,false),
   -- corretor
   ('corretor c1','2b000000-0000-4000-8000-0000000000a3','propria','2b070000-0000-4000-8000-0000000000a3',true,true),
   ('corretor c1','2b000000-0000-4000-8000-0000000000a3','participante (so ve)','2b070000-0000-4000-8000-0000000000a7',true,false),
   ('corretor c1','2b000000-0000-4000-8000-0000000000a3','colega c2','2b070000-0000-4000-8000-0000000000a4',false,false),
   ('corretor c1','2b000000-0000-4000-8000-0000000000a3','do gestor','2b070000-0000-4000-8000-0000000000a1',false,false),
   -- admin e staff: agência toda
   ('admin','2b000000-0000-4000-8000-0000000000a8','c2','2b070000-0000-4000-8000-0000000000a4',true,true),
   ('admin','2b000000-0000-4000-8000-0000000000a8','c4','2b070000-0000-4000-8000-0000000000a6',true,true),
   ('admin','2b000000-0000-4000-8000-0000000000a8','do gestor','2b070000-0000-4000-8000-0000000000a1',true,true),
   ('admin','2b000000-0000-4000-8000-0000000000a8','agencia B','2b070000-0000-4000-8000-0000000000b2',false,false),
   ('staff','2b000000-0000-4000-8000-0000000000a9','c1','2b070000-0000-4000-8000-0000000000a3',true,true),
   ('staff','2b000000-0000-4000-8000-0000000000a9','c4','2b070000-0000-4000-8000-0000000000a6',true,true),
   ('staff','2b000000-0000-4000-8000-0000000000a9','agencia B','2b070000-0000-4000-8000-0000000000b2',false,false),
   -- outra agência
   ('gestor B','2b000000-0000-4000-8000-0000000000b1','equipe B(cb)','2b070000-0000-4000-8000-0000000000b2',true,true),
   ('gestor B','2b000000-0000-4000-8000-0000000000b1','agencia A(c1)','2b070000-0000-4000-8000-0000000000a3',false,false),
   ('admin B','2b000000-0000-4000-8000-0000000000b3','agencia A(c2)','2b070000-0000-4000-8000-0000000000a4',false,false),
   ('admin B','2b000000-0000-4000-8000-0000000000b3','agencia A(gestor)','2b070000-0000-4000-8000-0000000000a1',false,false),
   ('corretor B','2b000000-0000-4000-8000-0000000000b2','agencia A(c1)','2b070000-0000-4000-8000-0000000000a3',false,false)
  ) x(who,u,r,rid,ver,can)
  CROSS JOIN LATERAL (SELECT x.who, x.u) w(who,u);
GRANT SELECT ON mt_2h_test.m TO authenticated;

DO $$ DECLARE t record; v boolean; c boolean; rpc text; upd text; g boolean; BEGIN
  FOR t IN SELECT * FROM mt_2h_test.m LOOP
    PERFORM mt_2h_test.as_user(t.u);
    v := mt_2h_test.sees(t.rid);
    c := (SELECT public.can_cancel_room_reservation(r.responsible_id) FROM public.room_reservations r WHERE r.id = t.rid);
    rpc := mt_2h_test.cancel(t.rid);
    upd := mt_2h_test.dry_upd(t.rid);
    g := mt_2h_test.grid(t.rid);
    RESET ROLE;
    PERFORM mt_2h_test.check(format('%s | %s: ve detalhe=%s', t.who, t.r, t.ver), v = t.ver);
    PERFORM mt_2h_test.check(format('%s | %s: botao cancelar=%s', t.who, t.r, t.can), coalesce(c, false) = t.can);
    PERFORM mt_2h_test.check(format('%s | %s: RPC cancelar=%s', t.who, t.r, t.can), (rpc = 'ok') = t.can);
    PERFORM mt_2h_test.check(format('%s | %s: UPDATE direto=%s', t.who, t.r, t.can), (upd = 'ok:1') = t.can);
    -- Grade: toda a própria agência aparece (quem reservou + horário); nada da outra.
    PERFORM mt_2h_test.check(format('%s | %s: grade de ocupacao=%s', t.who, t.r, t.r NOT LIKE 'agencia%'),
      g = (t.r NOT LIKE 'agencia%'));
  END LOOP;
END $$;

-- Função chamada com o responsável de outra agência por RPC direta: false (não NULL).
SELECT mt_2h_test.as_user('2b000000-0000-4000-8000-0000000000a1');
SELECT mt_2h_test.check('gestor A: can_cancel com responsavel de B devolve false',
  public.can_cancel_room_reservation('2b000000-0000-4000-8000-0000000000b2') IS FALSE);
SELECT mt_2h_test.check('gestor A: can_view com responsavel de B devolve false',
  public.can_view_room_reservation('2b000000-0000-4000-8000-0000000000b2', '{}') IS FALSE);
RESET ROLE;
-- Estrutura: anon sem EXECUTE; policies intactas; backup presente.
SELECT mt_2h_test.check('anon sem EXECUTE nas funcoes de reserva',
  NOT has_function_privilege('anon','public.can_cancel_room_reservation(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.can_view_room_reservation(uuid,uuid[],uuid)','EXECUTE'));
SELECT mt_2h_test.check('org_isolation RESTRICTIVE continua em room_reservations',
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename='room_reservations' AND policyname='org_isolation' AND permissive='RESTRICTIVE'));
SELECT mt_2h_test.check('backup 2h presente (rollback possivel)', to_regclass('public.mt_2h_backup') IS NOT NULL);

SELECT set_config('request.jwt.claims','',true);
SELECT 'FALHA: ' || label FROM mt_2h_test.results WHERE NOT ok ORDER BY n;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM mt_2h_test.results;
ROLLBACK;
