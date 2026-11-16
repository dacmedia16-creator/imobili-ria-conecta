-- Seed fictício da suíte locacao-seguro-sem-docs (gravado ANTES da migration, dentro da transação revertida).
-- Agência A (…-0001) com a lista de documentos ANTIGA gravada (inclui seguro_fianca), como as imobiliárias reais.
CREATE TEMP TABLE sd_ids(k text PRIMARY KEY, v uuid);
GRANT ALL ON sd_ids TO authenticated, service_role;
INSERT INTO sd_ids VALUES ('orgA', '00000000-0000-4000-8000-000000000001'), ('c2', 'ebffaded-075c-493f-89e2-1d3d62901dc4');
INSERT INTO sd_ids SELECT k, gen_random_uuid() FROM unnest(ARRAY['SEG', 'SEG2', 'FIA', 'CAU', 'SEGPJ']) k;

INSERT INTO public.locacao_config (organization_id) VALUES ((SELECT v FROM sd_ids WHERE k = 'orgA'))
  ON CONFLICT (organization_id) DO NOTHING;
UPDATE public.locacao_config SET documentos = '{
    "locatario":["RG/CNH do locatário","CPF do locatário","Comprovante de renda do locatário","Comprovante de residência do locatário"],
    "fiador":["RG/CNH do fiador","Comprovante de renda do fiador","Matrícula do imóvel do fiador (quitado)","Certidão de casamento do fiador (se casado)"],
    "caucao":["Comprovante do depósito da caução","Termo de caução assinado pelo locatário"],
    "seguro_fianca":["Apólice/aprovação do seguro-fiança","Proposta da seguradora aceita"],
    "proprietario":["RG/CNH do proprietário","Matrícula atualizada do imóvel","Formulário do proprietário (dados bancários p/ repasse)","Último IPTU / conta de consumo"]
  }'::jsonb WHERE organization_id = (SELECT v FROM sd_ids WHERE k = 'orgA');

INSERT INTO public.locacoes (id, organization_id, corretor_id, garantia, etapa, ficha)
SELECT (SELECT v FROM sd_ids WHERE k = x.k), (SELECT v FROM sd_ids WHERE k = 'orgA'), (SELECT v FROM sd_ids WHERE k = 'c2'),
       x.g, 'documentacao', x.f::jsonb
  FROM (VALUES ('SEG', 'seguro_fianca', '{}'), ('SEG2', 'seguro_fianca', '{}'), ('FIA', 'fiador', '{}'),
               ('CAU', 'caucao', '{}'), ('SEGPJ', 'seguro_fianca', '{"locatario_pessoa":"pj","proprietario_pessoa":"pj"}')) x(k, g, f);

-- SEG: locatário + proprietário completos + 1 apólice já anexada (o arquivo antigo não pode sumir).
-- SEG2: igual, mas sem o CPF do locatário. Datas fixas: a apólice é a última (muda a data "completa").
INSERT INTO public.locacao_documentos (organization_id, locacao_id, item, storage_path, nome_arquivo, enviado_por, enviado_em)
SELECT (SELECT v FROM sd_ids WHERE k = 'orgA'), (SELECT v FROM sd_ids WHERE k = l.k), d.item,
       'teste/' || gen_random_uuid() || '.pdf', 'doc.pdf', (SELECT v FROM sd_ids WHERE k = 'c2'),
       timestamptz '2026-11-01 10:00+00' + (d.n || ' hours')::interval
  FROM (VALUES ('SEG'), ('SEG2')) l(k),
       (VALUES (1, 'RG/CNH do locatário'), (2, 'CPF do locatário'), (3, 'Comprovante de renda do locatário'),
               (4, 'Comprovante de residência do locatário'), (5, 'RG/CNH do proprietário'), (6, 'Matrícula atualizada do imóvel'),
               (7, 'Formulário do proprietário (dados bancários p/ repasse)'), (8, 'Último IPTU / conta de consumo'),
               (9, 'Apólice/aprovação do seguro-fiança')) d(n, item)
 WHERE NOT (l.k = 'SEG2' AND d.item = 'CPF do locatário');
SELECT public.locacao_docs_situacao(v) FROM sd_ids WHERE k IN ('SEG', 'SEG2');
