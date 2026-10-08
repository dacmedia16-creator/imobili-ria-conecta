-- Ensaio da migration 20261008130000 (Mídia obrigatória ao avançar). Somente Postgres local
-- descartável/clone. Tudo em transação + ROLLBACK; cada escrita roda numa subtransação desfeita.
-- Os UPDATEs de status são diretos (postgres), pois o que se testa é o gatilho, que roda em qualquer caminho
-- (RPC, tela ou API). Outros gatilhos podem recusar pelo motivo deles; aqui só importa se a recusa é por Mídia.
\set ON_ERROR_STOP 1
BEGIN;
CREATE SCHEMA mo_test;
CREATE TABLE mo_test.results (n serial, label text, ok boolean);
CREATE FUNCTION mo_test.check(label text, ok boolean) RETURNS void LANGUAGE sql AS $$
 INSERT INTO mo_test.results(label,ok) VALUES(label,coalesce(ok,false)) $$;
CREATE FUNCTION mo_test.dry(q text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE n bigint; BEGIN
  BEGIN
   EXECUTE q; GET DIAGNOSTICS n = ROW_COUNT;
   RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = n::text;
  EXCEPTION WHEN SQLSTATE 'P0999' THEN RETURN 'ok:' || SQLERRM;
   WHEN OTHERS THEN RETURN 'erro:' || SQLSTATE || ':' || SQLERRM; END;
 END $$;
-- true quando a recusa foi pela regra da Mídia
CREATE FUNCTION mo_test.por_midia(r text) RETURNS boolean LANGUAGE sql AS $$
 SELECT r LIKE 'erro:23514:Informe a Mídia%' $$;

CREATE TABLE mo_test.cfg AS SELECT '00000000-0000-4000-8000-000000000001'::uuid AS org,
  '0b700000-0000-4000-8000-000000000001'::uuid AS cr;
INSERT INTO auth.users (id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ((SELECT cr FROM mo_test.cfg),'cr.mo@example.test','{"nome":"Corretor MO"}','{}');
INSERT INTO public.profiles (id, nome, ativo, organization_id)
SELECT cr, 'Corretor MO', true, org FROM mo_test.cfg
ON CONFLICT (id) DO UPDATE SET ativo = true, organization_id = EXCLUDED.organization_id;

-- Clones locais anteriores a 04/10 não têm o endereço estruturado; cria só se faltar (desfeito no ROLLBACK).
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS imovel_logradouro text,
  ADD COLUMN IF NOT EXISTS imovel_numero text, ADD COLUMN IF NOT EXISTS imovel_bairro text,
  ADD COLUMN IF NOT EXISTS imovel_cidade text, ADD COLUMN IF NOT EXISTS imovel_uf text;

-- Venda sintética: endereço completo (para o gatilho do endereço não recusar antes).
CREATE FUNCTION mo_test.venda(st text, midia text, modalidade text DEFAULT 'padrao') RETURNS uuid
LANGUAGE plpgsql AS $$ DECLARE sid uuid := gen_random_uuid(); BEGIN
  INSERT INTO public.sales(id,organization_id,corretor_id,corretor_captador_id,imovel_id,status,midia,modalidade,
    imovel_logradouro,imovel_numero,imovel_bairro,imovel_cidade,imovel_uf)
  VALUES (sid,(SELECT org FROM mo_test.cfg),(SELECT cr FROM mo_test.cfg),(SELECT cr FROM mo_test.cfg),
    'MO-'||left(sid::text, 8), st::public.sale_status, midia, modalidade,
    'Rua X','10','Centro','Sorocaba','SP');
  RETURN sid; END $$;
CREATE FUNCTION mo_test.up(sid uuid, st text) RETURNS text LANGUAGE sql AS $$
  SELECT mo_test.dry(format('UPDATE public.sales SET status=%L WHERE id=%L', st, sid)) $$;

DO $$ DECLARE sid uuid; r text; oid_ uuid; BEGIN
  -- 1. Sai do rascunho sem Mídia: recusado (gestor, jurídico direto, financeiro do Lançamento).
  FOREACH r IN ARRAY ARRAY['enviada_revisao','aprovada_gestor','em_elaboracao_contrato'] LOOP
    sid := mo_test.venda('rascunho', NULL);
    PERFORM mo_test.check('rascunho -> '||r||' sem mídia: recusado ('||mo_test.up(sid, r)||')',
      mo_test.por_midia(mo_test.up(sid, r)));
  END LOOP;
  -- (mídia em branco "   " nem chega a ser gravada: sales_midia_check só aceita a lista fixa ou nulo)
  sid := mo_test.venda('devolvida_ajuste', NULL);
  PERFORM mo_test.check('devolvida_ajuste -> enviada_revisao sem mídia: recusado',
    mo_test.por_midia(mo_test.up(sid, 'enviada_revisao')));
  sid := mo_test.venda('rascunho', NULL, 'lancamento');
  r := mo_test.up(sid, 'ocorrencia_analise_financeiro');
  PERFORM mo_test.check('Lançamento rascunho -> ocorrencia_analise_financeiro sem mídia: recusado ('||r||')',
    mo_test.por_midia(r));

  -- 2. Com Mídia: a regra da Mídia não recusa. Como o gatilho da Mídia roda antes dos outros de
  -- avanço, uma recusa de outra regra (permissão, venda sintética incompleta) prova que a Mídia passou.
  sid := mo_test.venda('rascunho', 'Instagram');
  r := mo_test.up(sid, 'enviada_revisao');
  PERFORM mo_test.check('rascunho -> enviada_revisao com mídia: não recusa por mídia ('||r||')', NOT mo_test.por_midia(r));
  sid := mo_test.venda('devolvida_ajuste', 'Placa');
  r := mo_test.up(sid, 'enviada_revisao');
  PERFORM mo_test.check('devolvida_ajuste -> enviada_revisao com mídia: não recusa por mídia ('||r||')', NOT mo_test.por_midia(r));
  sid := mo_test.venda('rascunho', 'Portal');
  r := mo_test.up(sid, 'aprovada_gestor');
  PERFORM mo_test.check('rascunho -> aprovada_gestor com mídia: não recusa por mídia ('||r||')', NOT mo_test.por_midia(r));

  -- 3. Rascunho continua salvando sem Mídia; arquivar/cancelar e devolver continuam livres.
  sid := mo_test.venda('rascunho', NULL);
  r := mo_test.dry(format('UPDATE public.sales SET valor_negociado=100000, midia=NULL WHERE id=%L', sid));
  PERFORM mo_test.check('rascunho salva sem mídia ('||r||')', r = 'ok:1');
  r := mo_test.up(sid, 'arquivada');
  PERFORM mo_test.check('rascunho -> arquivada sem mídia: não recusa por mídia ('||r||')', NOT mo_test.por_midia(r));
  r := mo_test.up(sid, 'cancelada');
  PERFORM mo_test.check('rascunho -> cancelada sem mídia: não recusa por mídia ('||r||')', NOT mo_test.por_midia(r));
  sid := mo_test.venda('enviada_revisao', NULL);
  r := mo_test.up(sid, 'devolvida_ajuste');
  PERFORM mo_test.check('enviada_revisao -> devolvida_ajuste sem mídia: não recusa por mídia ('||r||')', NOT mo_test.por_midia(r));

  -- 4. Vendas antigas já fora do rascunho: seguem o fluxo sem travar pela Mídia da venda.
  sid := mo_test.venda('enviada_revisao', NULL);
  r := mo_test.up(sid, 'aprovada_gestor');
  PERFORM mo_test.check('antiga enviada_revisao -> aprovada_gestor sem mídia: não recusa por mídia ('||r||')', NOT mo_test.por_midia(r));
  sid := mo_test.venda('contrato_conferencia_gestor', NULL);
  r := mo_test.up(sid, 'contrato_conferencia_corretor');
  PERFORM mo_test.check('antiga contrato_conferencia_gestor -> corretor sem mídia: não recusa por mídia ('||r||')', NOT mo_test.por_midia(r));

  -- 5. Ocorrência: enviar ao financeiro exige Mídia na ocorrência.
  sid := mo_test.venda('ocorrencia_pendente', NULL);
  INSERT INTO public.occurrences(sale_id, status, midia) VALUES (sid, 'pendente', NULL) RETURNING id INTO oid_;
  r := mo_test.up(sid, 'ocorrencia_analise_financeiro');
  PERFORM mo_test.check('ocorrência sem mídia -> financeiro: recusado ('||r||')', mo_test.por_midia(r));
  UPDATE public.occurrences SET midia = 'Indicação' WHERE id = oid_;
  r := mo_test.up(sid, 'ocorrencia_analise_financeiro');
  PERFORM mo_test.check('ocorrência com mídia -> financeiro: não recusa por mídia ('||r||')', NOT mo_test.por_midia(r));
  sid := mo_test.venda('ocorrencia_devolvida_gestor', 'Facebook');
  INSERT INTO public.occurrences(sale_id, status, midia) VALUES (sid, 'pendente', NULL);
  r := mo_test.up(sid, 'ocorrencia_analise_financeiro');
  PERFORM mo_test.check('ocorrência devolvida sem mídia (venda tem) -> financeiro: recusado ('||r||')', mo_test.por_midia(r));
  sid := mo_test.venda('ocorrencia_concluida', NULL);
  INSERT INTO public.occurrences(sale_id, status, midia) VALUES (sid, 'concluida', NULL);
  r := mo_test.up(sid, 'ocorrencia_analise_financeiro');
  PERFORM mo_test.check('reabrir ocorrência concluída sem mídia: não recusa por mídia ('||r||')', NOT mo_test.por_midia(r));

  -- 6. Nenhum dado real é alterado pela migration.
  PERFORM mo_test.check('gatilho instalado', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_bloquear_avanco_a_midia'));
  PERFORM mo_test.check('anon não executa a função',
    NOT has_function_privilege('anon','public.bloquear_avanco_sem_midia()','EXECUTE'));
END $$;

SELECT 'FALHA: ' || label FROM mo_test.results WHERE NOT ok ORDER BY n;
SELECT 'TOTAL=' || count(*) FILTER (WHERE ok) || '/' || count(*) FROM mo_test.results;
ROLLBACK;
