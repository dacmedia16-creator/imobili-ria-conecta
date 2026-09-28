-- Ensaio 2e: decisões de Denis (28/09/2026) sobre perfis.
--  * Financeiro edita todas as vendas e comissões da agência (confirmação, sem mudança).
--  * Team Leader = Gestor: cancelar/ver reserva de qualquer pessoa da agência e ler vínculos da agência.
--  * Staff cancela reserva de qualquer pessoa da agência (confirmação, sem mudança).
--  * Excluir venda: só em 'rascunho' e só quem pode editar aquela venda; nas demais etapas, só cancelar.
--  * Cancelar venda: NÃO muda; o levantamento sai nas linhas 'CANCEL:' (sem asserção).
-- Tudo em transação + ROLLBACK; tentativas de escrita rodam em subtransação desfeita (nada persiste).
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA mt_2e_test;
CREATE TABLE mt_2e_test.results (n serial, label text, ok boolean);
GRANT USAGE ON SCHEMA mt_2e_test TO service_role, authenticated;
GRANT ALL ON mt_2e_test.results TO service_role, authenticated;
GRANT ALL ON SEQUENCE mt_2e_test.results_n_seq TO service_role, authenticated;
CREATE FUNCTION mt_2e_test.check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO mt_2e_test.results(label,ok) VALUES(label,coalesce(ok,false)) $$;
CREATE FUNCTION mt_2e_test.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 PERFORM set_config('role','authenticated',true); END $$;
-- Executa SQL de escrita e DESFAZ: devolve 'ok:<linhas>' ou 'erro:<SQLSTATE>'.
CREATE FUNCTION mt_2e_test.dry(q text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE n bigint; BEGIN
  BEGIN
   EXECUTE q; GET DIAGNOSTICS n = ROW_COUNT;
   RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = n::text;
  EXCEPTION WHEN SQLSTATE 'P0999' THEN RETURN 'ok:' || SQLERRM;
   WHEN OTHERS THEN RETURN 'erro:' || SQLSTATE; END;
 END $$;
-- Mesma ideia para SELECT de função com efeito (RPC): 'ok' ou 'erro:<SQLSTATE>'.
CREATE FUNCTION mt_2e_test.dry_rpc(q text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN
  BEGIN
   EXECUTE q;
   RAISE EXCEPTION USING ERRCODE = 'P0999';
  EXCEPTION WHEN SQLSTATE 'P0999' THEN RETURN 'ok';
   WHEN OTHERS THEN RETURN 'erro:' || SQLSTATE; END;
 END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mt_2e_test TO service_role, authenticated;

-- ---------- Preparação (dados sintéticos) ----------
-- Agência A (histórica): gestor g (lidera equipe 1 com corretor c1), team_leader tl (lidera equipe 2
-- com corretor c2), financeiro f, staff s, admin ad, jurídico j. Agência B: gestor gb, corretor cb,
-- financeiro fb, staff sb.
INSERT INTO public.organizations(id,slug,nome) VALUES
 ('2e000000-0000-4000-8000-0000000000b0','mt-2e-b','Agencia B 2e');
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('2e000000-0000-4000-8000-0000000000a1','g.2e@example.test','{"nome":"A Gestor"}','{}'),
 ('2e000000-0000-4000-8000-0000000000a2','tl.2e@example.test','{"nome":"A Team Leader"}','{}'),
 ('2e000000-0000-4000-8000-0000000000a3','c1.2e@example.test','{"nome":"A Corretor 1"}','{}'),
 ('2e000000-0000-4000-8000-0000000000a4','c2.2e@example.test','{"nome":"A Corretor 2"}','{}'),
 ('2e000000-0000-4000-8000-0000000000a5','f.2e@example.test','{"nome":"A Financeiro"}','{}'),
 ('2e000000-0000-4000-8000-0000000000a6','s.2e@example.test','{"nome":"A Staff"}','{}'),
 ('2e000000-0000-4000-8000-0000000000a7','ad.2e@example.test','{"nome":"A Admin"}','{}'),
 ('2e000000-0000-4000-8000-0000000000a8','j.2e@example.test','{"nome":"A Juridico"}','{}'),
 ('2e000000-0000-4000-8000-0000000000b1','gb.2e@example.test','{"nome":"B Gestor"}','{"organization_id":"2e000000-0000-4000-8000-0000000000b0"}'),
 ('2e000000-0000-4000-8000-0000000000b2','cb.2e@example.test','{"nome":"B Corretor"}','{"organization_id":"2e000000-0000-4000-8000-0000000000b0"}'),
 ('2e000000-0000-4000-8000-0000000000b3','fb.2e@example.test','{"nome":"B Financeiro"}','{"organization_id":"2e000000-0000-4000-8000-0000000000b0"}'),
 ('2e000000-0000-4000-8000-0000000000b4','sb.2e@example.test','{"nome":"B Staff"}','{"organization_id":"2e000000-0000-4000-8000-0000000000b0"}');
INSERT INTO public.user_roles(user_id,role) VALUES
 ('2e000000-0000-4000-8000-0000000000a1','gestor'),
 ('2e000000-0000-4000-8000-0000000000a2','team_leader'),
 ('2e000000-0000-4000-8000-0000000000a5','financeiro'),
 ('2e000000-0000-4000-8000-0000000000a6','staff'),
 ('2e000000-0000-4000-8000-0000000000a7','admin'),
 ('2e000000-0000-4000-8000-0000000000a8','juridico'),
 ('2e000000-0000-4000-8000-0000000000b1','gestor'),
 ('2e000000-0000-4000-8000-0000000000b3','financeiro'),
 ('2e000000-0000-4000-8000-0000000000b4','staff');
INSERT INTO public.teams(id,lider_id,nome,organization_id) VALUES
 ('2e0a0000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-0000000000a1','Equipe 1 2e','00000000-0000-4000-8000-000000000001'),
 ('2e0a0000-0000-4000-8000-000000000002','2e000000-0000-4000-8000-0000000000a2','Equipe 2 2e','00000000-0000-4000-8000-000000000001'),
 ('2e0a0000-0000-4000-8000-0000000000b1','2e000000-0000-4000-8000-0000000000b1','Equipe B 2e','2e000000-0000-4000-8000-0000000000b0');
INSERT INTO public.team_members(team_id,membro_id,tipo) VALUES
 ('2e0a0000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-0000000000a3','corretor'),
 ('2e0a0000-0000-4000-8000-000000000002','2e000000-0000-4000-8000-0000000000a4','corretor'),
 ('2e0a0000-0000-4000-8000-0000000000b1','2e000000-0000-4000-8000-0000000000b2','corretor');

-- Reservas (sala/horário distintos): c1 (equipe 1), c2 (equipe 2), cb (agência B).
INSERT INTO public.room_reservations(id,room,reserved_date,start_time,end_time,responsible_id,responsible_name,purpose,organization_id) VALUES
 ('2e070000-0000-4000-8000-0000000000a3','Barão Sala 1',current_date+40,'08:00','09:00','2e000000-0000-4000-8000-0000000000a3','A Corretor 1','Reunião com cliente','00000000-0000-4000-8000-000000000001'),
 ('2e070000-0000-4000-8000-0000000000a4','Barão Sala 2',current_date+40,'08:00','09:00','2e000000-0000-4000-8000-0000000000a4','A Corretor 2','Reunião com cliente','00000000-0000-4000-8000-000000000001'),
 ('2e070000-0000-4000-8000-0000000000b2','Barão Sala 1',current_date+40,'08:00','09:00','2e000000-0000-4000-8000-0000000000b2','B Corretor','Reunião com cliente','2e000000-0000-4000-8000-0000000000b0');

-- Vendas de c1 (equipe do gestor g) em várias etapas; uma venda de B.
-- s-rasc também tem c2 como corretor vendedor (participante).
INSERT INTO public.sales(id,corretor_id,corretor_vendedor_id,imovel_id,status,organization_id) VALUES
 ('2e050000-0000-4000-8000-000000000001','2e000000-0000-4000-8000-0000000000a3','2e000000-0000-4000-8000-0000000000a4','2E-RASC','rascunho','00000000-0000-4000-8000-000000000001'),
 ('2e050000-0000-4000-8000-000000000002','2e000000-0000-4000-8000-0000000000a3',NULL,'2E-DEVOL','devolvida_ajuste','00000000-0000-4000-8000-000000000001'),
 ('2e050000-0000-4000-8000-000000000003','2e000000-0000-4000-8000-0000000000a3',NULL,'2E-REV','enviada_revisao','00000000-0000-4000-8000-000000000001'),
 ('2e050000-0000-4000-8000-000000000004','2e000000-0000-4000-8000-0000000000a3',NULL,'2E-APROV','aprovada_gestor','00000000-0000-4000-8000-000000000001'),
 ('2e050000-0000-4000-8000-000000000005','2e000000-0000-4000-8000-0000000000a3',NULL,'2E-OCPEND','ocorrencia_pendente','00000000-0000-4000-8000-000000000001'),
 ('2e050000-0000-4000-8000-000000000006','2e000000-0000-4000-8000-0000000000a3',NULL,'2E-CONCL','ocorrencia_concluida','00000000-0000-4000-8000-000000000001'),
 ('2e050000-0000-4000-8000-0000000000b1','2e000000-0000-4000-8000-0000000000b2',NULL,'2E-B-RASC','rascunho','2e000000-0000-4000-8000-0000000000b0');

-- ---------- 1. Financeiro edita todas as vendas e comissões da agência (sem mudança) ----------
SELECT mt_2e_test.as_user('2e000000-0000-4000-8000-0000000000a5');
SELECT mt_2e_test.check('financeiro: edita venda em ' || v.st || ' (UPDATE 1 linha)',
  mt_2e_test.dry(format('UPDATE public.sales SET observacoes_gerais = %L WHERE id = %L', 'fin-2e', v.id)) = 'ok:1')
  FROM (VALUES ('rascunho','2e050000-0000-4000-8000-000000000001'),('devolvida_ajuste','2e050000-0000-4000-8000-000000000002'),
               ('enviada_revisao','2e050000-0000-4000-8000-000000000003'),('ocorrencia_pendente','2e050000-0000-4000-8000-000000000005'),
               ('ocorrencia_concluida','2e050000-0000-4000-8000-000000000006')) v(st,id);
SELECT mt_2e_test.check('financeiro: pode editar comissao em ' || v.st,
  public.can_edit_sale_comissao('2e000000-0000-4000-8000-0000000000a5', v.id::uuid))
  FROM (VALUES ('rascunho','2e050000-0000-4000-8000-000000000001'),('devolvida_ajuste','2e050000-0000-4000-8000-000000000002'),
               ('ocorrencia_pendente','2e050000-0000-4000-8000-000000000005'),('ocorrencia_concluida','2e050000-0000-4000-8000-000000000006')) v(st,id);
SELECT mt_2e_test.check('financeiro: grava divisao de comissao (sale_commission_extras) de venda alheia',
  mt_2e_test.dry($$INSERT INTO public.sale_commission_extras(sale_id,papel,nome,valor) VALUES
    ('2e050000-0000-4000-8000-000000000003','outro','Parceiro 2e',100)$$) = 'ok:1');
SELECT mt_2e_test.check('financeiro A: NAO edita venda da agencia B',
  mt_2e_test.dry($$UPDATE public.sales SET observacoes_gerais='x' WHERE id='2e050000-0000-4000-8000-0000000000b1'$$) = 'ok:0');
RESET ROLE;
SELECT mt_2e_test.as_user('2e000000-0000-4000-8000-0000000000b3');
SELECT mt_2e_test.check('financeiro B: NAO edita comissao de venda A',
  NOT public.can_edit_sale_comissao('2e000000-0000-4000-8000-0000000000b3', '2e050000-0000-4000-8000-000000000003'));
RESET ROLE;

-- ---------- 2. Team Leader = Gestor (reservas e vínculos da agência) ----------
SELECT mt_2e_test.as_user('2e000000-0000-4000-8000-0000000000a1');
SELECT mt_2e_test.check('gestor: cancela reserva de outra equipe (antes e depois)',
  public.can_cancel_room_reservation('2e000000-0000-4000-8000-0000000000a4'));
SELECT mt_2e_test.check('gestor: NAO cancela reserva da agencia B',
  NOT public.can_cancel_room_reservation('2e000000-0000-4000-8000-0000000000b2'));
SELECT mt_2e_test.check('gestor: le vinculos da propria agencia',
  (SELECT count(*) FROM public.organization_members WHERE user_id::text LIKE '2e000000-%-0000000000a%') = 8);
RESET ROLE;
SELECT mt_2e_test.as_user('2e000000-0000-4000-8000-0000000000a2');
SELECT mt_2e_test.check('team_leader: cancela reserva da propria equipe',
  public.can_cancel_room_reservation('2e000000-0000-4000-8000-0000000000a4'));
SELECT mt_2e_test.check('team_leader: cancela reserva de OUTRA equipe (igual gestor)',
  public.can_cancel_room_reservation('2e000000-0000-4000-8000-0000000000a3'));
SELECT mt_2e_test.check('team_leader: RPC cancel_room_reservation de outra equipe funciona',
  mt_2e_test.dry_rpc($$SELECT * FROM public.cancel_room_reservation('2e070000-0000-4000-8000-0000000000a3')$$) = 'ok');
SELECT mt_2e_test.check('team_leader: ve detalhes da reserva de outra equipe (igual gestor)',
  (SELECT count(*) FROM public.room_reservations WHERE id = '2e070000-0000-4000-8000-0000000000a3') = 1);
SELECT mt_2e_test.check('team_leader: le vinculos da propria agencia (igual gestor)',
  (SELECT count(*) FROM public.organization_members WHERE user_id::text LIKE '2e000000-%-0000000000a%') = 8);
SELECT mt_2e_test.check('team_leader: NAO le vinculos da agencia B',
  (SELECT count(*) FROM public.organization_members WHERE organization_id = '2e000000-0000-4000-8000-0000000000b0') = 0);
SELECT mt_2e_test.check('team_leader: NAO cancela reserva da agencia B',
  NOT public.can_cancel_room_reservation('2e000000-0000-4000-8000-0000000000b2'));
SELECT mt_2e_test.check('team_leader: RPC nao cancela reserva da agencia B',
  mt_2e_test.dry_rpc($$SELECT * FROM public.cancel_room_reservation('2e070000-0000-4000-8000-0000000000b2')$$) <> 'ok');
RESET ROLE;
-- Gestor e team_leader da agência B também não atravessam para A.
SELECT mt_2e_test.as_user('2e000000-0000-4000-8000-0000000000b1');
SELECT mt_2e_test.check('gestor B: NAO cancela reserva de A',
  NOT public.can_cancel_room_reservation('2e000000-0000-4000-8000-0000000000a3'));
SELECT mt_2e_test.check('gestor B: NAO le vinculos de A',
  (SELECT count(*) FROM public.organization_members WHERE organization_id = '00000000-0000-4000-8000-000000000001') = 0);
RESET ROLE;
SELECT mt_2e_test.as_user('2e000000-0000-4000-8000-0000000000a3');
SELECT mt_2e_test.check('corretor: continua sem cancelar reserva de outra pessoa',
  NOT public.can_cancel_room_reservation('2e000000-0000-4000-8000-0000000000a4'));
SELECT mt_2e_test.check('corretor: continua vendo so o proprio vinculo',
  (SELECT count(*) FROM public.organization_members WHERE user_id::text LIKE '2e000000-%') = 1);
RESET ROLE;

-- ---------- 3. Staff cancela reserva de qualquer pessoa da agência (sem mudança) ----------
SELECT mt_2e_test.as_user('2e000000-0000-4000-8000-0000000000a6');
SELECT mt_2e_test.check('staff: cancela reserva da equipe 1',
  public.can_cancel_room_reservation('2e000000-0000-4000-8000-0000000000a3'));
SELECT mt_2e_test.check('staff: cancela reserva da equipe 2',
  public.can_cancel_room_reservation('2e000000-0000-4000-8000-0000000000a4'));
SELECT mt_2e_test.check('staff: RPC cancel_room_reservation funciona',
  mt_2e_test.dry_rpc($$SELECT * FROM public.cancel_room_reservation('2e070000-0000-4000-8000-0000000000a4')$$) = 'ok');
SELECT mt_2e_test.check('staff A: NAO cancela reserva da agencia B',
  NOT public.can_cancel_room_reservation('2e000000-0000-4000-8000-0000000000b2'));
RESET ROLE;

-- ---------- 4. Excluir venda: só rascunho, só quem edita ----------
CREATE FUNCTION mt_2e_test.del(u uuid, sale uuid) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE r text; BEGIN
  PERFORM mt_2e_test.as_user(u);
  r := mt_2e_test.dry(format('DELETE FROM public.sales WHERE id = %L', sale));
  RESET ROLE; RETURN r; END $$;
-- Rascunho: quem edita exclui.
SELECT mt_2e_test.check('rascunho: dono exclui',
  mt_2e_test.del('2e000000-0000-4000-8000-0000000000a3','2e050000-0000-4000-8000-000000000001') = 'ok:1');
SELECT mt_2e_test.check('rascunho: gestor lider da equipe exclui',
  mt_2e_test.del('2e000000-0000-4000-8000-0000000000a1','2e050000-0000-4000-8000-000000000001') = 'ok:1');
-- A 2f (decisão final de Denis) tira o financeiro da exclusão; com a 2f aplicada, espera-se recusa.
SELECT mt_2e_test.check('rascunho: financeiro exclui (2e) / NAO exclui (com 2f)',
  mt_2e_test.del('2e000000-0000-4000-8000-0000000000a5','2e050000-0000-4000-8000-000000000001')
    = CASE WHEN to_regclass('public.mt_2f_backup') IS NULL THEN 'ok:1' ELSE 'ok:0' END);
SELECT mt_2e_test.check('rascunho: admin exclui',
  mt_2e_test.del('2e000000-0000-4000-8000-0000000000a7','2e050000-0000-4000-8000-000000000001') = 'ok:1');
-- Rascunho: quem não edita não exclui.
SELECT mt_2e_test.check('rascunho: team_leader de outra equipe NAO exclui',
  mt_2e_test.del('2e000000-0000-4000-8000-0000000000a2','2e050000-0000-4000-8000-000000000001') = 'ok:0');
SELECT mt_2e_test.check('rascunho: participante que nao edita NAO exclui',
  mt_2e_test.del('2e000000-0000-4000-8000-0000000000a4','2e050000-0000-4000-8000-000000000001') = 'ok:0');
SELECT mt_2e_test.check('rascunho: staff NAO exclui',
  mt_2e_test.del('2e000000-0000-4000-8000-0000000000a6','2e050000-0000-4000-8000-000000000001') = 'ok:0');
SELECT mt_2e_test.check('rascunho: gestor da agencia B NAO exclui venda de A',
  mt_2e_test.del('2e000000-0000-4000-8000-0000000000b1','2e050000-0000-4000-8000-000000000001') = 'ok:0');
SELECT mt_2e_test.check('rascunho: financeiro de A NAO exclui venda de B',
  mt_2e_test.del('2e000000-0000-4000-8000-0000000000a5','2e050000-0000-4000-8000-0000000000b1') = 'ok:0');
-- Demais etapas: ninguém exclui (só cancelar).
SELECT mt_2e_test.check(v.st || ': ' || v.who || ' NAO exclui (so cancelar)',
  mt_2e_test.del(v.u::uuid, v.sale::uuid) = 'ok:0')
  FROM (VALUES
   ('devolvida_ajuste','dono','2e000000-0000-4000-8000-0000000000a3','2e050000-0000-4000-8000-000000000002'),
   ('devolvida_ajuste','gestor lider','2e000000-0000-4000-8000-0000000000a1','2e050000-0000-4000-8000-000000000002'),
   ('devolvida_ajuste','financeiro','2e000000-0000-4000-8000-0000000000a5','2e050000-0000-4000-8000-000000000002'),
   ('devolvida_ajuste','admin','2e000000-0000-4000-8000-0000000000a7','2e050000-0000-4000-8000-000000000002'),
   ('enviada_revisao','dono','2e000000-0000-4000-8000-0000000000a3','2e050000-0000-4000-8000-000000000003'),
   ('enviada_revisao','gestor lider','2e000000-0000-4000-8000-0000000000a1','2e050000-0000-4000-8000-000000000003'),
   ('enviada_revisao','financeiro','2e000000-0000-4000-8000-0000000000a5','2e050000-0000-4000-8000-000000000003'),
   ('enviada_revisao','admin','2e000000-0000-4000-8000-0000000000a7','2e050000-0000-4000-8000-000000000003'),
   ('aprovada_gestor','admin','2e000000-0000-4000-8000-0000000000a7','2e050000-0000-4000-8000-000000000004'),
   ('ocorrencia_concluida','financeiro','2e000000-0000-4000-8000-0000000000a5','2e050000-0000-4000-8000-000000000006')
  ) v(st,who,u,sale);
SELECT mt_2e_test.check('policy de DELETE em sales continua so para authenticated e com org_isolation',
  EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sales' AND policyname='delete_sales_por_papel' AND roles='{authenticated}')
  AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sales' AND policyname='org_isolation' AND permissive='RESTRICTIVE'));

-- ---------- 5. Cancelar venda: levantamento (sem asserção; não muda nesta fase) ----------
-- Cada tentativa chama change_sale_status(...,'cancelada', motivo) e é desfeita.
CREATE TABLE mt_2e_test.cancel (st text, who text, r text);
GRANT ALL ON mt_2e_test.cancel TO authenticated;
DO $$ DECLARE st text; w record; sid uuid; r text; i int := 0; BEGIN
  FOR st IN SELECT unnest(enum_range(NULL::public.sale_status))::text EXCEPT SELECT unnest(ARRAY['cancelada','arquivada']) LOOP
    i := i + 1;
    sid := ('2e05ffff-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    INSERT INTO public.sales(id,corretor_id,imovel_id,status,organization_id)
      VALUES (sid,'2e000000-0000-4000-8000-0000000000a3','2E-CANC-' || st, st::public.sale_status,'00000000-0000-4000-8000-000000000001');
    FOR w IN SELECT * FROM (VALUES ('dono(corretor)','2e000000-0000-4000-8000-0000000000a3'),
        ('gestor lider','2e000000-0000-4000-8000-0000000000a1'),('team_leader outra equipe','2e000000-0000-4000-8000-0000000000a2'),
        ('financeiro','2e000000-0000-4000-8000-0000000000a5'),('juridico','2e000000-0000-4000-8000-0000000000a8'),
        ('staff','2e000000-0000-4000-8000-0000000000a6'),('admin','2e000000-0000-4000-8000-0000000000a7')) x(who,u) LOOP
      PERFORM mt_2e_test.as_user(w.u::uuid);
      r := mt_2e_test.dry_rpc(format('SELECT public.change_sale_status(%L,%L,%L)', sid, 'cancelada', 'teste 2e'));
      RESET ROLE;
      INSERT INTO mt_2e_test.cancel VALUES (st, w.who, r);
    END LOOP;
  END LOOP;
END $$;
SELECT 'CANCEL: ' || st || ' => ' || string_agg(who || '=' || CASE r WHEN 'ok' THEN 'SIM' WHEN 'erro:42501' THEN 'nao' ELSE r END, '; ' ORDER BY who)
  FROM mt_2e_test.cancel GROUP BY st ORDER BY st;

SELECT set_config('request.jwt.claims','',true);
SELECT 'FALHA: ' || label FROM mt_2e_test.results WHERE NOT ok ORDER BY n;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM mt_2e_test.results;
ROLLBACK;
