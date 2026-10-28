-- Suíte da transferência de captação entre corretores (migration 20261028140000, t_997545e5).
-- Roda DENTRO de transação revertida (run-captacao-transferir-corretor.sh), em banco local descartável
-- ou homologação; nunca em produção. Dados 100% fictícios, criados aqui.
-- Imobiliária A: dona (admin), gestor (líder da equipe), team leader (co-líder, sem papel de gestor),
--   corretor que sai (C1), corretor que recebe (C2), corretor inativo (C3).
-- Imobiliária B: gestor B e corretor B.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true) $$;

\set org_a 'a0000000-0000-4000-8000-0000000000a0'
\set org_b 'b0000000-0000-4000-8000-0000000000b0'
\set admin 'a0000000-0000-4000-8000-000000000001'
\set gestor 'a0000000-0000-4000-8000-000000000002'
\set tl 'a0000000-0000-4000-8000-000000000003'
\set c1 'a0000000-0000-4000-8000-000000000004'
\set c2 'a0000000-0000-4000-8000-000000000005'
\set c3 'a0000000-0000-4000-8000-000000000006'
\set gb 'b0000000-0000-4000-8000-000000000001'
\set cb 'b0000000-0000-4000-8000-000000000002'
\set team 'a0000000-0000-4000-8000-0000000000f1'
\set unit 'a0000000-0000-4000-8000-0000000000e1'
\set cap_r 'c0000000-0000-4000-8000-000000000001'
\set cap_d 'c0000000-0000-4000-8000-000000000002'
\set cap_a 'c0000000-0000-4000-8000-000000000003'
\set cap_s 'c0000000-0000-4000-8000-000000000004'
\set cap_e 'c0000000-0000-4000-8000-000000000005'
\set cap_x 'c0000000-0000-4000-8000-000000000006'
\set cap_b 'c0000000-0000-4000-8000-000000000007'

-- Montagem (sem gatilhos, só nesta transação) -----------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'org_a', 'teste-transf-a', 'Imobiliária Exemplo A', 'ativa', '00000000000191', '#112233', '#445566'),
  (:'org_b', 'teste-transf-b', 'Imobiliária Exemplo B', 'ativa', '00000000000272', '#112233', '#445566');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (:'org_a', 'captacao_exclusiva', true), (:'org_b', 'captacao_exclusiva', true);
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'admin', :'gestor', :'tl', :'c1', :'c2', :'c3', :'gb', :'cb']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id, cpf, creci) VALUES
  (:'admin', 'Dona Exemplo', 'dona@exemplo.test', true, :'org_a', NULL, NULL),
  (:'gestor', 'Gestor Exemplo', 'gestor@exemplo.test', true, :'org_a', NULL, NULL),
  (:'tl', 'Lider Exemplo', 'tl@exemplo.test', true, :'org_a', NULL, NULL),
  (:'c1', 'Carlos Saiu', 'c1@exemplo.test', true, :'org_a', '11144477735', 'CRECI 11111'),
  (:'c2', 'Bruno Novo', 'c2@exemplo.test', true, :'org_a', '52998224725', 'CRECI 22222'),
  (:'c3', 'Ana Inativa', 'c3@exemplo.test', false, :'org_a', NULL, NULL),
  (:'gb', 'Gestor B', 'gb@exemplo.test', true, :'org_b', NULL, NULL),
  (:'cb', 'Corretor B', 'cb@exemplo.test', true, :'org_b', NULL, NULL);
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org_a', :'admin', true), (:'org_a', :'gestor', true), (:'org_a', :'tl', true), (:'org_a', :'c1', true),
  (:'org_a', :'c2', true), (:'org_a', :'c3', true), (:'org_b', :'gb', true), (:'org_b', :'cb', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'admin', 'admin', :'org_a'), (:'gestor', 'gestor', :'org_a'), (:'tl', 'team_leader', :'org_a'),
  (:'c1', 'corretor', :'org_a'), (:'c2', 'corretor', :'org_a'), (:'c3', 'corretor', :'org_a'),
  (:'gb', 'gestor', :'org_b'), (:'gb', 'admin', :'org_b'), (:'cb', 'corretor', :'org_b');
INSERT INTO public.teams (id, lider_id, nome, organization_id) VALUES (:'team', :'gestor', 'Equipe Exemplo', :'org_a');
INSERT INTO public.team_members (membro_id, team_id, organization_id) VALUES
  (:'c1', :'team', :'org_a'), (:'c2', :'team', :'org_a'), (:'c3', :'team', :'org_a');
INSERT INTO public.team_co_leaders (team_id, user_id, organization_id) VALUES (:'team', :'tl', :'org_a');
INSERT INTO public.exclusive_units (id, organization_id, nome, creci, razao_social, endereco, cidade, estado, cnpj, nome_comercial)
  VALUES (:'unit', :'org_a', 'Unidade Exemplo', 'J-0001', 'Exemplo Ltda', 'Rua Exemplo, 1', 'Sorocaba', 'SP', '00000000000191', 'Exemplo');
INSERT INTO public.exclusive_captures (id, captor_id, created_by, template, unit_id, status, form_data,
    broker_name, broker_cpf, broker_creci, organization_id, signed_on, manual) VALUES
  (:'cap_r', :'c1', :'c1', 'remax-padrao', :'unit', 'rascunho', '{"imovel":{"endereco":"Rua A, 1","bairro":"Centro"}}', 'Carlos Saiu', '11144477735', 'CRECI 11111', :'org_a', NULL, false),
  (:'cap_d', :'c1', :'c1', 'remax-padrao', :'unit', 'devolvida', '{"imovel":{"endereco":"Rua D, 2"}}', 'Carlos Saiu', '11144477735', 'CRECI 11111', :'org_a', NULL, false),
  (:'cap_a', :'c1', :'c1', 'remax-padrao', :'unit', 'aprovada', '{"imovel":{"endereco":"Rua Assinada, 3"}}', 'Carlos Saiu', '11144477735', 'CRECI 11111', :'org_a', current_date, false),
  (:'cap_s', :'c1', :'c1', 'remax-padrao', :'unit', 'em_assinatura', '{}', 'Carlos Saiu', '11144477735', 'CRECI 11111', :'org_a', NULL, false),
  (:'cap_e', :'c1', :'c1', 'remax-padrao', :'unit', 'enviada', '{}', 'Carlos Saiu', '11144477735', 'CRECI 11111', :'org_a', NULL, false),
  (:'cap_x', :'c1', :'c1', 'remax-padrao', :'unit', 'aprovada', '{}', 'Carlos Saiu', '11144477735', 'CRECI 11111', :'org_a', current_date, false),
  (:'cap_b', :'cb', :'cb', 'campolim', NULL, 'rascunho', '{}', 'Corretor B', '', '', :'org_b', NULL, false);
INSERT INTO public.exclusive_history (capture_id, actor_id, action, organization_id) VALUES
  (:'cap_a', :'gestor', 'aprovar', :'org_a'), (:'cap_x', :'gestor', 'aprovar', :'org_a');
INSERT INTO public.exclusive_documents (capture_id, kind, owner_index, storage_path, file_name, uploaded_by, organization_id) VALUES
  (:'cap_r', 'gerado', 0, 'x/r-gerado.pdf', 'gerado.pdf', :'gestor', :'org_a'),
  (:'cap_a', 'assinado', 0, 'x/a-assinado.pdf', 'assinado.pdf', :'gestor', :'org_a'),
  (:'cap_e', 'gerado', 0, 'x/e-gerado.pdf', 'gerado.pdf', :'gestor', :'org_a');
INSERT INTO public.clicksign_envelopes (organization_id, origem, capture_id, source_document_id, status, is_test, created_by)
  SELECT :'org_a', 'captacao', :'cap_e', d.id, 'running', true, :'gestor' FROM public.exclusive_documents d
   WHERE d.capture_id = :'cap_e' AND d.kind = 'gerado';
INSERT INTO public.leads (id, organization_id, nome, telefone, origem, etapa, capture_id, captador_id, responsavel_id) VALUES
  ('d0000000-0000-4000-8000-000000000001', :'org_a', 'Lead Aberto', '15900000001', 'manual', 'em_atendimento', :'cap_a', :'c1', :'c1'),
  ('d0000000-0000-4000-8000-000000000002', :'org_a', 'Lead Ganho', '15900000002', 'manual', 'ganho', :'cap_a', :'c1', :'c1');
INSERT INTO public.sales (id, corretor_id, organization_id, exclusive_capture_id, corretor_captador_id, corretor_captador)
  VALUES ('e0000000-0000-4000-8000-000000000001', :'c1', :'org_a', :'cap_a', :'c1', 'Carlos Saiu');
SET LOCAL session_replication_role = origin;

-- Crédito no painel ANTES (Minha carreira do C1)
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c1');
SELECT captacoes AS c1_antes FROM public.meu_realizado(date_trunc('month', current_date)::date, current_date) \gset

-- 1) Permissão ------------------------------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transferir(ARRAY[%L]::uuid[], %L, %L)', :'cap_r', :'c2', 'Saiu da imobiliária')) LIKE '42501%',
  'corretor (dono da captação) NÃO transfere');
SELECT pg_temp.ok(pg_temp.err('SELECT * FROM public.exclusive_transferencia_destinos()') LIKE '42501%', 'corretor não lista destinos');
SELECT pg_temp.as_user(:'tl');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transferir(ARRAY[%L]::uuid[], %L, %L)', :'cap_r', :'c2', 'Saiu da imobiliária')) LIKE '42501%',
  'team leader (co-líder, sem papel de gestor) NÃO transfere');
SELECT pg_temp.ok(NOT public.exclusive_pode_transferir(:'cap_r', :'tl'), 'team leader: pode_transferir = falso');
SELECT pg_temp.as_user(:'gb');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transferir(ARRAY[%L]::uuid[], %L, %L)', :'cap_r', :'cb', 'Saiu da imobiliária')) LIKE '42501%',
  'gestor/admin de OUTRA imobiliária não transfere captação da A');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_transferencia_previa(:'c1')) = 0, 'gestor da B não vê a prévia do corretor da A');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.exclusive_transferencia_destinos() WHERE id = :'c2'), 'gestor da B não lista corretores da A');

-- 2) Destino e motivo -----------------------------------------------------------------------------
SELECT pg_temp.as_user(:'gestor');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transferir(ARRAY[%L]::uuid[], %L, %L)', :'cap_r', :'c3', 'Saiu')) LIKE '%corretor ativo%',
  'destino INATIVO bloqueado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transferir(ARRAY[%L]::uuid[], %L, %L)', :'cap_r', :'cb', 'Saiu')) LIKE '%corretor ativo%',
  'destino de outra imobiliária bloqueado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transferir(ARRAY[%L]::uuid[], %L, %L)', :'cap_r', :'c2', '  ')) LIKE '%motivo%',
  'motivo obrigatório');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transferir(ARRAY[%L]::uuid[], %L, %L)', :'cap_r', :'c1', 'Saiu')) LIKE '%já é desse corretor%',
  'não transfere para o próprio captador');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.exclusive_transferencia_destinos() WHERE id = :'c3'), 'inativo fora da lista de destinos');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.exclusive_transferencia_destinos() WHERE id = :'c2'), 'C2 na lista de destinos');

-- 3) Contrato em assinatura bloqueia (status e envelope Clicksign) e não muda nada -----------------
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transferir(ARRAY[%L,%L]::uuid[], %L, %L)', :'cap_r', :'cap_s', :'c2', 'Saiu')) LIKE '%assinatura%',
  'em_assinatura bloqueia o lote inteiro');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.exclusive_transferir(ARRAY[%L]::uuid[], %L, %L)', :'cap_e', :'c2', 'Saiu')) LIKE '%assinatura%',
  'envelope Clicksign em andamento bloqueia');
RESET ROLE;
SELECT pg_temp.ok((SELECT captor_id FROM public.exclusive_captures WHERE id = :'cap_r') = :'c1', 'lote recusado: rascunho continua com C1');
SELECT pg_temp.ok((SELECT status FROM public.clicksign_envelopes WHERE capture_id = :'cap_e') = 'running', 'envelope intocado');

-- 4) Prévia e lote com desmarcado (dona transfere 3 de 4 transferíveis; cap_x desmarcada) --------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'admin');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_transferencia_previa(:'c1')) = 6, 'prévia lista as 6 captações do C1');
SELECT pg_temp.ok((SELECT bloqueio IS NOT NULL FROM public.exclusive_transferencia_previa(:'c1') WHERE id = :'cap_s'), 'prévia marca em_assinatura como bloqueada');
SELECT pg_temp.ok((SELECT contrato FROM public.exclusive_transferencia_previa(:'c1') WHERE id = :'cap_a') = 'mantido', 'prévia: aprovada mantém contrato');
SELECT pg_temp.ok((SELECT leads_abertos FROM public.exclusive_transferencia_previa(:'c1') WHERE id = :'cap_a') = 1, 'prévia conta 1 lead aberto');
SELECT public.exclusive_transferir(ARRAY[:'cap_r', :'cap_d', :'cap_a']::uuid[], :'c2', 'Corretor saiu da imobiliária') AS res \gset
SELECT pg_temp.ok((:'res'::jsonb->>'transferidas')::int = 3 AND (:'res'::jsonb->>'contratos_atualizados')::int = 2
  AND (:'res'::jsonb->>'contratos_mantidos')::int = 1 AND (:'res'::jsonb->>'leads')::int = 1, 'lote: 3 transferidas, 2 contratos atualizados, 1 mantido, 1 lead');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_captures WHERE captor_id = :'c2') = 3, 'C2 recebeu as 3 marcadas');
SELECT pg_temp.ok((SELECT captor_id FROM public.exclusive_captures WHERE id = :'cap_x') = :'c1', 'desmarcada (cap_x) ficou com C1');
SELECT pg_temp.ok((SELECT captor_id FROM public.exclusive_captures WHERE id = :'cap_s') = :'c1', 'em assinatura ficou com C1');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_captures WHERE captador_original_id = :'c1') = 3, 'captador original gravado nas 3');
SELECT pg_temp.ok((SELECT created_by FROM public.exclusive_captures WHERE id = :'cap_a') = :'c1', 'created_by não muda');

-- 5) Contrato assinado intacto / rascunho atualizado --------------------------------------------
SELECT pg_temp.ok((SELECT broker_name = 'Carlos Saiu' AND broker_cpf = '11144477735' AND broker_creci = 'CRECI 11111'
  FROM public.exclusive_captures WHERE id = :'cap_a'), 'aprovada: contrato segue no nome do C1');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id = :'cap_a' AND kind = 'assinado'), 'PDF assinado continua');
SELECT pg_temp.ok((SELECT broker_name = 'Bruno Novo' AND broker_cpf = '52998224725' AND broker_creci = 'CRECI 22222'
  FROM public.exclusive_captures WHERE id = :'cap_r'), 'rascunho: nome, CPF e CRECI do C2');
SELECT pg_temp.ok((SELECT broker_name FROM public.exclusive_captures WHERE id = :'cap_d') = 'Bruno Novo', 'devolvida: nome do C2');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.exclusive_documents WHERE capture_id = :'cap_r' AND kind = 'gerado'), 'rascunho: PDF gerado no nome antigo descartado');

-- 6) Venda antiga e leads -------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT corretor_captador_id = :'c1' AND corretor_captador = 'Carlos Saiu' FROM public.sales
  WHERE id = 'e0000000-0000-4000-8000-000000000001'), 'venda antiga intacta (captador C1)');
SELECT pg_temp.ok((SELECT captador_id FROM public.leads WHERE id = 'd0000000-0000-4000-8000-000000000001') = :'c2', 'lead aberto passou para C2');
SELECT pg_temp.ok((SELECT captador_id FROM public.leads WHERE id = 'd0000000-0000-4000-8000-000000000002') = :'c1', 'lead ganho ficou com C1');

-- 7) Histórico e notificação ---------------------------------------------------------------------
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_history WHERE action = 'transferida') = 3, '3 linhas de histórico');
SELECT pg_temp.ok((SELECT h.actor_id = :'admin' AND (h.detail::jsonb->>'de') = :'c1' AND (h.detail::jsonb->>'para') = :'c2'
  AND h.detail::jsonb->>'motivo' = 'Corretor saiu da imobiliária' AND h.detail::jsonb->>'de_nome' = 'Carlos Saiu'
  AND h.detail::jsonb->>'para_nome' = 'Bruno Novo' AND h.detail::jsonb->>'contrato' = 'mantido' AND h.created_at IS NOT NULL
  FROM public.exclusive_history h WHERE h.capture_id = :'cap_a' AND h.action = 'transferida'), 'histórico: quem, quando, de, para, motivo');
SELECT pg_temp.ok((SELECT count(*) FROM public.notifications WHERE tipo = 'captacao_transferida') = 1, '1 aviso no sino para o lote');
SELECT pg_temp.ok((SELECT user_id = :'c2' AND organization_id = :'org_a' AND titulo LIKE '3 captações%' AND mensagem LIKE '%Motivo: Corretor saiu%'
  FROM public.notifications WHERE tipo = 'captacao_transferida'), 'aviso vai para o C2 com o motivo');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok((SELECT count(*) FROM public.exclusive_history_view(:'cap_a') WHERE action = 'transferida') = 1, 'C2 vê o histórico dentro da captação');
SELECT pg_temp.ok(public.exclusive_can_view(:'cap_a', :'c2'), 'C2 passa a ver a captação');
SELECT pg_temp.as_user(:'c1');
SELECT pg_temp.ok(NOT public.exclusive_can_view(:'cap_a', :'c1'), 'C1 deixa de ver a captação transferida');

-- 8) Painel / Minha carreira mantêm o crédito de quem captou ---------------------------------------
SELECT pg_temp.ok((SELECT captacoes FROM public.meu_realizado(date_trunc('month', current_date)::date, current_date)) = :c1_antes
  AND :c1_antes = 2, 'Minha carreira do C1: continua com 2 captações no mês');
SELECT pg_temp.as_user(:'c2');
SELECT pg_temp.ok((SELECT captacoes FROM public.meu_realizado(date_trunc('month', current_date)::date, current_date)) = 0, 'Minha carreira do C2: 0 (só é responsável)');
SELECT pg_temp.as_user(:'gestor');
SELECT public.painel_equipe_dados(:'team', current_date) -> 'exclusivas' AS exc \gset
SELECT pg_temp.ok((SELECT e->>'captor_id' = :'c1' AND e->>'responsavel_id' = :'c2'
  FROM jsonb_array_elements(:'exc'::jsonb) e WHERE e->>'id' = :'cap_a'), 'Painel da equipe: captou C1, responsável C2');

-- 9) Segunda transferência não apaga quem captou ---------------------------------------------------
SELECT public.exclusive_transferir(ARRAY[:'cap_d']::uuid[], :'gestor', 'Redistribuição da carteira') AS res2 \gset
RESET ROLE;
SELECT pg_temp.ok((SELECT captor_id = :'gestor' AND captador_original_id = :'c1' FROM public.exclusive_captures WHERE id = :'cap_d'),
  '2ª transferência: captador original continua C1');
SELECT pg_temp.ok((SELECT count(*) FROM public.notifications WHERE tipo = 'captacao_transferida') = 1,
  'quem transfere para si mesmo não recebe aviso');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA' END || ' ' || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
