-- Desfaz 20261129120000_locacao_seguro_fianca_sem_docs (t_d3e1c29f). Rodar em transação, DEPOIS de voltar o código do site.
-- 1) locacao_partes e locacao_docs_padrao voltam com o texto exato de antes (20261124130000 e 20261113120000).
-- 2) A lista do seguro-fiança de cada imobiliária volta de locacao_config_sf_backup (só onde a gestão não gravou outra
--    lista de seguro-fiança depois); a tabela de backup é apagada.
-- 3) A data "documentação completa" das locações ativas com seguro-fiança é recalculada. Nenhum arquivo é tocado.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

CREATE OR REPLACE FUNCTION public.locacao_partes(_l public.locacoes)
RETURNS TABLE (ordem integer, parte text, grupo text, rotulo text)
LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT * FROM (VALUES
    (1, 'locatario',
        CASE WHEN _l.ficha->>'locatario_pessoa' = 'pj' THEN 'locatario_pj' ELSE 'locatario' END,
        CASE WHEN _l.ficha->>'locatario_pessoa' = 'pj' THEN 'Locatário PJ' ELSE 'Locatário PF' END),
    (2, _l.garantia,
        CASE WHEN _l.garantia = 'fiador' AND _l.ficha->>'fiador_pessoa' = 'pj' THEN 'fiador_pj' ELSE _l.garantia END,
        CASE WHEN _l.garantia = 'fiador' THEN CASE WHEN _l.ficha->>'fiador_pessoa' = 'pj' THEN 'Fiador PJ' ELSE 'Fiador PF' END
          ELSE 'Garantia — ' || public.locacao_garantia_rotulo(_l.garantia) END),
    (3, 'proprietario',
        CASE WHEN _l.ficha->>'proprietario_pessoa' = 'pj' THEN 'proprietario_pj' ELSE 'proprietario' END,
        CASE WHEN _l.ficha->>'proprietario_pessoa' = 'pj' THEN 'Proprietário PJ' ELSE 'Proprietário PF' END)
  ) v(ordem, parte, grupo, rotulo)
$$;

CREATE OR REPLACE FUNCTION public.locacao_docs_padrao() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT '{
    "locatario":["RG/CNH do locatário","CPF do locatário","Comprovante de renda do locatário","Comprovante de residência do locatário"],
    "fiador":["RG/CNH do fiador","Comprovante de renda do fiador","Matrícula do imóvel do fiador (quitado)","Certidão de casamento do fiador (se casado)"],
    "caucao":["Comprovante do depósito da caução","Termo de caução assinado pelo locatário"],
    "seguro_fianca":["Apólice/aprovação do seguro-fiança","Proposta da seguradora aceita"],
    "proprietario":["RG/CNH do proprietário","Matrícula atualizada do imóvel","Formulário do proprietário (dados bancários p/ repasse)","Último IPTU / conta de consumo"],
    "locatario_pj":["Contrato social da empresa locatária (última alteração)","Cartão CNPJ da empresa locatária","Faturamento 12 meses ou extrato bancário da empresa locatária","IR da empresa locatária","RG/CNH dos representantes da empresa locatária","Certidão de estado civil dos representantes da locatária","RG/CNH dos moradores maiores de 18 anos"],
    "proprietario_pj":["Contrato social da empresa proprietária (última alteração)","RG/CNH do representante da empresa proprietária","Certidão de estado civil do representante da proprietária","Matrícula, escritura ou contrato de compra e venda do imóvel","Fatura CPFL do imóvel","Contracapa do IPTU do imóvel","Fatura SAAE do imóvel","Boleto do condomínio (opcional)","CND do condomínio (opcional)","Boleto do gás (opcional)"]
  }'::jsonb
$$;

UPDATE public.locacao_config c SET documentos = c.documentos || jsonb_build_object('seguro_fianca', b.itens)
  FROM public.locacao_config_sf_backup b
 WHERE b.organization_id = c.organization_id AND NOT (c.documentos ? 'seguro_fianca');
DROP TABLE public.locacao_config_sf_backup;

SELECT public.locacao_docs_situacao(l.id) FROM public.locacoes l
 WHERE l.garantia = 'seguro_fianca' AND l.situacao = 'ativa';

COMMIT;
