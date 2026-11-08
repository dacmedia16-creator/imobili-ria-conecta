-- Suíte da migration 20261108200000 (Link de acompanhamento 1/2, t_54c79bdc). Roda DENTRO de transação
-- revertida (run-link-acompanhamento.sh). Dados fictícios só na transação; nada fica gravado.
-- Homologação: A = Agência A (…-0001), B = Agência B (2a…b0). Perfis: a1 (UE Corretor, dono das vendas de
-- teste), c2 (QA A Corretor Dois, não participa), ga (UE Gestor, lidera a1), adm (QA A Admin), b1 (QA B
-- Corretor Um), admB (QA B Admin).
CREATE TEMP TABLE r(ok bool, msg text);
CREATE TEMP TABLE ids(k text PRIMARY KEY, v uuid);
CREATE TEMP TABLE tk(k text PRIMARY KEY, v text);
GRANT ALL ON r, ids, tk TO authenticated, service_role;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;
CREATE FUNCTION pg_temp.id(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT v FROM ids WHERE k = _k $$;
CREATE FUNCTION pg_temp.t(_k text) RETURNS text LANGUAGE sql AS $$ SELECT v FROM tk WHERE k = _k $$;
-- Guarda os tokens devolvidos pela RPC do bloco da venda.
CREATE FUNCTION pg_temp.guarda(_pref text, _j jsonb) RETURNS jsonb LANGUAGE sql AS $$
  INSERT INTO tk SELECT _pref || '_' || (x->>'lado'), x->>'token' FROM jsonb_array_elements(_j->'links') x
    ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
  SELECT _j $$;
CREATE FUNCTION pg_temp.ip(_n int) RETURNS text LANGUAGE sql AS $$ SELECT md5('ip' || _n) || md5('x' || _n) $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(bool, text), pg_temp.err(text), pg_temp.as_user(text), pg_temp.id(text),
  pg_temp.t(text), pg_temp.guarda(text, jsonb), pg_temp.ip(int) TO authenticated, service_role;

INSERT INTO ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('orgB', '2a000000-0000-4000-8000-0000000000b0'),
  ('a1', '10000000-0000-4000-8000-000000000003'), ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4'),
  ('ga', '10000000-0000-4000-8000-000000000002'), ('adm', '7dd997f7-2021-43ea-af9c-e758b826fcfd'),
  ('b1', '23e65aaf-2614-463e-baec-cf562bb94244'), ('admB', 'b3144521-7e3b-4f48-a1e0-29d90fd3f536'),
  ('s1', '5a000000-0000-4000-8000-0000000000a1'), ('sB', '5a000000-0000-4000-8000-0000000000b1'),
  ('sL', '5a000000-0000-4000-8000-0000000000c1');

-- 0) Mapeamento dos status (falha se surgir status novo no enum sem etapa) ----------------------------------
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM unnest(enum_range(NULL::public.sale_status)) v
                               WHERE public.acompanhamento_etapa(v) IS NULL),
  'todo status do enum sale_status tem etapa definida');
SELECT pg_temp.ok((SELECT count(*) FROM unnest(enum_range(NULL::public.sale_status))) = 17,
  'enum sale_status tem os 17 status conhecidos (status novo = revisar mapeamento)');
SELECT pg_temp.ok((SELECT string_agg(v::text || '=' || public.acompanhamento_etapa(v), ',' ORDER BY v::text)
                     FROM unnest(enum_range(NULL::public.sale_status)) v) =
  'aguardando_assinatura=2,aprovada_gestor=1,arquivada=0,cancelada=0,contrato_assinado=3,contrato_conferencia_corretor=1,'
  'contrato_conferencia_gestor=1,contrato_ok_corretor=1,devolvida_ajuste=1,em_elaboracao_contrato=1,enviada_juridico=1,'
  'enviada_revisao=1,ocorrencia_analise_financeiro=3,ocorrencia_concluida=3,ocorrencia_devolvida_gestor=3,'
  'ocorrencia_pendente=3,rascunho=1', 'mapeamento exato das 3 etapas (ocorrências = 3; cancelada/arquivada = 0)');

-- 1) Módulo nasce desligado --------------------------------------------------------------------------------
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.organization_modules WHERE module = 'link_acompanhamento'),
  'módulo nasce desligado (nenhuma linha criada)');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'acompanhamento_link_chave'), 'chave HMAC criada no Vault');

-- Vendas fictícias (gatilhos de sales desligados SÓ na transação: aqui não se testa o fluxo de status).
ALTER TABLE public.sales DISABLE TRIGGER USER;
ALTER TABLE public.sale_parties DISABLE TRIGGER USER;
ALTER TABLE public.sale_status_history DISABLE TRIGGER USER;
INSERT INTO public.sales (id, organization_id, corretor_id, status, modalidade, imovel_logradouro, imovel_numero,
  imovel_complemento, imovel_bairro, imovel_cidade, imovel_uf, valor_negociado, valor_anunciado,
  valor_total_comissao, percentual_comissao, comissao_observacoes, observacoes_gerais, forma_pagamento,
  parceria_pix, parceria_cpf_cnpj, created_at)
VALUES (pg_temp.id('s1'), pg_temp.id('orgA'), pg_temp.id('a1'), 'rascunho', 'padrao', 'Rua das Acácias Teste', '245',
  'apto 31', 'Jardim Campolim', 'Sorocaba', 'SP', 777123, 888456, 46627, 6, 'COMENTARIO_INTERNO_X', 'OBS_INTERNA_Y',
  'FINANCIAMENTO_Z', 'PIX_SECRETO', '11122233344', now() - interval '10 days'),
  (pg_temp.id('sB'), pg_temp.id('orgB'), pg_temp.id('b1'), 'aguardando_assinatura', 'padrao', 'Rua Da Agência B', '9',
  NULL, 'Centro', 'Itu', 'SP', 1, 1, 1, 1, NULL, NULL, NULL, NULL, NULL, now() - interval '5 days'),
  (pg_temp.id('sL'), pg_temp.id('orgA'), pg_temp.id('a1'), 'rascunho', 'lancamento', 'Rua Lançamento', '1',
  NULL, 'Centro', 'Sorocaba', 'SP', 1, 1, 1, 1, NULL, NULL, NULL, NULL, NULL, now());
INSERT INTO public.sale_parties (sale_id, organization_id, papel, nome, cpf_cnpj, rg, telefone, email, endereco, tipo_pessoa)
VALUES (pg_temp.id('s1'), pg_temp.id('orgA'), 'comprador_1', 'João Alves Teste', '98765432100', 'RG112233', '15999990000',
        'joao.teste@example.com', 'Rua Particular do João 1', 'fisica'),
       (pg_temp.id('s1'), pg_temp.id('orgA'), 'comprador_2', 'Marina Alves Teste', NULL, NULL, NULL, NULL, NULL, 'fisica'),
       (pg_temp.id('s1'), pg_temp.id('orgA'), 'vendedor_1', 'Carlos Pereira Teste', '55566677788', NULL, '15988887777',
        'carlos.teste@example.com', NULL, 'fisica'),
       (pg_temp.id('sB'), pg_temp.id('orgB'), 'comprador_1', 'Comprador Da B', NULL, NULL, NULL, NULL, NULL, 'fisica');
INSERT INTO public.sale_status_history (sale_id, organization_id, de, para, motivo, created_at)
VALUES (pg_temp.id('s1'), pg_temp.id('orgA'), 'rascunho', 'enviada_revisao', 'MOTIVO_INTERNO_W', now() - interval '9 days'),
       (pg_temp.id('s1'), pg_temp.id('orgA'), 'enviada_revisao', 'devolvida_ajuste', 'DEVOLUCAO_INTERNA', now() - interval '8 days'),
       (pg_temp.id('sB'), pg_temp.id('orgB'), 'contrato_ok_corretor', 'aguardando_assinatura', NULL, now() - interval '1 day');
UPDATE public.sales SET status = 'devolvida_ajuste' WHERE id = pg_temp.id('s1');
ALTER TABLE public.sales ENABLE TRIGGER USER;
ALTER TABLE public.sale_parties ENABLE TRIGGER USER;
ALTER TABLE public.sale_status_history ENABLE TRIGGER USER;

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(public.link_acompanhamento_enabled() = false, 'desligado: link_acompanhamento_enabled() = false');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.acompanhamento_links(%L)', pg_temp.id('s1'))) LIKE '42501%',
  'desligado: bloco da venda recusado');
RESET ROLE;

-- Liga na A e na B (a B só para testar o isolamento).
INSERT INTO public.organization_modules (organization_id, module, enabled) VALUES
  (pg_temp.id('orgA'), 'link_acompanhamento', true), (pg_temp.id('orgB'), 'link_acompanhamento', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;

-- 2) Quem vê o bloco = quem já vê a venda --------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.guarda('s1', public.acompanhamento_links(pg_temp.id('s1')));
SELECT pg_temp.ok((SELECT count(*) FROM tk WHERE k LIKE 's1_%') = 2, 'dono da venda: 2 links (comprador e vendedor)');
SELECT pg_temp.ok(pg_temp.t('s1_comprador') ~ '^[A-Za-z0-9_-]{43}$' AND pg_temp.t('s1_vendedor') ~ '^[A-Za-z0-9_-]{43}$'
  AND pg_temp.t('s1_comprador') <> pg_temp.t('s1_vendedor'), 'tokens longos (43), aleatórios e diferentes por lado');
SELECT pg_temp.ok(pg_temp.err('SELECT 1 FROM public.sale_acompanhamento_links LIMIT 1') LIKE '42501%',
  'tabela de links sem acesso direto (authenticated)');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.acompanhamento_publico(%L, %L)', pg_temp.t('s1_comprador'), pg_temp.ip(1))) LIKE '42501%',
  'RPC pública não é executável por authenticated');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.acompanhamento_token(%L)', pg_temp.id('s1'))) LIKE '42501%',
  'gerador de token não é executável por authenticated');
SELECT pg_temp.as_user(pg_temp.id('ga')::text);
SELECT pg_temp.ok((SELECT string_agg(x->>'token', ',' ORDER BY x->>'lado') FROM jsonb_array_elements(
    public.acompanhamento_links(pg_temp.id('s1'))->'links') x) = pg_temp.t('s1_comprador') || ',' || pg_temp.t('s1_vendedor'),
  'gestor que lidera o dono vê os MESMOS links (não cria outros)');
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(jsonb_array_length(public.acompanhamento_links(pg_temp.id('s1'))->'links') = 2, 'admin da imobiliária vê o bloco');
SELECT pg_temp.as_user(pg_temp.id('c2')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.acompanhamento_links(%L)', pg_temp.id('s1'))) LIKE '42501%',
  'corretor que não vê a venda: recusado');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.acompanhamento_link_regenerar(%L, ''comprador'')', pg_temp.id('s1'))) LIKE '42501%',
  'corretor que não vê a venda: não regenera');
SELECT pg_temp.as_user(pg_temp.id('b1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.acompanhamento_links(%L)', pg_temp.id('s1'))) LIKE '42501%',
  'outra imobiliária: recusado');
SELECT pg_temp.guarda('sB', public.acompanhamento_links(pg_temp.id('sB')));
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.acompanhamento_links(%L)', pg_temp.id('sB'))) LIKE '42501%',
  'admin da A não abre venda da B');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.acompanhamento_links(%L)', pg_temp.id('sL'))) LIKE '22023%',
  'lançamento não tem link');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.acompanhamento_link_regenerar(%L, ''outro'')', pg_temp.id('s1'))) LIKE '22023%',
  'lado inválido recusado');
RESET ROLE;
-- Equivalência com a RLS real: para cada pessoa × cada venda, acompanhamento_pode_ver_venda = a venda aparece no
-- SELECT de sales (todas as políticas, restritivas incluídas). Inclui gestor, TL, admin, jurídico, corretores e B.
CREATE TEMP TABLE eq(u uuid, s uuid, rls bool, fn bool);
GRANT ALL ON eq TO authenticated;
DO $$
DECLARE _u uuid; _s uuid; _rls bool; _fn bool;
  -- Lista lida ANTES de virar authenticated (senão a RLS já esconderia as vendas sem acesso).
  _todas uuid[] := (SELECT array_agg(id) FROM public.sales);
BEGIN
  FOR _u IN SELECT DISTINCT r.user_id FROM public.user_roles r
             WHERE r.organization_id IN (SELECT v FROM ids WHERE k IN ('orgA', 'orgB')) LOOP
    PERFORM pg_temp.as_user(_u::text);
    SET LOCAL ROLE authenticated;
    FOREACH _s IN ARRAY _todas LOOP
      _rls := EXISTS (SELECT 1 FROM public.sales WHERE id = _s);
      _fn := public.acompanhamento_pode_ver_venda(_s);
      INSERT INTO eq VALUES (_u, _s, _rls, _fn);
    END LOOP;
    RESET ROLE;
  END LOOP;
END $$;
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM eq) >= 150 AND (SELECT count(*) FILTER (WHERE NOT rls) FROM eq) >= 50
  AND NOT EXISTS (SELECT 1 FROM eq WHERE rls IS DISTINCT FROM fn),
  'quem vê o bloco = quem a RLS de sales deixa ler (' || (SELECT count(*) FROM eq) || ' pares pessoa×venda, '
  || (SELECT count(*) FILTER (WHERE rls) FROM eq) || ' com acesso)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.sale_acompanhamento_links l JOIN tk ON tk.v = l.token_hash)
  AND (SELECT count(*) FROM public.sale_acompanhamento_links l JOIN tk ON public.acompanhamento_hash(tk.v) = l.token_hash) = 4,
  'banco guarda só o hash SHA-256 do token (nunca o token)');
SELECT pg_temp.ok((SELECT bool_and(organization_id = pg_temp.id('orgA')) FROM public.sale_acompanhamento_links
  WHERE sale_id = pg_temp.id('s1')), 'link gravado com a org da venda');

-- 3) Página pública: só os campos permitidos ----------------------------------------------------------------
SET LOCAL ROLE service_role;
CREATE TEMP TABLE pub(k text PRIMARY KEY, j jsonb);
INSERT INTO pub VALUES ('c1', public.acompanhamento_publico(pg_temp.t('s1_comprador'), pg_temp.ip(1)));
SELECT pg_temp.ok((SELECT j->>'ok' FROM pub WHERE k = 'c1') = 'true' AND (SELECT (j->>'etapa')::int FROM pub WHERE k = 'c1') = 1,
  'devolvida para ajuste = etapa 1 (Preparando o contrato)');
SELECT pg_temp.ok((SELECT string_agg(key, ',' ORDER BY key) FROM pub, jsonb_object_keys(j) key WHERE k = 'c1') =
  'atualizado_em,compradores,corretor,datas,etapa,google_url,imobiliaria,imovel,lado,ok,vendedores',
  'resposta pública tem SÓ as chaves permitidas');
SELECT pg_temp.ok((SELECT j->'compradores' = '["João Alves Teste","Marina Alves Teste"]'::jsonb
  AND j->'vendedores' = '["Carlos Pereira Teste"]'::jsonb AND j->>'corretor' = 'UE Corretor'
  AND j->>'imobiliaria' = 'Agência A (fictícia)' AND j->'imovel'->>'linha1' = 'Rua das Acácias Teste, 245, apto 31'
  AND j->'imovel'->>'linha2' = 'Jardim Campolim · Sorocaba/SP' FROM pub WHERE k = 'c1'),
  'mostra endereço, nomes das partes (todas) e do corretor');
SELECT pg_temp.ok((SELECT j::text !~* ('777123|888456|46627|98765432100|55566677788|11122233344|RG112233|15999990000|15988887777|example\.com|Particular|COMENTARIO|OBS_INTERNA|FINANCIAMENTO|PIX|MOTIVO_INTERNO|DEVOLUCAO|devolvida|rascunho|revisao|juridico|conferencia|ocorrencia|' || pg_temp.id('s1')::text)
  FROM pub WHERE k = 'c1'), 'nenhum valor, CPF, RG, telefone, e-mail, comentário, motivo, id ou status interno na resposta');
SELECT pg_temp.ok((SELECT j->'google_url' = 'null'::jsonb FROM pub WHERE k = 'c1'), 'etapa 1: sem botão do Google');
SELECT pg_temp.ok((SELECT j->'datas'->>'preparando' IS NOT NULL AND j->'datas'->'aguardando' = 'null'::jsonb FROM pub WHERE k = 'c1'),
  'datas: só a etapa 1 preenchida');
RESET ROLE;
SELECT pg_temp.ok((SELECT aberturas = 1 AND ultima_abertura IS NOT NULL FROM public.sale_acompanhamento_links
  WHERE sale_id = pg_temp.id('s1') AND lado = 'comprador' AND ativo), 'abertura contada (1x, com data)');
SELECT pg_temp.ok((SELECT aberturas = 0 FROM public.sale_acompanhamento_links
  WHERE sale_id = pg_temp.id('s1') AND lado = 'vendedor' AND ativo), 'link do vendedor: ainda não abriu');

-- 4) Andamento até o contrato assinado + Google ---------------------------------------------------------------
UPDATE public.organizations SET google_avaliacao_url = 'https://g.page/r/teste-avaliacao/review' WHERE id = pg_temp.id('orgA');
ALTER TABLE public.sales DISABLE TRIGGER USER;
ALTER TABLE public.sale_status_history DISABLE TRIGGER USER;
INSERT INTO public.sale_status_history (sale_id, organization_id, de, para, created_at)
VALUES (pg_temp.id('s1'), pg_temp.id('orgA'), 'contrato_ok_corretor', 'aguardando_assinatura', now() - interval '3 days');
UPDATE public.sales SET status = 'aguardando_assinatura' WHERE id = pg_temp.id('s1');
SET LOCAL ROLE service_role;
INSERT INTO pub VALUES ('c2', public.acompanhamento_publico(pg_temp.t('s1_vendedor'), pg_temp.ip(1)));
RESET ROLE;
SELECT pg_temp.ok((SELECT (j->>'etapa')::int = 2 AND j->'datas'->>'aguardando' IS NOT NULL AND j->'google_url' = 'null'::jsonb
  AND j->>'lado' = 'vendedor' FROM pub WHERE k = 'c2'),
  'aguardando assinatura = etapa 2, com data; Google NÃO aparece (campo preenchido, mas não assinado)');
INSERT INTO public.sale_status_history (sale_id, organization_id, de, para, created_at)
VALUES (pg_temp.id('s1'), pg_temp.id('orgA'), 'aguardando_assinatura', 'contrato_assinado', now() - interval '1 day');
UPDATE public.sales SET status = 'contrato_assinado' WHERE id = pg_temp.id('s1');
SET LOCAL ROLE service_role;
INSERT INTO pub VALUES ('c3', public.acompanhamento_publico(pg_temp.t('s1_comprador'), pg_temp.ip(1)));
RESET ROLE;
SELECT pg_temp.ok((SELECT (j->>'etapa')::int = 3 AND j->>'google_url' = 'https://g.page/r/teste-avaliacao/review'
  AND j->'datas'->>'assinado' IS NOT NULL FROM pub WHERE k = 'c3'),
  'contrato assinado = etapa 3 e botão do Google com o link da imobiliária');
SELECT pg_temp.ok((SELECT j->>'atualizado_em' = j->'datas'->>'assinado' FROM pub WHERE k = 'c3'),
  'última atualização = data do contrato assinado');
INSERT INTO public.sale_status_history (sale_id, organization_id, de, para, motivo, created_at)
VALUES (pg_temp.id('s1'), pg_temp.id('orgA'), 'contrato_assinado', 'ocorrencia_pendente', 'OCORRENCIA_SECRETA', now());
UPDATE public.sales SET status = 'ocorrencia_pendente' WHERE id = pg_temp.id('s1');
SET LOCAL ROLE service_role;
INSERT INTO pub VALUES ('c4', public.acompanhamento_publico(pg_temp.t('s1_comprador'), pg_temp.ip(1)));
RESET ROLE;
SELECT pg_temp.ok((SELECT (j->>'etapa')::int = 3 AND j::text !~* 'ocorrencia|OCORRENCIA_SECRETA'
  AND j->>'atualizado_em' = (SELECT j2->>'atualizado_em' FROM pub p2 WHERE p2.k = 'c3') FROM pub, LATERAL (SELECT pub.j j2) z WHERE k = 'c4'),
  'ocorrência escondida: continua "Contrato assinado", sem mudar a data');
UPDATE public.organizations SET google_avaliacao_url = NULL WHERE id = pg_temp.id('orgA');
SET LOCAL ROLE service_role;
INSERT INTO pub VALUES ('c5', public.acompanhamento_publico(pg_temp.t('s1_comprador'), pg_temp.ip(1)));
RESET ROLE;
SELECT pg_temp.ok((SELECT (j->>'etapa')::int = 3 AND j->'google_url' = 'null'::jsonb FROM pub WHERE k = 'c5'),
  'contrato assinado com o campo vazio: sem botão do Google');

-- 5) Desligar e gerar outro -------------------------------------------------------------------------------
INSERT INTO tk VALUES ('velho', pg_temp.t('s1_comprador'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.guarda('s1', public.acompanhamento_link_regenerar(pg_temp.id('s1'), 'comprador'));
RESET ROLE;
SELECT pg_temp.ok(pg_temp.t('s1_comprador') <> pg_temp.t('velho') AND pg_temp.t('s1_comprador') ~ '^[A-Za-z0-9_-]{43}$',
  'regenerar: novo token');
SELECT pg_temp.ok((SELECT count(*) FROM public.sale_acompanhamento_links WHERE sale_id = pg_temp.id('s1') AND lado = 'comprador') = 2
  AND (SELECT count(*) FROM public.sale_acompanhamento_links WHERE sale_id = pg_temp.id('s1') AND lado = 'comprador' AND ativo) = 1
  AND (SELECT aberturas FROM public.sale_acompanhamento_links WHERE sale_id = pg_temp.id('s1') AND lado = 'comprador' AND ativo) = 0,
  'regenerar: antigo desligado (guardado), 1 ativo, contador zerado');
SELECT pg_temp.ok((SELECT count(*) FROM public.sale_acompanhamento_links WHERE sale_id = pg_temp.id('s1') AND lado = 'vendedor' AND ativo) = 1
  AND (SELECT count(*) FROM public.sale_acompanhamento_links WHERE sale_id = pg_temp.id('s1') AND lado = 'vendedor') = 1,
  'regenerar o comprador não mexe no vendedor');
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.acompanhamento_publico(pg_temp.t('velho'), pg_temp.ip(2))->>'erro' = 'indisponivel',
  'link antigo para de abrir na hora');
SELECT pg_temp.ok(public.acompanhamento_publico(pg_temp.t('s1_comprador'), pg_temp.ip(2))->>'ok' = 'true', 'link novo abre');

-- 6) Token errado + limite de tentativas ---------------------------------------------------------------------
SELECT pg_temp.ok(public.acompanhamento_publico('x' || substr(pg_temp.t('s1_vendedor'), 2), pg_temp.ip(3))->>'erro' = 'indisponivel',
  'token errado: indisponível');
SELECT pg_temp.ok(public.acompanhamento_publico('curto', pg_temp.ip(3))->>'erro' = 'indisponivel', 'token mal formado: indisponível');
SELECT pg_temp.ok(public.acompanhamento_publico(pg_temp.t('s1_vendedor'), 'nao-e-hash')->>'erro' = 'invalido', 'sem hash de IP: recusa');
SELECT public.acompanhamento_publico('tentativa' || g || repeat('a', 30), pg_temp.ip(3)) FROM generate_series(1, 8) g;
SELECT pg_temp.ok(public.acompanhamento_publico(repeat('z', 43), pg_temp.ip(3))->>'erro' = 'limite',
  '10 erros em 15 min: aquele IP passa a receber "limite"');
SELECT pg_temp.ok(public.acompanhamento_publico(pg_temp.t('s1_vendedor'), pg_temp.ip(3))->>'ok' = 'true',
  'link certo continua abrindo no IP limitado (cliente que divide IP não é bloqueado)');
SELECT pg_temp.ok(public.acompanhamento_publico(repeat('z', 43), pg_temp.ip(4))->>'erro' = 'indisponivel', 'outro IP: sem limite');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.sale_acompanhamento_tentativas WHERE ip_hash = pg_temp.ip(3)) = 10,
  'tentativas guardadas só como hash do IP');

-- 7) Isolamento entre imobiliárias --------------------------------------------------------------------------
SET LOCAL ROLE service_role;
INSERT INTO pub VALUES ('b', public.acompanhamento_publico(pg_temp.t('sB_comprador'), pg_temp.ip(5)));
RESET ROLE;
SELECT pg_temp.ok((SELECT j->>'imobiliaria' = 'Agência B (fictícia)' AND j->'compradores' = '["Comprador Da B"]'::jsonb
  AND j::text !~ 'Agência A|João|Carlos|Acácias' FROM pub WHERE k = 'b'), 'link da B só mostra dados da B');
UPDATE public.organization_modules SET enabled = false WHERE organization_id = pg_temp.id('orgB') AND module = 'link_acompanhamento';
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.acompanhamento_publico(pg_temp.t('sB_comprador'), pg_temp.ip(5))->>'erro' = 'indisponivel',
  'módulo desligado na B: link da B indisponível');
SELECT pg_temp.ok(public.acompanhamento_publico(pg_temp.t('s1_vendedor'), pg_temp.ip(5))->>'ok' = 'true',
  'módulo desligado na B não afeta a A');
RESET ROLE;

-- 8) Cancelada / arquivada desligam o link ------------------------------------------------------------------
UPDATE public.sales SET status = 'cancelada' WHERE id = pg_temp.id('s1');
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.acompanhamento_publico(pg_temp.t('s1_vendedor'), pg_temp.ip(6)) = '{"ok": false, "erro": "indisponivel"}'::jsonb,
  'cancelada: link indisponível (sem nenhum dado)');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok((public.acompanhamento_links(pg_temp.id('s1'))->>'disponivel') = 'false', 'cancelada: bloco mostra indisponível');
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.acompanhamento_link_regenerar(%L, ''vendedor'')', pg_temp.id('s1'))) LIKE '22023%',
  'cancelada: não gera link novo');
RESET ROLE;
UPDATE public.sales SET status = 'arquivada' WHERE id = pg_temp.id('s1');
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(public.acompanhamento_publico(pg_temp.t('s1_vendedor'), pg_temp.ip(6))->>'erro' = 'indisponivel',
  'arquivada: link indisponível');
RESET ROLE;
UPDATE public.sales SET status = 'contrato_ok_corretor' WHERE id = pg_temp.id('s1');
SET LOCAL ROLE service_role;
SELECT pg_temp.ok((public.acompanhamento_publico(pg_temp.t('s1_vendedor'), pg_temp.ip(6))->>'etapa')::int = 1,
  'desarquivada: o mesmo link volta a abrir, na etapa certa');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.sale_acompanhamento_tentativas WHERE ip_hash = pg_temp.ip(6)) = 0,
  'link de venda cancelada/arquivada não conta como tentativa errada');
ALTER TABLE public.sales ENABLE TRIGGER USER;
ALTER TABLE public.sale_status_history ENABLE TRIGGER USER;

-- 9) Campo "Link de avaliação no Google" ----------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(pg_temp.id('adm')::text);
SELECT pg_temp.ok(public.agency_google_avaliacao_salvar('  https://g.page/r/abc/review ') = 'https://g.page/r/abc/review',
  'admin grava o link do Google (com trim)');
SELECT pg_temp.ok(pg_temp.err('SELECT public.agency_google_avaliacao_salvar(''http://inseguro.com'')') LIKE '22023%', 'só https');
SELECT pg_temp.ok(pg_temp.err('SELECT public.agency_google_avaliacao_salvar(''javascript:alert(1)'')') LIKE '22023%', 'recusa javascript:');
SELECT pg_temp.as_user(pg_temp.id('a1')::text);
SELECT pg_temp.ok(pg_temp.err('SELECT public.agency_google_avaliacao_salvar(''https://g.page/x'')') LIKE '42501%',
  'corretor não grava o link do Google');
RESET ROLE;
SELECT pg_temp.ok((SELECT google_avaliacao_url FROM public.organizations WHERE id = pg_temp.id('orgA')) = 'https://g.page/r/abc/review'
  AND (SELECT google_avaliacao_url FROM public.organizations WHERE id = pg_temp.id('orgB')) IS NULL,
  'grava só na própria imobiliária');
SELECT pg_temp.ok(pg_temp.err('UPDATE public.organizations SET google_avaliacao_url = ''https://x'' WHERE id = ''' || pg_temp.id('orgB') || '''') LIKE '23514%',
  'CHECK da coluna barra URL inválida');

-- 10) Nada da venda foi alterado pelas RPCs -----------------------------------------------------------------
SELECT pg_temp.ok((SELECT count(*) FROM public.sale_status_history WHERE sale_id = pg_temp.id('s1')) = 5,
  'RPCs não gravam histórico de status');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA' END || ' ' || msg FROM r;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM r;
