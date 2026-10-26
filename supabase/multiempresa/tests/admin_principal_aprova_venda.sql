-- t_c6638199 (Denis 26/10/2026): Administrador principal (super_admin DA IMOBILIÁRIA) cobre sozinho as
-- etapas de gestor e de jurídico da venda. Agência A sem gestor e sem jurídico (super_admin + corretor);
-- agência B com super_admin próprio. Tudo em transação + ROLLBACK (nada persiste).
-- Os gatilhos de completude da venda (endereço, ficha, mídia, pagamento, distribuição…) são desligados
-- DENTRO da transação: aqui se testa PERMISSÃO, não preenchimento. O validate_sale_status_transition
-- (quem pode mudar de etapa) continua LIGADO.
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA ap_test;
CREATE TABLE ap_test.results (n serial, label text, ok boolean);
GRANT USAGE ON SCHEMA ap_test TO authenticated;
GRANT ALL ON ap_test.results TO authenticated;
GRANT ALL ON SEQUENCE ap_test.results_n_seq TO authenticated;
CREATE FUNCTION ap_test.check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO ap_test.results(label,ok) VALUES(label,coalesce(ok,false)) $$;
-- Executa como usuário e MANTÉM o efeito: 'ok' ou 'erro:<SQLSTATE>'.
CREATE FUNCTION ap_test.run(u uuid, q text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE r text; BEGIN
  PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  BEGIN EXECUTE q; r := 'ok';
  EXCEPTION WHEN OTHERS THEN r := 'erro:' || SQLSTATE; END;
  RESET ROLE; PERFORM set_config('request.jwt.claims','',true); RETURN r; END $$;
-- Valor de uma expressão como usuário.
CREATE FUNCTION ap_test.val(u uuid, q text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE r text; BEGIN
  PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  BEGIN EXECUTE q INTO r; EXCEPTION WHEN OTHERS THEN r := 'erro:' || SQLSTATE; END;
  RESET ROLE; PERFORM set_config('request.jwt.claims','',true); RETURN r; END $$;
CREATE FUNCTION ap_test.st(u uuid, sale uuid, para text, motivo text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT ap_test.run(u, format('SELECT public.change_sale_status(%L,%L,%L)', sale, para, motivo)) $$;
CREATE FUNCTION ap_test.status(sale uuid) RETURNS text LANGUAGE sql AS $$
 SELECT status::text FROM public.sales WHERE id = sale $$;
-- Função volátil: enxerga o que o ap_test.run do mesmo SELECT acabou de gravar.
CREATE FUNCTION ap_test.doc(d uuid) RETURNS text LANGUAGE sql AS $$
 SELECT status::text FROM public.sale_documents WHERE id = d $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ap_test TO authenticated;

ALTER TABLE public.sales DISABLE TRIGGER trg_bloquear_avanco_a_midia;
ALTER TABLE public.sales DISABLE TRIGGER trg_bloquear_avanco_com_previsao_incompleta;
ALTER TABLE public.sales DISABLE TRIGGER trg_bloquear_avanco_sem_endereco;
ALTER TABLE public.sales DISABLE TRIGGER trg_bloquear_avanco_sem_ficha_imovel;
ALTER TABLE public.sales DISABLE TRIGGER trg_bloquear_pagamento_inconsistente;
ALTER TABLE public.sales DISABLE TRIGGER trg_bloquear_participante_sem_cadastro;
ALTER TABLE public.sales DISABLE TRIGGER trg_bloquear_valor_negociado_inconsistente;
ALTER TABLE public.sales DISABLE TRIGGER trg_validar_distribuicao_aprovar_gestor;

-- ---------- Preparação ----------
INSERT INTO public.organizations(id,slug,nome) VALUES
 ('ac000000-0000-4000-8000-0000000000a0','ap-a','Agencia A sem gestor'),
 ('ac000000-0000-4000-8000-0000000000b0','ap-b','Agencia B');
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('ac000000-0000-4000-8000-0000000000a1','sa.ap@example.test','{"nome":"Ana Administradora"}','{"organization_id":"ac000000-0000-4000-8000-0000000000a0"}'),
 ('ac000000-0000-4000-8000-0000000000a2','c.ap@example.test','{"nome":"Carlos Corretor"}','{"organization_id":"ac000000-0000-4000-8000-0000000000a0"}'),
 ('ac000000-0000-4000-8000-0000000000a3','ad.ap@example.test','{"nome":"Admin Comum A"}','{"organization_id":"ac000000-0000-4000-8000-0000000000a0"}'),
 ('ac000000-0000-4000-8000-0000000000a4','g.ap@example.test','{"nome":"Gestor A"}','{"organization_id":"ac000000-0000-4000-8000-0000000000a0"}'),
 ('ac000000-0000-4000-8000-0000000000a5','j.ap@example.test','{"nome":"Juridico A"}','{"organization_id":"ac000000-0000-4000-8000-0000000000a0"}'),
 ('ac000000-0000-4000-8000-0000000000b1','sb.ap@example.test','{"nome":"Bruno Admin B"}','{"organization_id":"ac000000-0000-4000-8000-0000000000b0"}');
DELETE FROM public.user_roles WHERE user_id::text LIKE 'ac000000-%';
INSERT INTO public.user_roles(user_id,role,organization_id) VALUES
 ('ac000000-0000-4000-8000-0000000000a1','super_admin','ac000000-0000-4000-8000-0000000000a0'),
 ('ac000000-0000-4000-8000-0000000000a2','corretor','ac000000-0000-4000-8000-0000000000a0'),
 ('ac000000-0000-4000-8000-0000000000a3','admin','ac000000-0000-4000-8000-0000000000a0'),
 ('ac000000-0000-4000-8000-0000000000b1','super_admin','ac000000-0000-4000-8000-0000000000b0');
-- A agência A fica SEM gestor e SEM jurídico no fluxo principal: os usuários a4/a5 só ganham esses
-- papéis no bloco de não-regressão, no fim.

INSERT INTO public.sales(id,corretor_id,corretor_vendedor_id,imovel_id,status,organization_id,modalidade) VALUES
 ('ac050000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000a2','ac000000-0000-4000-8000-0000000000a2','AP-1','enviada_revisao','ac000000-0000-4000-8000-0000000000a0','padrao'),
 ('ac050000-0000-4000-8000-000000000002','ac000000-0000-4000-8000-0000000000a2','ac000000-0000-4000-8000-0000000000a2','AP-2','enviada_revisao','ac000000-0000-4000-8000-0000000000a0','padrao');
INSERT INTO public.sale_documents(id,sale_id,tipo,parte,storage_path,file_name,uploaded_by,organization_id) VALUES
 ('ac0d0000-0000-4000-8000-000000000001','ac050000-0000-4000-8000-000000000001','rg','comprador_1','ac050000-0000-4000-8000-000000000001/comprador_1/rg/x.pdf','rg.pdf','ac000000-0000-4000-8000-0000000000a2','ac000000-0000-4000-8000-0000000000a0'),
 ('ac0d0000-0000-4000-8000-000000000002','ac050000-0000-4000-8000-000000000001','cpf','comprador_1','ac050000-0000-4000-8000-000000000001/comprador_1/cpf/x.pdf','cpf.pdf','ac000000-0000-4000-8000-0000000000a2','ac000000-0000-4000-8000-0000000000a0');

\set A1 '''ac000000-0000-4000-8000-0000000000a1'''
\set C  '''ac000000-0000-4000-8000-0000000000a2'''
\set AD '''ac000000-0000-4000-8000-0000000000a3'''
\set B1 '''ac000000-0000-4000-8000-0000000000b1'''
\set S1 '''ac050000-0000-4000-8000-000000000001'''
\set S2 '''ac050000-0000-4000-8000-000000000002'''

-- ---------- Capacidades (o que a tela usa) ----------
SELECT ap_test.check('caps: Administrador principal A pode gerir a venda (can_manage/can_edit)',
  ap_test.val(:A1, format('SELECT (public.sale_management_capabilities(%L)->>''can_manage'')||(public.sale_management_capabilities(%L)->>''can_edit'')', :S1, :S1)) = 'truetrue');
SELECT ap_test.check('caps: corretor NÃO gere',
  ap_test.val(:C, format('SELECT public.sale_management_capabilities(%L)->>''can_manage''', :S1)) = 'false');
SELECT ap_test.check('caps: admin comum continua sem capability de gestor (sem mudança)',
  ap_test.val(:AD, format('SELECT public.sale_management_capabilities(%L)->>''can_manage''', :S1)) = 'false');
SELECT ap_test.check('caps: Administrador principal da OUTRA imobiliária (B) NÃO gere venda da A',
  ap_test.val(:B1, format('SELECT public.sale_management_capabilities(%L)->>''can_manage''', :S1)) = 'false');

-- ---------- Documentos (aprovar/devolver) ----------
SELECT ap_test.check('docs: corretor NÃO aprova documento (status segue pendente)',
  ap_test.run(:C, $q$UPDATE public.sale_documents SET status='aprovado' WHERE id='ac0d0000-0000-4000-8000-000000000001'$q$) IS NOT NULL
  AND ap_test.doc('ac0d0000-0000-4000-8000-000000000001') = 'pendente');
SELECT ap_test.check('docs: admin da B NÃO aprova documento da A',
  ap_test.run(:B1, $q$UPDATE public.sale_documents SET status='aprovado' WHERE id='ac0d0000-0000-4000-8000-000000000001'$q$) IS NOT NULL
  AND ap_test.doc('ac0d0000-0000-4000-8000-000000000001') = 'pendente');
SELECT ap_test.check('docs: Administrador principal aprova documento',
  ap_test.run(:A1, $q$UPDATE public.sale_documents SET status='aprovado' WHERE id='ac0d0000-0000-4000-8000-000000000001'$q$) = 'ok'
  AND ap_test.doc('ac0d0000-0000-4000-8000-000000000001') = 'aprovado');
SELECT ap_test.check('docs: Administrador principal devolve (recusa) documento com motivo',
  ap_test.run(:A1, $q$UPDATE public.sale_documents SET status='recusado', motivo_recusa='ilegível' WHERE id='ac0d0000-0000-4000-8000-000000000002'$q$) = 'ok'
  AND ap_test.doc('ac0d0000-0000-4000-8000-000000000002') = 'recusado');

-- ---------- Etapas: corretor e outra imobiliária barrados ----------
SELECT ap_test.check('etapa: corretor NÃO aprova p/ jurídico', ap_test.st(:C, :S1, 'aprovada_gestor') <> 'ok' AND ap_test.status(:S1) = 'enviada_revisao');
SELECT ap_test.check('etapa: admin da B NÃO aprova venda da A', ap_test.st(:B1, :S1, 'aprovada_gestor') <> 'ok' AND ap_test.status(:S1) = 'enviada_revisao');

-- ---------- Devolver para ajuste (venda 2) ----------
SELECT ap_test.check('etapa: Administrador principal devolve p/ ajuste', ap_test.st(:A1, :S2, 'devolvida_ajuste', 'faltou documento') = 'ok' AND ap_test.status(:S2) = 'devolvida_ajuste');

-- ---------- Fluxo completo gestor + jurídico pelo Administrador principal (venda 1) ----------
SELECT ap_test.check('fluxo: enviada_revisao → aprovada_gestor (Aprovar p/ jurídico)', ap_test.st(:A1, :S1, 'aprovada_gestor') = 'ok');
SELECT ap_test.check('jurídico: Administrador principal lê/sobe certidão do jurídico',
  ap_test.val(:A1, format('SELECT public.can_read_sale_juridico_certidao(%L)::text || public.can_upload_juridico_certidao(%L)::text', :S1, :S1)) = 'truetrue');
SELECT ap_test.check('jurídico: corretor NÃO sobe certidão do jurídico',
  ap_test.val(:C, format('SELECT public.can_upload_juridico_certidao(%L)::text', :S1)) = 'false');
SELECT ap_test.check('jurídico: admin da B NÃO sobe certidão da A',
  ap_test.val(:B1, format('SELECT public.can_upload_juridico_certidao(%L)::text', :S1)) = 'false');
SELECT ap_test.check('fluxo: aprovada_gestor → em_elaboracao_contrato (Iniciar contrato)', ap_test.st(:A1, :S1, 'em_elaboracao_contrato') = 'ok');
SELECT ap_test.check('jurídico: Administrador principal anexa o contrato',
  ap_test.run(:A1, $q$INSERT INTO public.sale_documents(sale_id,tipo,parte,storage_path,file_name,uploaded_by,organization_id) VALUES
    ('ac050000-0000-4000-8000-000000000001','contrato','outros','ac050000-0000-4000-8000-000000000001/outros/contrato/c.pdf','c.pdf','ac000000-0000-4000-8000-0000000000a1','ac000000-0000-4000-8000-0000000000a0')$q$) = 'ok');
SELECT ap_test.check('fluxo: em_elaboracao_contrato → contrato_conferencia_gestor (Enviar ao gestor)', ap_test.st(:A1, :S1, 'contrato_conferencia_gestor') = 'ok');
SELECT ap_test.check('fluxo: conferência do gestor devolve ao jurídico', ap_test.st(:A1, :S1, 'em_elaboracao_contrato', 'ajustar cláusula') = 'ok');
SELECT ap_test.check('fluxo: de novo à conferência do gestor', ap_test.st(:A1, :S1, 'contrato_conferencia_gestor') = 'ok');
SELECT ap_test.check('fluxo: conferência do gestor OK → contrato_conferencia_corretor', ap_test.st(:A1, :S1, 'contrato_conferencia_corretor') = 'ok');
SELECT ap_test.check('fluxo: corretor dá OK no contrato (papel dele, sem mudança)', ap_test.st(:C, :S1, 'contrato_ok_corretor') = 'ok');
SELECT ap_test.check('fluxo: contrato_ok_corretor → aguardando_assinatura', ap_test.st(:A1, :S1, 'aguardando_assinatura') = 'ok' AND ap_test.status(:S1) = 'aguardando_assinatura');
SELECT ap_test.check('assinatura: Administrador principal pode subir contrato assinado pelo caminho do jurídico',
  ap_test.val(:A1, format('SELECT public.can_upload_contrato_assinado_juridico(%L)::text', :S1)) = 'true');
SELECT ap_test.check('assinatura: admin da B NÃO pode', ap_test.val(:B1, format('SELECT public.can_upload_contrato_assinado_juridico(%L)::text', :S1)) = 'false');
SELECT ap_test.check('assinatura: corretor NÃO pode', ap_test.val(:C, format('SELECT public.can_upload_contrato_assinado_juridico(%L)::text', :S1)) = 'false');

-- ---------- Histórico com o autor real ----------
SELECT ap_test.check('histórico: aprovação p/ jurídico gravada com a Administradora (Ana) como autora',
  EXISTS (SELECT 1 FROM public.sale_status_history h JOIN public.profiles p ON p.id = h.autor_id
          WHERE h.sale_id = 'ac050000-0000-4000-8000-000000000001' AND h.para = 'aprovada_gestor'
            AND p.nome = 'Ana Administradora'));
SELECT ap_test.check('histórico: todas as etapas do Administrador principal têm autor_id dele',
  (SELECT count(*) FROM public.sale_status_history WHERE sale_id = 'ac050000-0000-4000-8000-000000000001'
     AND autor_id = 'ac000000-0000-4000-8000-0000000000a1') = 7);

-- ---------- Não-regressão: gestor e jurídico continuam iguais ----------
INSERT INTO public.user_roles(user_id,role,organization_id) VALUES
 ('ac000000-0000-4000-8000-0000000000a4','gestor','ac000000-0000-4000-8000-0000000000a0'),
 ('ac000000-0000-4000-8000-0000000000a5','juridico','ac000000-0000-4000-8000-0000000000a0');
INSERT INTO public.teams(id,lider_id,nome,organization_id) VALUES
 ('ac0e0000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000a4','Equipe A','ac000000-0000-4000-8000-0000000000a0');
INSERT INTO public.team_members(team_id,membro_id,tipo,organization_id) VALUES
 ('ac0e0000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-0000000000a2','corretor','ac000000-0000-4000-8000-0000000000a0');
SELECT ap_test.check('preparo: corretor reenvia a venda 2 ao gestor', ap_test.st(:C, :S2, 'enviada_revisao') = 'ok');
SELECT ap_test.check('gestor: continua aprovando p/ jurídico', ap_test.st('ac000000-0000-4000-8000-0000000000a4', :S2, 'aprovada_gestor') = 'ok');
SELECT ap_test.check('jurídico: continua iniciando o contrato', ap_test.st('ac000000-0000-4000-8000-0000000000a5', :S2, 'em_elaboracao_contrato') = 'ok');
SELECT ap_test.check('jurídico: continua lendo a certidão',
  ap_test.val('ac000000-0000-4000-8000-0000000000a5', format('SELECT public.can_read_sale_juridico_certidao(%L)::text', :S2)) = 'true');
SELECT ap_test.check('gestor: capability igual (pode gerir)',
  ap_test.val('ac000000-0000-4000-8000-0000000000a4', format('SELECT public.sale_management_capabilities(%L)->>''can_manage''', :S2)) = 'true');

SELECT set_config('request.jwt.claims','',true);
SELECT 'FALHA: ' || label FROM ap_test.results WHERE NOT ok ORDER BY n;
SELECT 'RESULTADO: ' || count(*) FILTER (WHERE ok) || '/' || count(*) || ' OK' FROM ap_test.results;
ROLLBACK;
