-- Indicador vira "um por lado", igual fizemos com gestor/team leader: hoje é um único indicador
-- pra venda inteira (indicador + indicador_lado escolhendo de qual fatia sai a comissão dele).
-- Substitui por dois indicadores independentes, um por lado, cada um com seu próprio nome e valor.
--
-- Nenhuma venda em produção usa indicador_lado ainda (conferido: 0 linhas), então não precisa de
-- backfill. Mantém as colunas antigas (indicador/indicador_lado/valor_comissao_indicador/
-- percentual_comissao_indicador) sem uso — não são lidas mais pelo front, só ficam paradas no
-- schema (padrão já adotado nesta sessão: nunca DROP COLUMN).
ALTER TABLE public.sales ADD COLUMN indicador_captador text;
ALTER TABLE public.sales ADD COLUMN indicador_vendedor text;
ALTER TABLE public.sales ADD COLUMN valor_comissao_indicador_captador numeric;
ALTER TABLE public.sales ADD COLUMN valor_comissao_indicador_vendedor numeric;
