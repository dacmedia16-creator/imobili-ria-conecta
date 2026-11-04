-- Suíte da migration 20261104160000 (comissão editada em "análise do Financeiro" chega à ocorrência,
-- t_59cb12e0). Roda DENTRO de transação revertida (run-comissao-analise-financeiro.sh). Dados fictícios.
-- Caso-modelo (espelha a venda do diagnóstico t_d6b8a37b, sem usar os dados dela): negociado R$ 180.000,
-- comissão 3% / R$ 5.400 na ocorrência, Financeiro corrige a venda para 6% / R$ 10.800 em análise;
-- parceria externa 50% = R$ 5.400; lado REMAX 3% = R$ 5.400; captador R$ 3.240.
CREATE TEMP TABLE r(ok bool, msg text);
GRANT ALL ON r TO authenticated;
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE || ' ' || SQLERRM; END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', _uid, true), set_config('mt.ctx', '', true) $$;

\set org 'c0000000-0000-4000-8000-0000000000a0'
\set fin 'c0000000-0000-4000-8000-000000000001'
\set capt 'c0000000-0000-4000-8000-000000000002'
\set gestor 'c0000000-0000-4000-8000-000000000003'

-- Montagem (sem gatilhos, só nesta transação) -----------------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, slug, nome, status, cnpj, cor_primaria, cor_secundaria) VALUES
  (:'org', 'teste-comissao-fin', 'Imobiliaria Exemplo Comissao', 'ativa', '00000000000191', '#112233', '#445566');
INSERT INTO auth.users (id) SELECT unnest(ARRAY[:'fin', :'capt', :'gestor']::uuid[]);
INSERT INTO public.profiles (id, nome, email, ativo, organization_id) VALUES
  (:'fin', 'Fernanda Financeiro', 'fin@exemplo.test', true, :'org'),
  (:'capt', 'Carlos Captador', 'capt@exemplo.test', true, :'org'),
  (:'gestor', 'Gustavo Gestor', 'gestor@exemplo.test', true, :'org');
INSERT INTO public.organization_members (organization_id, user_id, ativo) VALUES
  (:'org', :'fin', true), (:'org', :'capt', true), (:'org', :'gestor', true);
INSERT INTO public.user_roles (user_id, role, organization_id) VALUES
  (:'fin', 'financeiro', :'org'), (:'capt', 'corretor', :'org'), (:'gestor', 'gestor', :'org');

-- Venda fictícia em _status, ocorrência 'pendente' com 3% / 5.400, parceria e captador já sincronizados.
CREATE FUNCTION pg_temp.venda(_cod text, _status text, _aceita boolean DEFAULT false,
  _occ_status text DEFAULT 'pendente', _modalidade text DEFAULT 'padrao') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _s uuid := gen_random_uuid(); _o uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.sales (id, organization_id, corretor_id, corretor_captador_id, corretor_captador,
    coordenador_id, status, modalidade, imovel_id, codigo_interno, midia, valor_anunciado, valor_negociado,
    percentual_comissao, valor_total_comissao, percentual_remax, valor_remax, valor_comissao_captador,
    parceria_tipo, parceria_nome, parceria_percentual, parceria_valor,
    previsao_recebimento_valor, previsao_recebimento_data, previsao_recebimento_forma)
  VALUES (_s, 'c0000000-0000-4000-8000-0000000000a0', 'c0000000-0000-4000-8000-000000000002',
    'c0000000-0000-4000-8000-000000000002', 'Carlos Captador', 'c0000000-0000-4000-8000-000000000003',
    _status::public.sale_status, _modalidade, 'QA-CAF-' || _cod, '999999999-' || (ascii(_cod) - 60), 'Placa',
    180000, 180000, 3, 5400, 3, 5400, 3240,
    'imobiliaria_externa', 'Parceira Exemplo', 50, 5400, 5400, DATE '2026-12-10', 'PIX');
  INSERT INTO public.occurrences (id, sale_id, organization_id, status, aceita_financeiro, midia,
    valor_anunciado, valor_negociado, percentual_comissao, valor_comissao,
    prev_recebimento_valor, prev_recebimento_data, prev_recebimento_forma)
  VALUES (_o, _s, 'c0000000-0000-4000-8000-0000000000a0', _occ_status, _aceita, 'Placa',
    180000, 180000, 3, 5400, 5400, DATE '2026-12-10', 'PIX');
  INSERT INTO public.occurrence_partners (occurrence_id, organization_id, from_sale, tipo, nome, percentual, valor)
  VALUES (_o, 'c0000000-0000-4000-8000-0000000000a0', true, 'imobiliaria_externa', 'Parceira Exemplo', 50, 5400);
  INSERT INTO public.occurrence_commissions (occurrence_id, organization_id, papel, nome, user_id, valor,
    percentual, managed_by_sale)
  VALUES (_o, 'c0000000-0000-4000-8000-0000000000a0', 'corretor_captador', 'Carlos Captador',
    'c0000000-0000-4000-8000-000000000002', 3240, 60, true);
  RETURN _s;
END $$;

CREATE TEMP TABLE v(k text PRIMARY KEY, id uuid);
GRANT ALL ON v TO authenticated;
INSERT INTO v VALUES
  ('analise', pg_temp.venda('A', 'ocorrencia_analise_financeiro')),
  ('aceita', pg_temp.venda('B', 'ocorrencia_analise_financeiro', true)),
  ('concluida', pg_temp.venda('C', 'ocorrencia_concluida', true, 'concluida')),
  ('so_previsao', pg_temp.venda('D', 'ocorrencia_analise_financeiro')),
  ('pendente', pg_temp.venda('E', 'ocorrencia_pendente')),
  ('lancamento', pg_temp.venda('F', 'ocorrencia_analise_financeiro', false, 'pendente', 'lancamento')),
  ('sem_valor', pg_temp.venda('G', 'ocorrencia_analise_financeiro'));
SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.s(_k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM v WHERE k = _k $$;
CREATE FUNCTION pg_temp.occ(_k text) RETURNS public.occurrences LANGUAGE sql AS
  $$ SELECT o FROM public.occurrences o WHERE o.sale_id = pg_temp.s(_k) $$;
CREATE FUNCTION pg_temp.capt(_k text) RETURNS public.occurrence_commissions LANGUAGE sql AS
  $$ SELECT c FROM public.occurrence_commissions c JOIN public.occurrences o ON o.id = c.occurrence_id
     WHERE o.sale_id = pg_temp.s(_k) AND c.papel = 'corretor_captador' $$;
-- "Nossa parte (desconta parceria)" como a tela calcula: comissão da ocorrência − parceria.
CREATE FUNCTION pg_temp.nossa(_k text) RETURNS numeric LANGUAGE sql AS
  $$ SELECT (pg_temp.occ(_k)).valor_comissao - coalesce((SELECT sum(p.valor) FROM public.occurrence_partners p
       WHERE p.occurrence_id = (pg_temp.occ(_k)).id), 0) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

-- Função nova: só o gatilho chama (nenhum usuário executa direto).
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.sincronizar_comissao_ocorrencia_em_analise(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.sincronizar_comissao_ocorrencia_em_analise(uuid)', 'EXECUTE'),
  'função nova sem EXECUTE para authenticated/anon');
SELECT pg_temp.ok((SELECT prosecdef AND 'search_path=public' = ANY(proconfig) FROM pg_proc
                    WHERE oid = 'public.sincronizar_comissao_ocorrencia_em_analise(uuid)'::regprocedure),
  'função nova SECURITY DEFINER com search_path fixo');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.sincronizar_ocorrencia_antes_financeiro(uuid)', 'EXECUTE'),
  'sincronizar_ocorrencia_antes_financeiro continua sem EXECUTE para authenticated');

-- Como a tela faz: Financeiro grava a venda e depois chama sync_occurrence_commissions.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(:'fin');

-- 1) Caso do diagnóstico: em análise, não aceita → ocorrência acompanha.
SELECT pg_temp.ok(pg_temp.err(format(
  'UPDATE public.sales SET percentual_comissao = 6, valor_total_comissao = 10800 WHERE id = %L', pg_temp.s('analise'))) IS NULL,
  'Financeiro grava 6% / R$ 10.800 na venda em análise');
SELECT public.sync_occurrence_commissions(pg_temp.s('analise'));
SELECT pg_temp.ok((pg_temp.occ('analise')).percentual_comissao = 6, 'análise: ocorrência passa a 6%');
SELECT pg_temp.ok((pg_temp.occ('analise')).valor_comissao = 10800, 'análise: ocorrência passa a R$ 10.800');
SELECT pg_temp.ok((pg_temp.capt('analise')).percentual = 30 AND (pg_temp.capt('analise')).valor = 3240,
  'análise: captador recalculado = 30% de R$ 10.800 (R$ 3.240), não 60%');
SELECT pg_temp.ok(pg_temp.nossa('analise') = 5400, 'análise: nossa parte (desconta parceria) = R$ 5.400');
SELECT pg_temp.ok((pg_temp.occ('analise')).prev_recebimento_valor = 5400
  AND (SELECT count(*) = 1 AND min(valor) = 5400 FROM public.occurrence_partners WHERE occurrence_id = (pg_temp.occ('analise')).id),
  'análise: previsão e parceria da ocorrência não foram tocadas');
SELECT pg_temp.ok((pg_temp.occ('analise')).status = 'pendente' AND NOT (pg_temp.occ('analise')).aceita_financeiro,
  'análise: status/aceite da ocorrência inalterados');
-- Repetir a mesma gravação não muda nada (idempotente).
UPDATE public.sales SET percentual_comissao = 6, valor_total_comissao = 10800 WHERE id = pg_temp.s('analise');
SELECT pg_temp.ok((pg_temp.occ('analise')).valor_comissao = 10800 AND (pg_temp.capt('analise')).percentual = 30,
  'análise: regravar o mesmo valor é idempotente');
-- Voltar o valor também volta (a correção pode ser desfeita pelo Financeiro na tela).
UPDATE public.sales SET percentual_comissao = 3, valor_total_comissao = 5400 WHERE id = pg_temp.s('analise');
SELECT pg_temp.ok((pg_temp.occ('analise')).valor_comissao = 5400 AND (pg_temp.capt('analise')).percentual = 60,
  'análise: voltar para 3% / R$ 5.400 volta a ocorrência');
UPDATE public.sales SET percentual_comissao = 6, valor_total_comissao = 10800 WHERE id = pg_temp.s('analise');

-- 2) Já aceita pelo Financeiro → congelada.
SELECT pg_temp.ok(pg_temp.err(format(
  'UPDATE public.sales SET percentual_comissao = 6, valor_total_comissao = 10800 WHERE id = %L', pg_temp.s('aceita'))) IS NULL,
  'aceita: Financeiro ainda consegue gravar a venda (regra atual)');
SELECT pg_temp.ok((pg_temp.occ('aceita')).percentual_comissao = 3 AND (pg_temp.occ('aceita')).valor_comissao = 5400,
  'aceita: ocorrência continua 3% / R$ 5.400 (congelada)');
SELECT pg_temp.ok((pg_temp.capt('aceita')).percentual = 60, 'aceita: linha do captador intacta');

-- 3) Concluída → congelada.
SELECT pg_temp.err(format(
  'UPDATE public.sales SET percentual_comissao = 6, valor_total_comissao = 10800 WHERE id = %L', pg_temp.s('concluida')));
SELECT pg_temp.ok((pg_temp.occ('concluida')).valor_comissao = 5400 AND (pg_temp.occ('concluida')).percentual_comissao = 3,
  'concluída: ocorrência não muda');

-- 4) Em análise, mudou só a previsão (não a comissão) → nada é sobrescrito na ocorrência.
UPDATE public.sales SET previsao_recebimento_valor = 9999 WHERE id = pg_temp.s('so_previsao');
SELECT pg_temp.ok((pg_temp.occ('so_previsao')).prev_recebimento_valor = 5400
  AND (pg_temp.occ('so_previsao')).valor_comissao = 5400,
  'análise sem mudança de comissão: ocorrência intacta (correções do Financeiro preservadas)');

-- 5) Etapa anterior (ocorrência pendente) continua com a sincronização completa de antes.
UPDATE public.sales SET percentual_comissao = 6, valor_total_comissao = 10800, previsao_recebimento_valor = 10800
  WHERE id = pg_temp.s('pendente');
SELECT pg_temp.ok((pg_temp.occ('pendente')).valor_comissao = 10800 AND (pg_temp.occ('pendente')).prev_recebimento_valor = 10800
  AND (pg_temp.capt('pendente')).percentual = 30,
  'ocorrencia_pendente: sincronização completa igual a antes');

-- 6) Lançamento fica de fora (regra própria).
SELECT pg_temp.err(format(
  'UPDATE public.sales SET percentual_comissao = 6, valor_total_comissao = 10800 WHERE id = %L', pg_temp.s('lancamento')));
SELECT pg_temp.ok((pg_temp.occ('lancamento')).valor_comissao = 5400, 'lançamento: ocorrência não muda');

-- 7) Venda sem comissão informada não apaga a da ocorrência.
SELECT pg_temp.err(format(
  'UPDATE public.sales SET percentual_comissao = NULL, valor_total_comissao = NULL WHERE id = %L', pg_temp.s('sem_valor')));
SELECT pg_temp.ok((pg_temp.occ('sem_valor')).valor_comissao = 5400, 'venda sem comissão: ocorrência mantém o valor');

-- 8) Ninguém chama a função nova direto.
SELECT pg_temp.ok(pg_temp.err(format('SELECT public.sincronizar_comissao_ocorrencia_em_analise(%L)', pg_temp.s('aceita'))) LIKE '42501%',
  'usuário não executa a função nova direto');

RESET ROLE;
SELECT CASE WHEN ok THEN 'ok   ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
