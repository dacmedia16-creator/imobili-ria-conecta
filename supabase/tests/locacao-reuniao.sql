-- Suíte da migration 20261201150000 (reunião 16/11 da Locação, t_8f09d406). Roda DENTRO de transação revertida
-- (run-locacao-reuniao.sh), na homologação, só com dados fictícios. Pessoas da homologação (Agência A):
-- c2 = QA A Corretor Dois (corretor, membro da "Equipe QA", líder = QA A Gestor [gestor]),
-- tl = QA A Corretor Um [team_leader], a1 = UE Corretor (membro da "Equipe UE", líder UE Gestor [corretor+gestor]),
-- con = QA A Dono Plataforma (contratos + vistoria = Fernanda), ges = gestora, b1/admB = Agência B.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE js(k text PRIMARY KEY, v jsonb);
CREATE TEMP TABLE mp(k text PRIMARY KEY, path text);
GRANT ALL ON r, ids, js, mp TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN _uid = '' THEN '' ELSE json_build_object('sub', _uid, 'role', 'authenticated')::text END, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.j(_k text) RETURNS jsonb LANGUAGE sql AS $$ SELECT v FROM js WHERE k = _k $$;
CREATE FUNCTION pg_temp.put(_k text, _v jsonb) RETURNS jsonb LANGUAGE sql AS $$
  INSERT INTO js VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
CREATE FUNCTION pg_temp.setid(_k text, _v uuid) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO ids VALUES (_k, _v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v; SELECT _v $$;
CREATE FUNCTION pg_temp.arquivo(_k text, _path text) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO mp VALUES (_k, _path) ON CONFLICT (k) DO UPDATE SET path = EXCLUDED.path;
  INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ('locacao-documentos', _path, NULL,
    '{"mimetype":"application/pdf"}'::jsonb);
  SELECT _path $$;
CREATE FUNCTION pg_temp.p(_k text) RETURNS text LANGUAGE sql AS $$ SELECT path FROM mp WHERE k = _k $$;
CREATE FUNCTION pg_temp.loc(_k text) RETURNS public.locacoes LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT l FROM public.locacoes l WHERE l.id = (SELECT v FROM ids WHERE k = _k) $$;
CREATE FUNCTION pg_temp.avisos(_k text) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT coalesce(string_agg(evento, ',' ORDER BY criado_em, evento), '') FROM public.locacao_avisos
   WHERE locacao_id = (SELECT v FROM ids WHERE k = _k) $$;
CREATE FUNCTION pg_temp.cli(_org text, _doc text) RETURNS public.clientes LANGUAGE sql SECURITY DEFINER AS $$
  SELECT c FROM public.clientes c WHERE c.organization_id = (SELECT v FROM ids WHERE k = _org) AND c.cpf_cnpj_normalizado = _doc $$;
CREATE FUNCTION pg_temp.ncli(_doc text) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS
  $$ SELECT count(*) FROM public.clientes WHERE cpf_cnpj_normalizado = _doc $$;
-- Funções internas (fechadas ao navegador) são conferidas pelo dono do banco.
CREATE FUNCTION pg_temp.pre_f(_k text) RETURNS text[] LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.locacao_pre_faltando(pg_temp.loc(_k)) $$;
CREATE FUNCTION pg_temp.chk(_k text) RETURNS text[] LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.locacao_checklist_l(pg_temp.loc(_k)) $$;
CREATE FUNCTION pg_temp.falt(_k text) RETURNS text[] LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.locacao_docs_faltando(pg_temp.loc(_k)) $$;
CREATE FUNCTION pg_temp.cfalt(_k text) RETURNS text[] LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.locacao_contrato_faltando(pg_temp.loc(_k)) $$;
CREATE FUNCTION pg_temp.grp(_o uuid, _g text) RETURNS text[] LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.locacao_docs_grupo(_o, _g) $$;
CREATE FUNCTION pg_temp.fok(_f jsonb) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT public.locacao_ficha_ok(_f) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, service_role;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4'), ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('ges', 'a742cfda-4731-4fa8-989a-374d2fdf0820'), ('con', 'b316b223-da46-4c2c-9952-25096d5ae5ff'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('b1', '23e65aaf-2614-463e-baec-cf562bb94244'),
  ('admB', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536'), ('tl', '5745cbff-22b6-4a28-a515-dd6706504b8b'),
  ('gQA', 'cab7391a-463f-4d97-b99b-ced6e4696796'), ('gUE', '10000000-0000-4000-8000-000000000002'),
  ('eqQA', 'ca3efa47-cbae-4e72-995e-f54fcb86f1d9'), ('eqUE', '1a000000-0000-4000-8000-000000000001');
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES (pg_temp.id('orgA'), 'locacao', true),
  (pg_temp.id('orgB'), 'locacao', true)
ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
INSERT INTO public.locacao_papeis (organization_id, user_id, papel) VALUES (pg_temp.id('orgA'), pg_temp.id('ges'), 'gestora'),
  (pg_temp.id('orgA'), pg_temp.id('con'), 'contratos'), (pg_temp.id('orgA'), pg_temp.id('con'), 'vistoria')
ON CONFLICT DO NOTHING;
-- Team Leader como líder auxiliar da Equipe QA (o líder principal é o Gestor).
INSERT INTO public.team_co_leaders (team_id, user_id, organization_id) VALUES (pg_temp.id('eqQA'), pg_temp.id('tl'), pg_temp.id('orgA'))
ON CONFLICT DO NOTHING;
-- Lista de documentos da A SEM o comprovante de renda (para provar que o banco o devolve).
INSERT INTO public.locacao_config (organization_id, documentos) VALUES (pg_temp.id('orgA'),
  '{"locatario":["RG/CNH do locatário","CPF do locatário"],"proprietario":["RG/CNH do proprietário"]}')
ON CONFLICT (organization_id) DO UPDATE SET documentos = EXCLUDED.documentos;

-- 0) Estrutura e permissões ----------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.locacao_lancamentos'::regclass,
    'public.locacao_avisos'::regclass, 'public.locacao_clientes'::regclass))
  AND NOT has_table_privilege('authenticated', 'public.locacao_lancamentos', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.locacao_avisos', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.locacao_clientes', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.locacao_avisos', 'SELECT'), 'tabelas novas com RLS e fechadas ao navegador');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('locacao_criar', 'locacao_imovel_tipo_definir', 'locacao_lancamento_ler', 'locacao_lancamento_salvar',
                     'locacao_avisos_pode')
   AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR NOT p.prosecdef OR NOT coalesce('search_path=""' = ANY (p.proconfig), false))),
  'RPCs novas: só com login, SECURITY DEFINER e search_path vazio');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('locacao_avisos_reservar', 'locacao_avisos_concluir', 'locacao_clientes_sincronizar', 'locacao_equipe_do_corretor',
                     'locacao_aviso_novo', 'locacao_trg_avisos', 'locacao_trg_clientes', 'locacao_trg_abertura')
   AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))),
  'funções internas (fila do WhatsApp, cadastro de clientes, equipe) fora do alcance do navegador');
SELECT pg_temp.ok(has_function_privilege('service_role', 'public.locacao_avisos_reservar(uuid, integer)', 'EXECUTE'),
  'fila do WhatsApp só para o servidor (service_role)');

-- 1) Abrir com o tipo do imóvel + equipe gravada (itens 2 e 5) ------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.locacao_criar(''apartamento'')') LIKE '22023%Tipo de imóvel inválido%',
  'tipo fora da lista é recusado');
SELECT pg_temp.setid('C', (public.locacao_criar('condominio')->>'id')::uuid);
SELECT pg_temp.setid('K', (public.locacao_criar('comercial')->>'id')::uuid);
SELECT pg_temp.setid('S', (public.locacao_criar()->>'id')::uuid);
SELECT pg_temp.put('C', public.locacao_detalhe(pg_temp.id('C')));
SELECT pg_temp.ok(pg_temp.j('C')->>'imovel_tipo' = 'condominio' AND pg_temp.j('C')->>'tipo' = 'residencial',
  'condomínio abre como residencial');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('K'))->>'tipo' = 'comercial', 'comercial abre como comercial (prazo 36 na tela)');
SELECT pg_temp.ok(pg_temp.j('C')->>'equipe_nome' = 'Equipe QA qa9-3beecc'
  AND (pg_temp.j('C')->>'equipe_gestor_id')::uuid = pg_temp.id('gQA') AND pg_temp.j('C')->>'equipe_gestor_nome' = 'QA A Gestor'
  AND (pg_temp.j('C')->>'equipe_tl_id')::uuid = pg_temp.id('tl') AND pg_temp.j('C')->>'equipe_tl_nome' = 'QA A Corretor Um'
  AND pg_temp.j('C')->>'equipe_gravada_em' IS NOT NULL, 'abertura grava equipe, Gestor e Team Leader do corretor');
SELECT pg_temp.ok(pg_temp.pre_f('S') @> ARRAY['tipo do imóvel']
  AND NOT pg_temp.pre_f('C') @> ARRAY['tipo do imóvel'], 'sem tipo, a pré-aprovação cobra o tipo');
SELECT public.locacao_imovel_tipo_definir(pg_temp.id('S'), 'casa');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('S'))->>'imovel_tipo' = 'casa', 'corretor define/troca o tipo na pré-análise');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_imovel_tipo_definir(%L, ''comercial'')', pg_temp.id('S'))) LIKE '42501%',
  'outro corretor não troca o tipo');
SELECT pg_temp.setid('U', (public.locacao_criar('casa')->>'id')::uuid);
SELECT pg_temp.ok((pg_temp.loc('U')).equipe_nome = 'Equipe UE' AND (pg_temp.loc('U')).equipe_gestor_id = pg_temp.id('gUE')
  AND (pg_temp.loc('U')).equipe_tl_id IS NULL, 'equipe sem Team Leader: grava só o Gestor');
-- Corretor troca de equipe: a locação continua com o que foi gravado na abertura.
RESET ROLE;
DELETE FROM public.team_members WHERE membro_id = pg_temp.id('c2') AND team_id = pg_temp.id('eqQA');
INSERT INTO public.team_members (team_id, membro_id, tipo, organization_id)
SELECT pg_temp.id('eqUE'), pg_temp.id('c2'), tipo, organization_id FROM public.team_members WHERE team_id = pg_temp.id('eqUE') LIMIT 1;
UPDATE public.locacoes SET equipe_nome = 'Outra', equipe_gestor_id = NULL WHERE id = pg_temp.id('C');
SELECT pg_temp.ok((pg_temp.loc('C')).equipe_nome = 'Equipe QA qa9-3beecc' AND (pg_temp.loc('C')).equipe_gestor_id = pg_temp.id('gQA'),
  'trocar de equipe (ou tentar regravar) não muda a equipe gravada');
SELECT pg_temp.ok((SELECT equipe_id IS NULL FROM public.locacoes WHERE organization_id = pg_temp.id('orgA')
   AND id NOT IN (SELECT v FROM ids) ORDER BY criado_em LIMIT 1) IS NOT FALSE, 'locações antigas ficam sem equipe (sem retroativo)');

-- 2) Ficha com complemento + parte "Condomínio" (itens 1 e 2) -------------------------------------------------------
SELECT pg_temp.ok(pg_temp.fok('{"complemento":"Bloco B, apto 42"}') AND NOT pg_temp.fok(jsonb_build_object('complemento', repeat('x', 101)))
  AND NOT pg_temp.fok('{"complemento":12}'), 'complemento: texto até 100 caracteres');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_salvar_pre(pg_temp.id('C'), '{"endereco":"Rua Fictícia dos Testes, 100 — Sorocaba/SP","garantia":"seguro_fianca","aluguel":2500,"ficha":{"cep":"18000-000","complemento":"Bloco B, apto 42"}}');
SELECT pg_temp.ok((SELECT x->>'complemento' FROM jsonb_array_elements(public.locacao_lista()) x WHERE (x->>'id')::uuid = pg_temp.id('C'))
  = 'Bloco B, apto 42', 'complemento aparece na lista');
SELECT pg_temp.ok((SELECT x->>'equipe_nome' FROM jsonb_array_elements(public.locacao_lista()) x WHERE (x->>'id')::uuid = pg_temp.id('C'))
  = 'Equipe QA qa9-3beecc', 'equipe aparece na lista (filtro na tela)');
SELECT pg_temp.ok(public.locacao_detalhe(pg_temp.id('C'))->>'tipo' = 'residencial', 'salvar a ficha não troca a modalidade');
SELECT pg_temp.ok(pg_temp.chk('C') @> ARRAY['CND do condomínio (opcional)']
  AND NOT pg_temp.chk('S') @> ARRAY['CND do condomínio (opcional)']
  AND NOT pg_temp.chk('K') @> ARRAY['CND do condomínio (opcional)'], 'CND do condomínio só para condomínio');
SELECT pg_temp.ok(NOT pg_temp.falt('C') @> ARRAY['CND do condomínio (opcional)'], 'CND não trava (opcional)');

-- 3) Comprovante de renda sempre no checklist do locatário (item 3) -------------------------------------------------
SELECT pg_temp.ok(pg_temp.chk('C') @> ARRAY['Comprovante de renda do locatário']
  AND pg_temp.falt('C') @> ARRAY['Comprovante de renda do locatário'],
  'seguro-fiança: comprovante de renda obrigatório mesmo com a lista da imobiliária sem ele');
SELECT pg_temp.ok(pg_temp.grp(pg_temp.id('orgB'), 'locatario') @> ARRAY['Comprovante de renda do locatário']
  AND (SELECT count(*) FROM unnest(pg_temp.grp(pg_temp.id('orgB'), 'locatario')) x WHERE x ~* 'renda') = 1,
  'lista padrão: comprovante de renda uma vez só (sem duplicar)');
SELECT pg_temp.ok(NOT pg_temp.grp(pg_temp.id('orgA'), 'fiador') @> ARRAY['Comprovante de renda do locatário'],
  'só o grupo do locatário ganha o item');

-- 4) Prazo, vencimento e moradores obrigatórios em todas as garantias (item 4) --------------------------------------
RESET ROLE;
SELECT pg_temp.as_user('');
UPDATE public.locacoes SET etapa = 'documentacao', candidato = '{"nome":"Locatário Fictício","cpf":"529.982.247-25"}'
 WHERE id = pg_temp.id('C');
INSERT INTO public.locacao_documentos (organization_id, locacao_id, item, storage_path, nome_arquivo)
SELECT pg_temp.id('orgA'), pg_temp.id('C'), x, 'reuniao-teste/' || md5(x) || '.pdf', 'doc-ficticio.pdf'
  FROM unnest(pg_temp.chk('C')) x WHERE NOT public.locacao_doc_opcional(x);
SELECT pg_temp.ok(pg_temp.cfalt('C') = ARRAY['prazo (meses)', 'dia de vencimento', 'moradores'],
  'seguro-fiança: faltam prazo, vencimento e moradores');
SELECT pg_temp.ok(pg_temp.cfalt('K') @> ARRAY['prazo (meses)', 'dia de vencimento', 'moradores'],
  'comercial também pede os três');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_enviar_documentacao(%L)', pg_temp.id('C')))
  LIKE '22023%Complete os dados do contrato: prazo (meses), dia de vencimento, moradores%', 'trava o envio da Documentação');
SELECT pg_temp.ok((public.locacao_contrato_salvar(pg_temp.id('C'), '{"prazo_meses":"30","prop_nome":"Proprietária Fictícia"}')->'faltando')
  = '["dia de vencimento", "moradores"]', '"salvar e completar depois" continua: salva parcial');
SELECT public.locacao_contrato_salvar(pg_temp.id('C'), '{"dia_vencimento":"10","moradores":"Locatário Fictício e 1 filho",
  "loc_rg":"12.345.678-9","prop_cpf":"935.411.347-80","prop_email":"prop.ficticia@exemplo.com"}');
SELECT pg_temp.ok(public.locacao_enviar_documentacao(pg_temp.id('C'))->>'etapa' = 'conferencia', 'com os três preenchidos, segue');

-- 5) Clientes no cadastro de clientes (item 8) ---------------------------------------------------------------------
SELECT pg_temp.ok(pg_temp.ncli('52998224725') = 1 AND (pg_temp.cli('orgA', '52998224725')).nome = 'Locatário Fictício'
  AND (pg_temp.cli('orgA', '52998224725')).rg = '12.345.678-9' AND (pg_temp.cli('orgA', '52998224725')).tipo_pessoa = 'fisica',
  'locatário entra no cadastro de clientes da imobiliária (por CPF)');
SELECT pg_temp.ok((pg_temp.cli('orgA', '93541134780')).nome = 'Proprietária Fictícia', 'proprietário também entra');
RESET ROLE;
SELECT pg_temp.as_user('');
-- Cliente que já existia (de uma venda): não duplica, não troca o nome, só completa o vazio.
INSERT INTO public.clientes (organization_id, tipo_pessoa, nome, cpf_cnpj, telefone)
VALUES (pg_temp.id('orgA'), 'fisica', 'Fiador Já Cadastrado', '390.533.447-05', '(15) 99999-0000'),
       (pg_temp.id('orgB'), 'fisica', 'Mesmo CPF na B', '390.533.447-05', NULL);
INSERT INTO public.locacoes (organization_id, corretor_id, etapa, endereco, aluguel, garantia, tipo, imovel_tipo, candidato)
VALUES (pg_temp.id('orgA'), pg_temp.id('c2'), 'documentacao', 'Rua do Fiador, 5 (fictícia)', 1800, 'fiador', 'residencial', 'casa',
        '{"nome":"Outro Locatário","cpf":"529.982.247-25"}') RETURNING pg_temp.setid('F', id);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_contrato_salvar(pg_temp.id('F'), '{"fia_cpf":"390.533.447-05","fia_nome":"Nome Diferente","fia_email":"fiador@exemplo.com","fia_telefone":"(15) 1111-1111"}');
SELECT pg_temp.ok(pg_temp.ncli('39053344705') = 2 AND (pg_temp.cli('orgA', '39053344705')).nome = 'Fiador Já Cadastrado'
  AND (pg_temp.cli('orgA', '39053344705')).email = 'fiador@exemplo.com'
  AND (pg_temp.cli('orgA', '39053344705')).telefone = '(15) 99999-0000'
  AND (pg_temp.cli('orgB', '39053344705')).email IS NULL, 'já existia: não duplica, não troca o que tinha, completa o vazio; a B não é tocada');
SELECT pg_temp.ok(pg_temp.ncli('52998224725') = 1 AND (pg_temp.cli('orgA', '52998224725')).nome = 'Locatário Fictício',
  'mesmo locatário em 2 locações = 1 cadastro');
RESET ROLE;
SELECT pg_temp.ok((SELECT string_agg(papel, ',' ORDER BY papel) FROM public.locacao_clientes WHERE locacao_id = pg_temp.id('F'))
  = 'fiador,locatario', 'ligação locação ↔ cliente por papel');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_clientes_sincronizar(%L)', pg_temp.id('F'))) IS NULL
  AND (SELECT count(*) FROM public.locacao_clientes WHERE locacao_id = pg_temp.id('F')) = 2, 'rodar de novo não duplica nada');

-- 6) Avisos por WhatsApp ao corretor (item 7) -----------------------------------------------------------------------
SELECT pg_temp.as_user('');
INSERT INTO public.locacoes (organization_id, corretor_id, etapa, endereco, aluguel, garantia, tipo, imovel_tipo, minuta)
VALUES (pg_temp.id('orgA'), pg_temp.id('c2'), 'minuta', 'Rua da Minuta, 7 (fictícia)', 2100, 'seguro_fianca', 'residencial', 'casa',
        '{"estado":"elaborando","externa":false}') RETURNING pg_temp.setid('M', id);
INSERT INTO public.locacao_documentos (organization_id, locacao_id, item, storage_path, nome_arquivo)
SELECT pg_temp.id('orgA'), pg_temp.id('M'), x, 'reuniao-teste/m/' || md5(x) || '.pdf', 'doc.pdf'
  FROM unnest(pg_temp.chk('M')) x;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.arquivo('m1', public.locacao_minuta_preparar(pg_temp.id('M'), 'pdf')->>'path');
SELECT public.locacao_minuta_registrar(pg_temp.id('M'), pg_temp.p('m1'), 'minuta.pdf', 'anexo');
SELECT public.locacao_contratos_acao(pg_temp.id('M'), 'enviar_minuta');
SELECT pg_temp.ok(pg_temp.avisos('M') = 'minuta_enviada', 'minuta enviada → 1 aviso ao corretor');
SELECT public.locacao_contratos_acao(pg_temp.id('M'), 'cobrar_pendencia', '{"texto":"Falta o e-mail do proprietário"}');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT public.locacao_corretor_minuta(pg_temp.id('M'), 'resolver_pendencia', 'E-mail enviado');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT public.locacao_contratos_acao(pg_temp.id('M'), 'marcar_ajuste', '{"texto":"Proprietário pediu cláusula de pintura"}');
SELECT public.locacao_andamento_registrar(pg_temp.id('M'), 'Enviar RG legível do locatário', 'corretor');
SELECT public.locacao_andamento_registrar(pg_temp.id('M'), 'Aguardando retorno do proprietário', 'proprietario');
SELECT pg_temp.ok(pg_temp.avisos('M') = 'minuta_enviada,pendencia,ajuste,andamento',
  'pendência, ajuste e andamento "aguardando corretor" avisam; ação do próprio corretor e "aguardando proprietário" não');
RESET ROLE;
SELECT pg_temp.as_user(pg_temp.id('con')::text);
UPDATE public.locacoes SET atualizado_em = now() WHERE id = pg_temp.id('M');
SELECT pg_temp.ok(pg_temp.avisos('M') = 'minuta_enviada,pendencia,ajuste,andamento', 'gravar sem mudança não gera aviso repetido');
SELECT public.locacao_aviso_novo(pg_temp.loc('M'), 'pendencia', 'chave-fixa-teste', 'teste 1'),
       public.locacao_aviso_novo(pg_temp.loc('M'), 'pendencia', 'chave-fixa-teste', 'teste 2');
SELECT pg_temp.ok((SELECT count(*) FROM public.locacao_avisos WHERE chave = 'chave-fixa-teste') = 1, 'mesma chave = um aviso só (idempotência)');
DELETE FROM public.locacao_avisos WHERE chave = 'chave-fixa-teste';
SELECT pg_temp.as_user(pg_temp.id('ges')::text);
UPDATE public.locacoes SET etapa = 'documentacao', devolvida = true, motivo_devolucao = 'RG ilegível', etapa_desde = now()
 WHERE id = pg_temp.id('F');
SELECT pg_temp.ok(pg_temp.avisos('F') = 'devolvida', 'devolução da gestora avisa o corretor');
SELECT pg_temp.as_user('');
INSERT INTO public.locacao_avisos (organization_id, locacao_id, evento, chave, destinatario_id, texto, criado_em)
VALUES (pg_temp.id('orgA'), pg_temp.id('M'), 'pendencia', 'velho-teste', pg_temp.id('c2'), 'aviso velho', now() - interval '25 hours');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT * FROM public.locacao_avisos_reservar(%L)', pg_temp.id('M'))) LIKE '42501%',
  'navegador não lê nem reserva a fila');
SELECT pg_temp.ok(public.locacao_avisos_pode(pg_temp.id('M')), 'corretor dono pode pedir o envio da própria locação');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(NOT public.locacao_avisos_pode(pg_temp.id('M')), 'outro corretor não pede envio da locação alheia');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.put('res', (SELECT jsonb_agg(to_jsonb(x)) FROM public.locacao_avisos_reservar(pg_temp.id('M'), 50) x));
SELECT pg_temp.ok(jsonb_array_length(pg_temp.j('res')) = 4 AND pg_temp.j('res')->0->>'codigo' LIKE 'LOC-%'
  AND pg_temp.j('res')->0->>'endereco' LIKE 'Rua da Minuta%', 'servidor reserva os 4 avisos (no máximo 5), com código e endereço');
SELECT pg_temp.ok((SELECT count(*) FROM public.locacao_avisos_reservar(pg_temp.id('M'))) = 0, 'reservado não é pego de novo (sem duplicar)');
SELECT pg_temp.ok((SELECT status FROM public.locacao_avisos WHERE chave = 'velho-teste') = 'expirado', 'aviso com mais de 24 h expira (não envia)');
SELECT pg_temp.ok(public.locacao_avisos_concluir((pg_temp.j('res')->0->>'aviso_id')::uuid, 'enviado')
  AND NOT public.locacao_avisos_concluir((pg_temp.j('res')->0->>'aviso_id')::uuid, 'enviado'), 'concluir só uma vez');
SELECT pg_temp.ok(public.locacao_avisos_concluir((pg_temp.j('res')->1->>'aviso_id')::uuid, 'falhou')
  AND public.locacao_avisos_concluir((pg_temp.j('res')->2->>'aviso_id')::uuid, 'incerto'),
  'falha HTTP e rede incerta ficam registradas');
SELECT pg_temp.ok((SELECT count(*) FROM public.locacao_avisos_reservar(pg_temp.id('M'))) = 0,
  'falha ou envio incerto não provocam reenvio duplicado');
RESET ROLE;

-- 7) Lançamento da Fernanda (item 6) -------------------------------------------------------------------------------
SELECT pg_temp.as_user('');
UPDATE public.locacoes SET etapa = 'pos_assinatura', captador_id = pg_temp.id('a1') WHERE id = pg_temp.id('C');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_lancamento_salvar(%L, ''{"aluguel":"2500","taxa_adm":"10"}'')',
  pg_temp.id('C'))) LIKE '42501%', 'corretor não lança');
SELECT pg_temp.ok(NOT (public.locacao_lancamento_ler(pg_temp.id('C'))->>'pode_editar')::boolean, 'corretor só vê');
SELECT pg_temp.as_user(pg_temp.id('con')::text);
SELECT pg_temp.put('lan', public.locacao_lancamento_ler(pg_temp.id('C')));
SELECT pg_temp.ok((pg_temp.j('lan')->>'pode_editar')::boolean AND NOT (pg_temp.j('lan')->>'lancado')::boolean
  AND (pg_temp.j('lan')->'valores'->>'gestor_id')::uuid = pg_temp.id('gQA') AND (pg_temp.j('lan')->'valores'->>'team_leader_id')::uuid = pg_temp.id('tl')
  AND (pg_temp.j('lan')->'valores'->>'captador_id')::uuid = pg_temp.id('a1') AND (pg_temp.j('lan')->'valores'->>'aluguel')::numeric = 2500,
  'Fernanda abre com sugestões: captador, Gestor e TL gravados, aluguel da locação');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_lancamento_salvar(%L, ''{"aluguel":"2500","taxa_adm":"40"}'')',
  pg_temp.id('C'))) LIKE '22023%taxa%', 'taxa acima de 30% recusada');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_lancamento_salvar(%L, ''{"aluguel":"2500","taxa_adm":"10","parceria":"remax"}'')',
  pg_temp.id('C'))) LIKE '22023%unidade%', 'parceria RE/MAX pede unidade e corretor parceiro');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_lancamento_salvar(%L, %L)', pg_temp.id('C'),
  jsonb_build_object('aluguel', '2500', 'taxa_adm', '10', 'captador_id', pg_temp.id('b1'))::text)) LIKE '42501%',
  'captador de outra imobiliária recusado');
SELECT pg_temp.ok((public.locacao_lancamento_salvar(pg_temp.id('C'), jsonb_build_object('captador_id', pg_temp.id('a1'), 'locador', 'Proprietária Fictícia',
  'gestor_id', pg_temp.id('gQA'), 'team_leader_id', pg_temp.id('tl'), 'aluguel', '2450.50', 'taxa_adm', '8',
  'parceria', 'externa', 'parceria_imobiliaria', 'Imobiliária Parceira (fictícia)',
  'parceria_lado', 'locatario'))->>'novo')::boolean, 'lançamento registrado'); -- lado do parceiro: exigido desde o #371
SELECT pg_temp.put('lan2', public.locacao_lancamento_salvar(pg_temp.id('C'), '{"aluguel":"2450.50","taxa_adm":"9"}'));
SELECT pg_temp.ok(NOT (pg_temp.j('lan2')->>'novo')::boolean
  AND (public.locacao_lancamento_ler(pg_temp.id('C'))->'valores'->>'taxa_adm')::numeric = 9, 'corrigir: atualiza o mesmo lançamento');
SELECT pg_temp.ok((SELECT (x->'lancamento'->>'aluguel')::numeric FROM jsonb_array_elements(public.locacao_lista()) x
   WHERE (x->>'id')::uuid = pg_temp.id('C')) = 2450.50, 'lista leva os valores lançados (aba Comissão)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_lancamento_salvar(%L, ''{"aluguel":"1","taxa_adm":"5"}'')',
  pg_temp.id('M'))) LIKE '22023%etapa%', 'antes da assinatura não lança');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.locacao_lancamento_ler(%L)', pg_temp.id('C'))) LIKE '42501%', 'outra imobiliária não vê');
RESET ROLE;

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
