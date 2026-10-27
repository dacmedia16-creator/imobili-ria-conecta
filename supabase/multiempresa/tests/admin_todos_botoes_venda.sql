-- t_3c10bab8 (Denis 27/10/2026): o Administrador (papel admin) da imobiliária tem todos os botões da
-- venda — etapas de gestor e de jurídico, cancelar (com motivo e histórico) e registrar venda.
-- Agência A sem gestor e sem jurídico (admin + corretor); agência B com admin próprio.
-- Tudo em transação + ROLLBACK (nada persiste). Gatilhos de completude desligados DENTRO da transação:
-- aqui se testa PERMISSÃO, não preenchimento. validate_sale_status_transition continua LIGADO.
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA ap_test;
CREATE TABLE ap_test.results (n serial, label text, ok boolean);
GRANT USAGE ON SCHEMA ap_test TO authenticated;
GRANT ALL ON ap_test.results TO authenticated;
GRANT ALL ON SEQUENCE ap_test.results_n_seq TO authenticated;
CREATE FUNCTION ap_test.check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO ap_test.results(label,ok) VALUES(label,coalesce(ok,false)) $$;
CREATE FUNCTION ap_test.run(u uuid, q text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE r text; BEGIN
  PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  BEGIN EXECUTE q; r := 'ok';
  EXCEPTION WHEN OTHERS THEN r := 'erro:' || SQLSTATE; END;
  RESET ROLE; PERFORM set_config('request.jwt.claims','',true); RETURN r; END $$;
CREATE FUNCTION ap_test.val(u uuid, q text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE r text; BEGIN
  PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  BEGIN EXECUTE q INTO r; EXCEPTION WHEN OTHERS THEN r := 'erro:' || SQLSTATE; END;
  RESET ROLE; PERFORM set_config('request.jwt.claims','',true); RETURN r; END $$;
CREATE FUNCTION ap_test.st(u uuid, sale uuid, para text, motivo text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT ap_test.run(u, format('SELECT public.change_sale_status(%L,%L,%L)', sale, para, motivo)) $$;
CREATE FUNCTION ap_test.cancel(u uuid, sale uuid, motivo text) RETURNS text LANGUAGE sql AS $$
 SELECT ap_test.run(u, format('SELECT public.org_admin_cancel_sale(%L,%L)', sale, motivo)) $$;
CREATE FUNCTION ap_test.status(sale uuid) RETURNS text LANGUAGE sql AS $$
 SELECT status::text FROM public.sales WHERE id = sale $$;
-- Volátil: enxerga o que o ap_test.run do mesmo SELECT acabou de gravar.
CREATE FUNCTION ap_test.org_da_venda(imovel text) RETURNS text LANGUAGE sql AS $$
 SELECT string_agg(organization_id::text, ',') FROM public.sales WHERE imovel_id = imovel $$;
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
 ('ad000000-0000-4000-8000-0000000000a0','tb-a','Agencia A sem gestor'),
 ('ad000000-0000-4000-8000-0000000000b0','tb-b','Agencia B');
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('ad000000-0000-4000-8000-0000000000a1','adm.tb@example.test','{"nome":"Alice Administradora"}','{"organization_id":"ad000000-0000-4000-8000-0000000000a0"}'),
 ('ad000000-0000-4000-8000-0000000000a2','c.tb@example.test','{"nome":"Carlos Corretor"}','{"organization_id":"ad000000-0000-4000-8000-0000000000a0"}'),
 ('ad000000-0000-4000-8000-0000000000a3','sa.tb@example.test','{"nome":"Paula Principal"}','{"organization_id":"ad000000-0000-4000-8000-0000000000a0"}'),
 ('ad000000-0000-4000-8000-0000000000a4','g.tb@example.test','{"nome":"Gestor A"}','{"organization_id":"ad000000-0000-4000-8000-0000000000a0"}'),
 ('ad000000-0000-4000-8000-0000000000a5','f.tb@example.test','{"nome":"Fin A"}','{"organization_id":"ad000000-0000-4000-8000-0000000000a0"}'),
 ('ad000000-0000-4000-8000-0000000000b1','adb.tb@example.test','{"nome":"Bruno Admin B"}','{"organization_id":"ad000000-0000-4000-8000-0000000000b0"}');
DELETE FROM public.user_roles WHERE user_id::text LIKE 'ad000000-%';
INSERT INTO public.user_roles(user_id,role,organization_id) VALUES
 ('ad000000-0000-4000-8000-0000000000a1','admin','ad000000-0000-4000-8000-0000000000a0'),
 ('ad000000-0000-4000-8000-0000000000a2','corretor','ad000000-0000-4000-8000-0000000000a0'),
 ('ad000000-0000-4000-8000-0000000000a3','super_admin','ad000000-0000-4000-8000-0000000000a0'),
 ('ad000000-0000-4000-8000-0000000000a4','gestor','ad000000-0000-4000-8000-0000000000a0'),
 ('ad000000-0000-4000-8000-0000000000a5','financeiro','ad000000-0000-4000-8000-0000000000a0'),
 ('ad000000-0000-4000-8000-0000000000b1','admin','ad000000-0000-4000-8000-0000000000b0');

INSERT INTO public.sales(id,corretor_id,corretor_vendedor_id,imovel_id,status,organization_id,modalidade) VALUES
 ('ad050000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-0000000000a2','ad000000-0000-4000-8000-0000000000a2','TB-1','enviada_revisao','ad000000-0000-4000-8000-0000000000a0','padrao'),
 ('ad050000-0000-4000-8000-000000000002','ad000000-0000-4000-8000-0000000000a2','ad000000-0000-4000-8000-0000000000a2','TB-2','enviada_revisao','ad000000-0000-4000-8000-0000000000a0','padrao'),
 ('ad050000-0000-4000-8000-000000000003','ad000000-0000-4000-8000-0000000000a2','ad000000-0000-4000-8000-0000000000a2','TB-3','aprovada_gestor','ad000000-0000-4000-8000-0000000000a0','padrao'),
 ('ad050000-0000-4000-8000-000000000004','ad000000-0000-4000-8000-0000000000a2','ad000000-0000-4000-8000-0000000000a2','TB-4','rascunho','ad000000-0000-4000-8000-0000000000a0','padrao'),
 ('ad050000-0000-4000-8000-000000000005','ad000000-0000-4000-8000-0000000000a2','ad000000-0000-4000-8000-0000000000a2','TB-5','contrato_assinado','ad000000-0000-4000-8000-0000000000a0','padrao');

\set AD '''ad000000-0000-4000-8000-0000000000a1'''
\set C  '''ad000000-0000-4000-8000-0000000000a2'''
\set SA '''ad000000-0000-4000-8000-0000000000a3'''
\set G  '''ad000000-0000-4000-8000-0000000000a4'''
\set F  '''ad000000-0000-4000-8000-0000000000a5'''
\set B1 '''ad000000-0000-4000-8000-0000000000b1'''
\set S1 '''ad050000-0000-4000-8000-000000000001'''
\set S2 '''ad050000-0000-4000-8000-000000000002'''
\set S3 '''ad050000-0000-4000-8000-000000000003'''
\set S4 '''ad050000-0000-4000-8000-000000000004'''
\set S5 '''ad050000-0000-4000-8000-000000000005'''

-- ---------- Capacidades de gestor (o que a tela usa) ----------
SELECT ap_test.check('caps: Administrador A gere a venda (can_manage+can_edit)',
  ap_test.val(:AD, format('SELECT (public.sale_management_capabilities(%L)->>''can_manage'')||(public.sale_management_capabilities(%L)->>''can_edit'')', :S1, :S1)) = 'truetrue');
SELECT ap_test.check('caps: corretor NÃO gere',
  ap_test.val(:C, format('SELECT public.sale_management_capabilities(%L)->>''can_manage''', :S1)) = 'false');
SELECT ap_test.check('caps: financeiro NÃO gere (papel não muda)',
  ap_test.val(:F, format('SELECT public.sale_management_capabilities(%L)->>''can_manage''', :S1)) = 'false');
SELECT ap_test.check('caps: Administrador da OUTRA imobiliária (B) NÃO gere venda da A',
  ap_test.val(:B1, format('SELECT public.sale_management_capabilities(%L)->>''can_manage''', :S1)) = 'false');

-- ---------- Etapas: corretor e outra imobiliária barrados ----------
SELECT ap_test.check('etapa: corretor NÃO aprova', ap_test.st(:C, :S1, 'aprovada_gestor') <> 'ok' AND ap_test.status(:S1) = 'enviada_revisao');
SELECT ap_test.check('etapa: admin da B NÃO aprova venda da A', ap_test.st(:B1, :S1, 'aprovada_gestor') <> 'ok' AND ap_test.status(:S1) = 'enviada_revisao');
SELECT ap_test.check('etapa: Administrador devolve p/ ajuste', ap_test.st(:AD, :S2, 'devolvida_ajuste', 'faltou doc') = 'ok' AND ap_test.status(:S2) = 'devolvida_ajuste');

-- ---------- Fluxo completo pelo Administrador (venda 1) ----------
SELECT ap_test.check('fluxo: aprovar p/ jurídico', ap_test.st(:AD, :S1, 'aprovada_gestor') = 'ok');
SELECT ap_test.check('jurídico: Administrador lê e sobe certidão do jurídico',
  ap_test.val(:AD, format('SELECT public.can_read_sale_juridico_certidao(%L)::text || public.can_upload_juridico_certidao(%L)::text', :S1, :S1)) = 'truetrue');
SELECT ap_test.check('jurídico: corretor NÃO sobe certidão', ap_test.val(:C, format('SELECT public.can_upload_juridico_certidao(%L)::text', :S1)) = 'false');
SELECT ap_test.check('jurídico: admin da B NÃO sobe certidão da A', ap_test.val(:B1, format('SELECT public.can_upload_juridico_certidao(%L)::text', :S1)) = 'false');
SELECT ap_test.check('fluxo: iniciar contrato (montar)', ap_test.st(:AD, :S1, 'em_elaboracao_contrato') = 'ok');
SELECT ap_test.check('jurídico: Administrador anexa o contrato',
  ap_test.run(:AD, $q$INSERT INTO public.sale_documents(sale_id,tipo,parte,storage_path,file_name,uploaded_by,organization_id) VALUES
    ('ad050000-0000-4000-8000-000000000001','contrato','outros','ad050000-0000-4000-8000-000000000001/outros/contrato/c.pdf','c.pdf','ad000000-0000-4000-8000-0000000000a1','ad000000-0000-4000-8000-0000000000a0')$q$) = 'ok');
SELECT ap_test.check('fluxo: enviar à conferência do gestor', ap_test.st(:AD, :S1, 'contrato_conferencia_gestor') = 'ok');
SELECT ap_test.check('fluxo: conferência devolve ao jurídico', ap_test.st(:AD, :S1, 'em_elaboracao_contrato', 'ajustar cláusula') = 'ok');
SELECT ap_test.check('fluxo: de novo à conferência', ap_test.st(:AD, :S1, 'contrato_conferencia_gestor') = 'ok');
SELECT ap_test.check('fluxo: conferência OK → corretor', ap_test.st(:AD, :S1, 'contrato_conferencia_corretor') = 'ok');
SELECT ap_test.check('fluxo: corretor dá OK (papel dele)', ap_test.st(:C, :S1, 'contrato_ok_corretor') = 'ok');
SELECT ap_test.check('fluxo: → aguardando assinatura', ap_test.st(:AD, :S1, 'aguardando_assinatura') = 'ok' AND ap_test.status(:S1) = 'aguardando_assinatura');
SELECT ap_test.check('assinatura: Administrador sobe contrato assinado pelo caminho do jurídico',
  ap_test.val(:AD, format('SELECT public.can_upload_contrato_assinado_juridico(%L)::text', :S1)) = 'true');
SELECT ap_test.check('assinatura: admin da B NÃO', ap_test.val(:B1, format('SELECT public.can_upload_contrato_assinado_juridico(%L)::text', :S1)) = 'false');
SELECT ap_test.check('assinatura: corretor NÃO', ap_test.val(:C, format('SELECT public.can_upload_contrato_assinado_juridico(%L)::text', :S1)) = 'false');
SELECT ap_test.check('histórico: etapas gravadas com a Administradora como autora',
  (SELECT count(*) FROM public.sale_status_history WHERE sale_id = :S1 AND autor_id = :AD) = 7);

-- ---------- Cancelar ----------
SELECT ap_test.check('cancelar: corretor NÃO cancela (RPC)', ap_test.cancel(:C, :S3, 'teste') <> 'ok' AND ap_test.status(:S3) = 'aprovada_gestor');
SELECT ap_test.check('cancelar: gestor NÃO cancela (papel não muda)', ap_test.cancel(:G, :S3, 'teste') <> 'ok' AND ap_test.status(:S3) = 'aprovada_gestor');
SELECT ap_test.check('cancelar: financeiro NÃO cancela', ap_test.cancel(:F, :S3, 'teste') <> 'ok' AND ap_test.status(:S3) = 'aprovada_gestor');
SELECT ap_test.check('cancelar: admin da B NÃO cancela venda da A', ap_test.cancel(:B1, :S3, 'teste') = 'erro:P0002' AND ap_test.status(:S3) = 'aprovada_gestor');
SELECT ap_test.check('cancelar: sem motivo é recusado', ap_test.cancel(:AD, :S3, '   ') = 'erro:23514' AND ap_test.status(:S3) = 'aprovada_gestor');
SELECT ap_test.check('cancelar: rascunho não se cancela', ap_test.cancel(:AD, :S4, 'teste') = 'erro:42501' AND ap_test.status(:S4) = 'rascunho');
SELECT ap_test.check('cancelar: atalho change_sale_status(cancelada) continua barrado p/ admin', ap_test.st(:AD, :S3, 'cancelada', 'atalho') <> 'ok' AND ap_test.status(:S3) = 'aprovada_gestor');
SELECT ap_test.check('cancelar: UPDATE direto em sales.status continua barrado', ap_test.run(:AD, format('UPDATE public.sales SET status=''cancelada'' WHERE id=%L', :S3)) <> 'ok' AND ap_test.status(:S3) = 'aprovada_gestor');
SELECT ap_test.check('cancelar: Administrador cancela com motivo', ap_test.cancel(:AD, :S3, 'Cliente desistiu') = 'ok' AND ap_test.status(:S3) = 'cancelada');
SELECT ap_test.check('cancelar: histórico grava quem, quando e motivo',
  EXISTS (SELECT 1 FROM public.sale_status_history h WHERE h.sale_id = :S3 AND h.de = 'aprovada_gestor' AND h.para = 'cancelada'
          AND h.autor_id = :AD AND h.motivo = 'Cliente desistiu' AND h.created_at IS NOT NULL));
SELECT ap_test.check('cancelar: activity_logs com origem admin_imobiliaria',
  EXISTS (SELECT 1 FROM public.activity_logs WHERE sale_id = :S3 AND autor_id = :AD AND payload->>'origem' = 'admin_imobiliaria'));
SELECT ap_test.check('cancelar: venda já cancelada não cancela de novo', ap_test.cancel(:AD, :S3, 'de novo') = 'erro:23514');
SELECT ap_test.check('cancelar: Administrador principal também cancela (venda assinada)', ap_test.cancel(:SA, :S5, 'Distrato') = 'ok' AND ap_test.status(:S5) = 'cancelada');

-- ---------- Registrar venda ----------
SELECT ap_test.check('registrar: Administrador registra venda padrão na própria imobiliária',
  ap_test.run(:AD, $q$INSERT INTO public.sales(corretor_id,imovel_id,status) VALUES ('ad000000-0000-4000-8000-0000000000a1','TB-N','rascunho')$q$) = 'ok'
  AND ap_test.org_da_venda('TB-N') = 'ad000000-0000-4000-8000-0000000000a0');
SELECT ap_test.check('registrar: Administrador principal registra venda padrão',
  ap_test.run(:SA, $q$INSERT INTO public.sales(corretor_id,imovel_id,status) VALUES ('ad000000-0000-4000-8000-0000000000a3','TB-P','rascunho')$q$) = 'ok');
SELECT ap_test.check('registrar: Administrador NÃO registra em nome de outro',
  ap_test.run(:AD, $q$INSERT INTO public.sales(corretor_id,imovel_id,status) VALUES ('ad000000-0000-4000-8000-0000000000a2','TB-X','rascunho')$q$) <> 'ok');
-- Pedir a imobiliária B não adianta: o gatilho trg_00_org grava sempre na imobiliária de quem cria
-- (comportamento antigo, sem mudança). A venda nunca cai na B.
SELECT ap_test.check('registrar: Administrador NÃO registra em outra imobiliária (vai para a dele)',
  ap_test.run(:AD, $q$INSERT INTO public.sales(corretor_id,imovel_id,status,organization_id) VALUES ('ad000000-0000-4000-8000-0000000000a1','TB-Y','rascunho','ad000000-0000-4000-8000-0000000000b0')$q$) IS NOT NULL
  AND ap_test.org_da_venda('TB-Y') IS DISTINCT FROM 'ad000000-0000-4000-8000-0000000000b0'
  AND coalesce(ap_test.org_da_venda('TB-Y'), 'a0') NOT LIKE '%b0');
SELECT ap_test.check('registrar: admin da B não enxerga a venda registrada na A',
  ap_test.val(:B1, $q$SELECT count(*)::text FROM public.sales WHERE imovel_id IN ('TB-N','TB-Y')$q$) = '0');
SELECT ap_test.check('registrar: financeiro continua sem registrar',
  ap_test.run(:F, $q$INSERT INTO public.sales(corretor_id,imovel_id,status) VALUES ('ad000000-0000-4000-8000-0000000000a5','TB-F','rascunho')$q$) <> 'ok');
SELECT ap_test.check('registrar: corretor continua registrando',
  ap_test.run(:C, $q$INSERT INTO public.sales(corretor_id,imovel_id,status) VALUES ('ad000000-0000-4000-8000-0000000000a2','TB-C','rascunho')$q$) = 'ok');

-- ---------- Não-regressão: gestor ----------
INSERT INTO public.teams(id,lider_id,nome,organization_id) VALUES
 ('ad0e0000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-0000000000a4','Equipe A','ad000000-0000-4000-8000-0000000000a0');
INSERT INTO public.team_members(team_id,membro_id,tipo,organization_id) VALUES
 ('ad0e0000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-0000000000a2','corretor','ad000000-0000-4000-8000-0000000000a0');
SELECT ap_test.check('preparo: corretor reenvia a venda 2', ap_test.st(:C, :S2, 'enviada_revisao') = 'ok');
SELECT ap_test.check('gestor: continua aprovando', ap_test.st(:G, :S2, 'aprovada_gestor') = 'ok');

SELECT set_config('request.jwt.claims','',true);
SELECT 'FALHA: ' || label FROM ap_test.results WHERE NOT ok ORDER BY n;
SELECT 'RESULTADO: ' || count(*) FILTER (WHERE ok) || '/' || count(*) || ' OK' FROM ap_test.results;
ROLLBACK;
