-- Suíte da migration 20261129120000 (seguro-fiança sem documentos no checklist do corretor, t_d3e1c29f). Roda DENTRO
-- de transação revertida (run-locacao-seguro-sem-docs.sh), DEPOIS da migration; o seed (sd_*) é gravado antes dela.
CREATE TEMP TABLE r(ok bool, msg text);
CREATE FUNCTION pg_temp.ok(_ok bool, _msg text) RETURNS void LANGUAGE sql AS
  $$ INSERT INTO r VALUES (coalesce(_ok, false), _msg) $$;
CREATE FUNCTION pg_temp.l(_k text) RETURNS public.locacoes LANGUAGE sql AS
  $$ SELECT l FROM public.locacoes l WHERE l.id = (SELECT v FROM sd_ids WHERE k = _k) $$;

-- 1) Seguro-fiança: só Locatário e Proprietário ---------------------------------------------------------------------
SELECT pg_temp.ok((SELECT array_agg(parte ORDER BY ordem) FROM public.locacao_partes(pg_temp.l('SEG')))
  = ARRAY['locatario', 'proprietario'], 'seguro: partes = locatário e proprietário');
SELECT pg_temp.ok((SELECT array_agg(p->>'rotulo') FROM jsonb_array_elements(public.locacao_partes_json(pg_temp.l('SEG'))) p)
  = ARRAY['Locatário PF', 'Proprietário PF'], 'seguro: tela mostra só 2 colunas');
SELECT pg_temp.ok(NOT ('Apólice/aprovação do seguro-fiança' = ANY (public.locacao_checklist_l(pg_temp.l('SEG'))))
  AND NOT ('Proposta da seguradora aceita' = ANY (public.locacao_checklist_l(pg_temp.l('SEG')))),
  'seguro: apólice e proposta fora do checklist');
SELECT pg_temp.ok(cardinality(public.locacao_checklist_l(pg_temp.l('SEG'))) = 8, 'seguro: 8 obrigatórios (4 locatário + 4 proprietário)');
SELECT pg_temp.ok(cardinality(public.locacao_docs_faltando(pg_temp.l('SEG'))) = 0,
  'seguro com locatário+proprietário entregues: nada faltando (Montar contrato destravado)');
SELECT pg_temp.ok((pg_temp.l('SEG')).docs_completos_em = timestamptz '2026-11-01 18:00+00', 'seguro: data da documentação completa recalculada pela migration');
SELECT pg_temp.ok(cardinality(public.locacao_docs_faltando(pg_temp.l('SEG2'))) = 1,
  'seguro faltando 1 doc do locatário: trava continua pelos docs do locatário/proprietário');
SELECT pg_temp.ok((SELECT count(*) FROM public.locacao_documentos d WHERE d.locacao_id = (SELECT v FROM sd_ids WHERE k = 'SEG')
  AND d.removido_em IS NULL) = 9, 'arquivo de apólice já anexado continua guardado (nada apagado)');

-- 2) Fiador, Caução e PJ iguais --------------------------------------------------------------------------------------
SELECT pg_temp.ok((SELECT array_agg(rotulo ORDER BY ordem) FROM public.locacao_partes(pg_temp.l('FIA')))
  = ARRAY['Locatário PF', 'Fiador PF', 'Proprietário PF'], 'fiador: 3 partes como antes');
SELECT pg_temp.ok((SELECT array_agg(rotulo ORDER BY ordem) FROM public.locacao_partes(pg_temp.l('CAU')))
  = ARRAY['Locatário PF', 'Garantia — Caução', 'Proprietário PF'], 'caução: 3 partes como antes');
SELECT pg_temp.ok('Comprovante do depósito da caução' = ANY (public.locacao_checklist_l(pg_temp.l('CAU'))),
  'caução: documentos da caução continuam obrigatórios');
SELECT pg_temp.ok((SELECT array_agg(grupo ORDER BY ordem) FROM public.locacao_partes(pg_temp.l('SEGPJ')))
  = ARRAY['locatario_pj', 'proprietario_pj'], 'seguro PJ: listas PJ, sem seguro');

-- 3) Imobiliárias já configuradas ------------------------------------------------------------------------------------
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.locacao_config WHERE documentos ? 'seguro_fianca'),
  'nenhuma imobiliária ficou com a lista do seguro-fiança');
SELECT pg_temp.ok((SELECT itens FROM public.locacao_config_sf_backup WHERE organization_id = (SELECT v FROM sd_ids WHERE k = 'orgA'))
  = '["Apólice/aprovação do seguro-fiança","Proposta da seguradora aceita"]'::jsonb, 'lista antiga guardada para o rollback');
SELECT pg_temp.ok((SELECT documentos->'caucao' FROM public.locacao_config WHERE organization_id = (SELECT v FROM sd_ids WHERE k = 'orgA'))
  = '["Comprovante do depósito da caução","Termo de caução assinado pelo locatário"]'::jsonb, 'outras listas da imobiliária intactas');
SELECT pg_temp.ok(NOT (public.locacao_docs_padrao() ? 'seguro_fianca') AND public.locacao_docs_padrao() ? 'caucao',
  'lista padrão sem seguro-fiança');
SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'public.locacao_config_sf_backup', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.locacao_config_sf_backup', 'SELECT'), 'backup fechado ao navegador');
SELECT pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.locacao_config_sf_backup'::regclass), 'backup com RLS');

SELECT CASE WHEN ok THEN 'ok ' ELSE 'FALHA ' END || msg FROM r;
SELECT 'TOTAL=' || count(*) || ' ok=' || count(*) FILTER (WHERE ok) || ' falhas=' || count(*) FILTER (WHERE NOT ok) FROM r;
