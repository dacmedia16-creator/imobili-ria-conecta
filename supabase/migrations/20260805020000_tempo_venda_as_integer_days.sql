-- sales.tempo_venda e occurrences.tempo_venda são texto livre ("3 meses", "1 semana", "45") —
-- impossível de agregar em relatório. Adiciona tempo_venda_dias (integer, dias) ao lado, migrando
-- os valores existentes com parsing best-effort: "semana" vira ×7, "mês"/"mes" vira ×30, número
-- solto é tratado como dias (era o formato pedido no placeholder "Ex: 45 dias" do formulário).
-- A coluna de texto antiga fica intacta por enquanto (não foi removida — o DROP COLUMN foi
-- bloqueado pelo classificador de segurança do agente por ser uma operação destrutiva/irreversível;
-- precisa ser removida manualmente depois que o front-end parar de referenciar tempo_venda).
CREATE OR REPLACE FUNCTION public.tmp_parse_tempo_venda_dias(txt text) RETURNS integer
 LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN txt IS NULL OR btrim(txt) = '' THEN NULL
    WHEN txt ~* 'semana' THEN (regexp_match(txt, '(\d+)'))[1]::int * 7
    WHEN txt ~* 'm[eê]s' THEN (regexp_match(txt, '(\d+)'))[1]::int * 30
    WHEN txt ~ '\d' THEN (regexp_match(txt, '(\d+)'))[1]::int
    ELSE NULL
  END;
$$;

ALTER TABLE public.sales ADD COLUMN tempo_venda_dias integer;
UPDATE public.sales SET tempo_venda_dias = public.tmp_parse_tempo_venda_dias(tempo_venda) WHERE tempo_venda IS NOT NULL;
COMMENT ON COLUMN public.sales.tempo_venda_dias IS 'Tempo que o imóvel levou para vender, em dias. Preenchido pelo corretor no Resumo da venda; copiado para occurrences.tempo_venda_dias ao gerar a ocorrência. Substitui o antigo tempo_venda (texto livre, mantido apenas por compatibilidade histórica).';

ALTER TABLE public.occurrences ADD COLUMN tempo_venda_dias integer;
UPDATE public.occurrences SET tempo_venda_dias = public.tmp_parse_tempo_venda_dias(tempo_venda) WHERE tempo_venda IS NOT NULL;
COMMENT ON COLUMN public.occurrences.tempo_venda_dias IS 'Espelha sales.tempo_venda_dias — copiado ao gerar a ocorrência. Substitui o antigo tempo_venda (texto livre, mantido apenas por compatibilidade histórica).';

DROP FUNCTION public.tmp_parse_tempo_venda_dias(text);
