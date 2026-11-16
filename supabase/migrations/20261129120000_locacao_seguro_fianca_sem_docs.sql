-- Locação — Seguro-fiança sai do checklist de documentos do corretor (t_d3e1c29f, pedido de Denis 16/11, tópico 6238).
-- Na etapa Documentação o corretor ainda não tem apólice nem proposta da seguradora; a apólice é registrada depois,
-- no quadro "Seguro e condomínio" (nº da apólice).
--
-- Rollback: supabase/rollback/20261129120000_locacao_seguro_fianca_sem_docs.sql
-- Teste:    supabase/tests/run-locacao-seguro-sem-docs.sh (homologação, transação desfeita; nunca produção).
--
-- O que muda:
--  * locacao_partes: com garantia seguro_fianca, as partes do checklist são só Locatário e Proprietário. Como checklist,
--    "faltando" (trava do Montar contrato), data da documentação completa e a tela saem desta função, a parte
--    seguro-fiança deixa de aparecer, de contar como obrigatória e de travar. Fiador, Caução, Loft, Título e Outras
--    continuam iguais (mesmo texto da versão anterior, de 20261124130000).
--  * locacao_docs_padrao: a lista padrão deixa de ter o grupo seguro_fianca (as outras listas, iguais).
--  * Imobiliárias já configuradas: o grupo seguro_fianca sai de locacao_config.documentos; a lista removida fica guardada
--    em locacao_config_sf_backup (sem acesso pelo navegador) para o rollback devolver.
--  * Nenhum arquivo é apagado: o que já foi anexado continua em locacao_documentos e no bucket privado.
--  * A data "documentação completa" das locações ativas com seguro-fiança é recalculada.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- 1) Partes do checklist: seguro-fiança não tem parte de documentos ----------------------------------------------
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
  -- t_d3e1c29f: seguro-fiança não pede documento na Documentação (apólice vai em "Seguro e condomínio").
  WHERE NOT (v.ordem = 2 AND v.parte = 'seguro_fianca')
$$;

-- 2) Lista padrão sem o grupo seguro_fianca (as demais listas com o texto exato de antes) ---------------------------
CREATE OR REPLACE FUNCTION public.locacao_docs_padrao() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT '{
    "locatario":["RG/CNH do locatário","CPF do locatário","Comprovante de renda do locatário","Comprovante de residência do locatário"],
    "fiador":["RG/CNH do fiador","Comprovante de renda do fiador","Matrícula do imóvel do fiador (quitado)","Certidão de casamento do fiador (se casado)"],
    "caucao":["Comprovante do depósito da caução","Termo de caução assinado pelo locatário"],
    "proprietario":["RG/CNH do proprietário","Matrícula atualizada do imóvel","Formulário do proprietário (dados bancários p/ repasse)","Último IPTU / conta de consumo"],
    "locatario_pj":["Contrato social da empresa locatária (última alteração)","Cartão CNPJ da empresa locatária","Faturamento 12 meses ou extrato bancário da empresa locatária","IR da empresa locatária","RG/CNH dos representantes da empresa locatária","Certidão de estado civil dos representantes da locatária","RG/CNH dos moradores maiores de 18 anos"],
    "proprietario_pj":["Contrato social da empresa proprietária (última alteração)","RG/CNH do representante da empresa proprietária","Certidão de estado civil do representante da proprietária","Matrícula, escritura ou contrato de compra e venda do imóvel","Fatura CPFL do imóvel","Contracapa do IPTU do imóvel","Fatura SAAE do imóvel","Boleto do condomínio (opcional)","CND do condomínio (opcional)","Boleto do gás (opcional)"]
  }'::jsonb
$$;

-- 3) Imobiliárias já configuradas: guarda a lista do seguro-fiança e tira do checklist -------------------------------
CREATE TABLE public.locacao_config_sf_backup (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  itens jsonb NOT NULL,
  salvo_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.locacao_config_sf_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locacao_config_sf_backup FROM PUBLIC, anon, authenticated;

INSERT INTO public.locacao_config_sf_backup (organization_id, itens)
SELECT organization_id, documentos->'seguro_fianca' FROM public.locacao_config WHERE documentos ? 'seguro_fianca';
UPDATE public.locacao_config SET documentos = documentos - 'seguro_fianca' WHERE documentos ? 'seguro_fianca';

-- 4) Data da documentação completa das locações ativas com seguro-fiança (nenhum arquivo é tocado) -----------------
SELECT public.locacao_docs_situacao(l.id) FROM public.locacoes l
 WHERE l.garantia = 'seguro_fianca' AND l.situacao = 'ativa';

COMMIT;
