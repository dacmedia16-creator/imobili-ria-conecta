-- Suíte: aviso da Clicksign (webhook, sem JWT) muda a etapa da VENDA sem abrir brecha entre imobiliárias,
-- e venda já assinada pela Clicksign não é enviada de novo (migration 20261205120000, t_0c874b61).
-- Roda DENTRO de transação revertida (run-clicksign-venda-validadores-webhook.sh), em homologação ou banco
-- descartável; nunca em produção. Dados 100% fictícios, criados aqui. Diferente de clicksign_venda.sql, os
-- gatilhos trg_bloquear_participante_sem_cadastro e trg_bloquear_pagamento_inconsistente ficam LIGADOS:
-- são eles que quebravam o webhook.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated, service_role, anon;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true) $$;
-- Chamada que devolve o resultado como texto (ou 'ERRO <estado> <mensagem>'), para a suíte nunca parar no meio.
CREATE FUNCTION pg_temp.t(_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _r text; BEGIN EXECUTE _sql INTO _r; RETURN coalesce(_r, ''); EXCEPTION WHEN others THEN
  RETURN 'ERRO ' || SQLSTATE || ' ' || SQLERRM; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(bool, text), pg_temp.err(text), pg_temp.t(text) TO authenticated, service_role, anon;

\set orga 'b0000000-0000-4000-8000-0000000000a0'
\set orgb 'b0000000-0000-4000-8000-0000000000b0'
\set admin 'b0000000-0000-4000-8000-000000000001'
\set c1 'b0000000-0000-4000-8000-000000000002'
\set foto 'b0000000-0000-4000-8000-000000000003'
\set adminb 'b0000000-0000-4000-8000-000000000004'
\set inativo 'b0000000-0000-4000-8000-000000000005'
-- Vendas da org A: OK = tudo certo; PART = vendedor sem conta; PAG = pagamento não fecha;
-- ASS = já assinada pela Clicksign (caso real 630601311-16: envelope fechado, etapa não mudou).
\set vok 'b1000000-0000-4000-8000-000000000001'
\set vpart 'b1000000-0000-4000-8000-000000000002'
\set vpag 'b1000000-0000-4000-8000-000000000003'
\set vass 'b1000000-0000-4000-8000-000000000004'
\set vinat 'b1000000-0000-4000-8000-000000000005'
\set dok 'b2000000-0000-4000-8000-000000000001'
\set dpart 'b2000000-0000-4000-8000-000000000002'
\set dpag 'b2000000-0000-4000-8000-000000000003'
\set dass 'b2000000-0000-4000-8000-000000000004'
\set dinat 'b2000000-0000-4000-8000-000000000005'
\set dassinado 'b2000000-0000-4000-8000-0000000000f4'
\set eok 'b3000000-0000-4000-8000-000000000001'
\set epart 'b3000000-0000-4000-8000-000000000002'
\set epag 'b3000000-0000-4000-8000-000000000003'
\set eass 'b3000000-0000-4000-8000-000000000004'
\set einat 'b3000000-0000-4000-8000-000000000005'
\set vcap 'b1000000-0000-4000-8000-000000000006'
\set cap 'b5000000-0000-4000-8000-000000000001'

-- Montagem (sem gatilhos, só nesta transação) -----------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'orga', 'teste-cs-webhook-a', 'Imobiliária Exemplo A', 'ativa', '00000000000191', '#112233', '#445566'),
  (:'orgb', 'teste-cs-webhook-b', 'Imobiliária Exemplo B', 'ativa', '00000000000272', '#112233', '#445566');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'c1', :'foto', :'adminb', :'inativo']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'admin', 'Dona Exemplo', 'dona@exemplo.test', true, :'orga'),
  (:'c1', 'Carlos Corretor', 'c1@exemplo.test', true, :'orga'),
  (:'foto', 'Fábio Fotógrafo', 'foto@exemplo.test', true, :'orga'),
  (:'adminb', 'Dono B', 'donob@exemplo.test', true, :'orgb'),
  (:'inativo', 'Ivo Inativo', 'ivo@exemplo.test', false, :'orga');
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'orga', :'admin', true), (:'orga', :'c1', true), (:'orga', :'foto', true), (:'orgb', :'adminb', true),
  (:'orga', :'inativo', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'orga'), (:'c1', 'corretor', :'orga'), (:'foto', 'fotografo', :'orga'),
  (:'adminb', 'admin', :'orgb'), (:'inativo', 'corretor', :'orga');
INSERT INTO public.clicksign_org_settings (organization_id, enabled, sale_enabled, test_mode, access_token_secret_id)
  VALUES (:'orga', true, true, true, gen_random_uuid()), (:'orgb', true, true, true, gen_random_uuid());
INSERT INTO public.sales (id, corretor_id, imovel_id, status, organization_id, valor_negociado,
    corretor_vendedor, corretor_vendedor_id) VALUES
  (:'vok', :'c1', 'CSW-OK', 'contrato_ok_corretor', :'orga', 500000, NULL, NULL),
  (:'vpart', :'c1', 'CSW-PART', 'contrato_ok_corretor', :'orga', 500000, 'Vendedor Sem Conta', NULL),
  (:'vpag', :'c1', 'CSW-PAG', 'contrato_ok_corretor', :'orga', 500000, NULL, NULL),
  (:'vass', :'c1', 'CSW-ASS', 'contrato_ok_corretor', :'orga', 500000, NULL, NULL),
  (:'vinat', :'c1', 'CSW-INAT', 'contrato_ok_corretor', :'orga', 500000, 'Ivo Inativo', :'inativo');
-- Comissão preenchida (a Ocorrência é criada ao marcar assinado e exige a distribuição válida).
UPDATE public.sales SET percentual_comissao = 6, valor_total_comissao = 30000
  WHERE id IN (:'vok', :'vpart', :'vpag', :'vass', :'vinat');
-- Pagamento: fecha nas vendas certas; PAG fica R$ 100.000 abaixo.
INSERT INTO public.sale_payment (sale_id, organization_id, tipo_pagamento, entrada_valor)
  SELECT v, :'orga', 'vista', CASE WHEN v = :'vpag'::uuid THEN 400000 ELSE 500000 END
  FROM unnest(ARRAY[:'vok', :'vpart', :'vpag', :'vass', :'vinat']::uuid[]) v;
INSERT INTO public.sale_documents (id, sale_id, tipo, parte, storage_path, file_name, status, organization_id, created_at)
  SELECT d, v, 'contrato', 'outros', :'orga' || '/' || v || '/outros/contrato/v1.pdf', 'contrato.pdf', 'enviado',
    :'orga', now() - interval '3 hours'
  FROM (VALUES (:'dok'::uuid, :'vok'::uuid), (:'dpart', :'vpart'), (:'dpag', :'vpag'), (:'dass', :'vass'),
               (:'dinat', :'vinat')) x(d, v);
-- Envelopes "sending" (a edge já criou na Clicksign; falta o mark_sent). ASS: já fechado e assinado.
INSERT INTO public.clicksign_envelopes (id, organization_id, origem, sale_id, source_document_id, status, is_test,
    signers, created_by, envelope_key, document_key, created_at)
  SELECT e, :'orga', 'venda', v, d, 'sending', true, '[]'::jsonb, :'admin', gen_random_uuid()::text,
    gen_random_uuid()::text, now() - interval '2 hours'
  FROM (VALUES (:'eok'::uuid, :'vok'::uuid, :'dok'::uuid), (:'epart', :'vpart', :'dpart'),
               (:'epag', :'vpag', :'dpag'), (:'einat', :'vinat', :'dinat')) x(e, v, d);
INSERT INTO public.sale_documents (id, sale_id, tipo, parte, storage_path, file_name, status, organization_id, created_at)
  VALUES (:'dassinado', :'vass', 'contrato_assinado', 'outros',
    :'orga' || '/' || :'vass' || '/outros/contrato_assinado/' || :'dassinado' || '.pdf',
    'contrato-assinado-clicksign.pdf', 'enviado', :'orga', now() - interval '1 hour');
INSERT INTO public.clicksign_envelopes (id, organization_id, origem, sale_id, source_document_id, status, is_test,
    signers, created_by, envelope_key, document_key, signed_document_id, last_event, error_code, created_at)
  VALUES (:'eass', :'orga', 'venda', :'vass', :'dass', 'closed', true, '[]'::jsonb, :'admin',
    gen_random_uuid()::text, gen_random_uuid()::text, :'dassinado', 'attached_only',
    'status_failed:Venda não encontrada.', now() - interval '2 hours');
-- Venda CAP: nasceu de uma captação ("Virou venda"); ao virar vendida o gatilho grava no histórico da captação.
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, status, form_data, organization_id)
  VALUES (:'cap', :'c1', :'c1', 'campolim', 'aprovada', '{}'::jsonb, :'orga');
INSERT INTO public.sales (id, corretor_id, imovel_id, status, organization_id, valor_negociado, exclusive_capture_id,
    percentual_comissao, valor_total_comissao)
  VALUES (:'vcap', :'c1', 'CSW-CAP', 'aguardando_assinatura', :'orga', 500000, :'cap', 6, 30000);
INSERT INTO public.sale_payment (sale_id, organization_id, tipo_pagamento, entrada_valor)
  VALUES (:'vcap', :'orga', 'vista', 500000);
INSERT INTO public.sale_documents (sale_id, tipo, parte, storage_path, file_name, status, organization_id, created_at)
  VALUES (:'vcap', 'contrato_assinado', 'outros', :'orga' || '/' || :'vcap' || '/outros/contrato_assinado/x.pdf',
    'contrato-assinado-clicksign.pdf', 'enviado', :'orga', now() - interval '1 hour');
-- PDF assinado no Storage para o fechamento da venda OK.
INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES ('sale-documents', :'orga' || '/' || :'vok' || '/outros/contrato_assinado/b4000000-0000-4000-8000-000000000001.pdf',
          '{"mimetype":"application/pdf"}');
SET LOCAL session_replication_role = origin;

-- Venda fictícia sem endereço/ficha/mídia/distribuição: desliga SÓ esses gatilhos de negócio (nesta
-- transação revertida). Ficam LIGADOS os dois validadores (alvo), a transição de status, a organização e
-- os da Clicksign.
ALTER TABLE public.sales DISABLE TRIGGER trg_bloquear_avanco_com_previsao_incompleta,
  DISABLE TRIGGER trg_bloquear_avanco_sem_endereco, DISABLE TRIGGER trg_bloquear_avanco_a_midia,
  DISABLE TRIGGER trg_bloquear_avanco_sem_ficha_imovel, DISABLE TRIGGER trg_validar_distribuicao_aprovar_gestor,
  DISABLE TRIGGER trg_validar_distribuicao_concluir_lancamento, DISABLE TRIGGER trg_sales_sync_antes_financeiro,
  DISABLE TRIGGER trg_sales_sync_antes_financeiro_status, DISABLE TRIGGER enforce_matricula_descricao,
  DISABLE TRIGGER trg_validar_data_venda_lancamento_mes_atual, DISABLE TRIGGER zz_venda_distribuicao,
  DISABLE TRIGGER trg_zz_mural_conquistas;
SELECT pg_temp.ok(
  (SELECT bool_and(tgenabled <> 'D') FROM pg_trigger WHERE tgrelid = 'public.sales'::regclass
     AND tgname IN ('trg_bloquear_participante_sem_cadastro', 'trg_bloquear_pagamento_inconsistente',
                    'trg_validate_sale_status')),
  'gatilhos alvo (participante, pagamento, transição) estão ligados');

-- 1) Webhook sem JWT (service_role) avança a venda certa --------------------------------------------
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_mark_sent(%L)', :'eok')) IS NULL,
  '1 webhook: clicksign_sale_mark_sent roda sem erro');
RESET ROLE;
SELECT pg_temp.ok(status = 'aguardando_assinatura', '1 webhook: envio confirmado leva a venda para aguardando_assinatura')
  FROM public.sales WHERE id = :'vok';
SELECT pg_temp.ok(error_code IS NULL AND status = 'running', '1 webhook: envelope running e sem erro (antes: Venda não encontrada)')
  FROM public.clicksign_envelopes WHERE id = :'eok';
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.sale_status_history WHERE sale_id = :'vok'
  AND para = 'aguardando_assinatura' AND motivo LIKE 'Enviado pela Clicksign%'), '1 webhook: histórico do envio gravado');

-- 2) Todos assinaram: o webhook anexa e marca a venda sozinho --------------------------------------
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.t(format('SELECT public.clicksign_sale_attach_signed(%L, %L, %L)', :'eok',
  :'orga' || '/' || :'vok' || '/outros/contrato_assinado/b4000000-0000-4000-8000-000000000001.pdf',
  'contrato-assinado-clicksign.pdf')) AS res_attach \gset
RESET ROLE;
-- A venda fictícia não tem a distribuição da comissão completa, então a criação da Ocorrência (regra de
-- negócio de criar_ocorrencia_completa, fora deste PR) pode recusar. O que importa aqui: o motivo é o REAL,
-- não "Venda não encontrada" (antes desta migration os validadores paravam tudo antes).
SELECT pg_temp.ok(:'res_attach' IN ('attached', 'attached_only'), '2 webhook: assinado anexado (' || :'res_attach' || ')');
SELECT pg_temp.ok(CASE WHEN :'res_attach' = 'attached'
    THEN s.status::text = 'ocorrencia_pendente' AND e.error_code IS NULL
    ELSE e.error_code LIKE 'mark_failed:%Ocorrência%' AND e.error_code NOT LIKE '%Venda não encontrada%' END,
  '2 webhook: fechamento marca a venda ou mostra o motivo real (' || coalesce(e.error_code, s.status::text) || ')')
  FROM public.sales s JOIN public.clicksign_envelopes e ON e.sale_id = s.id WHERE s.id = :'vok' AND e.id = :'eok';
-- A troca aguardando_assinatura → contrato_assinado (onde os dois validadores rodam) passa pelo servidor.
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT public.clicksign_sale_set_status(%L, 'contrato_assinado', %L,
  'Automático: todos assinaram na Clicksign (TESTE)')$q$, :'vok', :'admin')) IS NULL,
  '2 webhook: servidor marca contrato_assinado com os validadores ligados');
RESET ROLE;
SELECT pg_temp.ok(status = 'contrato_assinado', '2 webhook: venda em contrato_assinado') FROM public.sales WHERE id = :'vok';
-- Venda que nasceu de captação: virar "vendida" grava no histórico da captação (gatilho sales_captacao_historico).
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(pg_temp.err(format($q$SELECT public.clicksign_sale_set_status(%L, 'contrato_assinado', %L,
  'Automático: todos assinaram na Clicksign (TESTE)')$q$, :'vcap', :'admin')) IS NULL,
  '2 webhook: venda de captação marca contrato_assinado sem JWT (' || coalesce(pg_temp.err(format($q$SELECT public.clicksign_sale_set_status(%L, 'contrato_assinado', %L, 'x')$q$, :'vcap', :'admin')), 'sem erro') || ')');
RESET ROLE;
SELECT pg_temp.ok((SELECT status FROM public.sales WHERE id = :'vcap') = 'contrato_assinado'
  AND EXISTS (SELECT 1 FROM public.exclusive_history WHERE capture_id = :'cap' AND action = 'vendida'
    AND detail = :'vcap' AND actor_id = :'c1' AND organization_id = :'orga'),
  '2 webhook: captação registra "vendida" com o corretor da venda e a org certa');

-- 3) Validações continuam bloqueando no webhook ------------------------------------------------------
SELECT pg_temp.as_service();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_mark_sent(%L)', e)) IS NULL,
  '3 mark_sent não estoura (a falha da etapa fica no envelope)')
  FROM unnest(ARRAY[:'epart', :'epag', :'einat']::uuid[]) e;
RESET ROLE;
SELECT pg_temp.ok(s.status = 'contrato_ok_corretor' AND e.error_code LIKE '%Vendedor "Vendedor Sem Conta" está sem conta vinculada%',
  '3 participante sem conta: etapa NÃO muda e o motivo real aparece (' || coalesce(e.error_code, '-') || ')')
  FROM public.sales s JOIN public.clicksign_envelopes e ON e.sale_id = s.id WHERE s.id = :'vpart';
SELECT pg_temp.ok(s.status = 'contrato_ok_corretor' AND e.error_code LIKE '%composição do pagamento está R$%abaixo%',
  '3 pagamento que não fecha: etapa NÃO muda e o motivo real aparece (' || coalesce(e.error_code, '-') || ')')
  FROM public.sales s JOIN public.clicksign_envelopes e ON e.sale_id = s.id WHERE s.id = :'vpag';
SELECT pg_temp.ok(s.status = 'contrato_ok_corretor' AND e.error_code LIKE '%"Ivo Inativo" está sem cadastro ativo%',
  '3 participante inativo: etapa NÃO muda (' || coalesce(e.error_code, '-') || ')')
  FROM public.sales s JOIN public.clicksign_envelopes e ON e.sale_id = s.id WHERE s.id = :'vinat';
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.clicksign_envelopes WHERE organization_id = :'orga'
  AND error_code LIKE '%Venda não encontrada%' AND id <> :'eass'), '3 nenhum envelope novo com "Venda não encontrada"');

-- 4) Usuário logado: só a própria imobiliária --------------------------------------------------------
SELECT pg_temp.as_user(:'admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.t(format('SELECT public.validar_composicao_pagamento_venda(%L)->>''valido''', :'vok')) = 'true',
  '4 admin da A valida o pagamento da venda da A');
SELECT pg_temp.ok(pg_temp.t(format('SELECT public.validar_participantes_internos_venda(%L)->>''valido''', :'vpart')) = 'false',
  '4 admin da A vê a inconsistência de participante da venda da A');
RESET ROLE;
SELECT pg_temp.as_user(:'adminb');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.validar_participantes_internos_venda(%L)', :'vpart'))
  = 'P0002 Venda não encontrada.', '4 admin da B NÃO valida participantes de venda da A');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.validar_composicao_pagamento_venda(%L)', :'vpag'))
  = 'P0002 Venda não encontrada.', '4 admin da B NÃO valida pagamento de venda da A (não vaza valor)');
SELECT pg_temp.ok((SELECT count(*) FROM public.sales WHERE organization_id = :'orga') = 0,
  '4 admin da B não vê vendas da A');
UPDATE public.sales SET status = 'aguardando_assinatura' WHERE id = :'vpag';
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_authorize(%L)', :'vass')) LIKE '%Venda não disponível%',
  '4 admin da B não envia venda da A à Clicksign');
RESET ROLE;
SELECT pg_temp.ok(status = 'contrato_ok_corretor', '4 update do admin da B não alterou a venda da A')
  FROM public.sales WHERE id = :'vpag';
SELECT pg_temp.as_user(:'foto');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.validar_composicao_pagamento_venda(%L)', :'vok'))
  = 'P0002 Venda não encontrada.', '4 perfil só fotógrafo da A continua sem acesso');
RESET ROLE;
SELECT pg_temp.as_service();
SET LOCAL ROLE anon;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.validar_composicao_pagamento_venda(%L)', :'vok')) LIKE '42501%',
  '4 anon não executa o validador de pagamento');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.validar_participantes_internos_venda(%L)', :'vok')) LIKE '42501%',
  '4 anon não executa o validador de participantes');
RESET ROLE;
SELECT pg_temp.ok(p.proowner = 'postgres'::regrole AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND has_function_privilege('service_role', p.oid, 'EXECUTE'),
  '4 ' || p.proname || ': dono postgres, sem anon, com authenticated/service_role')
  FROM pg_proc p WHERE p.oid IN ('public.validar_participantes_internos_venda(uuid)'::regprocedure,
                                 'public.validar_composicao_pagamento_venda(uuid)'::regprocedure);

-- 5) Sem novo envio de venda já assinada pela Clicksign ----------------------------------------------
SELECT pg_temp.as_user(:'admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.clicksign_sale_authorize(%L)', :'vass'))
  LIKE '%já foi assinado pela Clicksign%', '5 venda já assinada pela Clicksign: novo envio recusado');
RESET ROLE;
-- Assinado excluído (ex.: arquivo errado): pode reenviar.
UPDATE public.sale_documents SET deleted_at = now() WHERE id = :'dassinado';
SELECT pg_temp.as_user(:'admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.t(format('SELECT public.clicksign_sale_authorize(%L)->>''contrato''', :'vass')) = :'dass',
  '5 assinado excluído: envio liberado de novo');
RESET ROLE;
UPDATE public.sale_documents SET deleted_at = NULL WHERE id = :'dassinado';
-- O envelope da venda PAG ficou running no item 3 (só a etapa falhou); encerra só para testar o envio.
UPDATE public.clicksign_envelopes SET status = 'canceled' WHERE id = :'epag';
-- Nova versão do contrato pelo jurídico: pode ir à Clicksign.
INSERT INTO public.sale_documents (sale_id, tipo, parte, storage_path, file_name, status, organization_id, created_at)
  VALUES (:'vass', 'contrato', 'outros', :'orga' || '/' || :'vass' || '/outros/contrato/v2.pdf', 'contrato-v2.pdf',
          'enviado', :'orga', clock_timestamp());
SELECT pg_temp.as_user(:'admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.t(format('SELECT public.clicksign_sale_authorize(%L)->>''contrato''', :'vass')) !~ '^ERRO'
  AND pg_temp.t(format('SELECT public.clicksign_sale_authorize(%L)->>''contrato''', :'vass')) <> :'dass',
  '5 nova versão do contrato: envio liberado');
SELECT pg_temp.ok(pg_temp.t(format('SELECT public.clicksign_sale_authorize(%L)->>''contrato''', :'vpag')) = :'dpag',
  '5 venda sem envelope assinado continua podendo ir à Clicksign');
RESET ROLE;

SELECT (CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END) || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
