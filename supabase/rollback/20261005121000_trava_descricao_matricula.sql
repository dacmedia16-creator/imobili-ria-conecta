-- Reversão EXCLUSIVAMENTE em homologação após backup, fora do horário de edição.
-- Antes, preservar correções auditadas: as colunas novas serão removidas.
BEGIN;
DROP FUNCTION public.corrigir_descricao_matricula(uuid,text);
DROP FUNCTION public.aplicar_descricao_matricula(uuid);
DROP TRIGGER enforce_matricula_descricao ON public.sales;
DROP FUNCTION public.enforce_matricula_descricao();
ALTER TABLE public.sales DROP COLUMN imovel_observacoes_origem,
  DROP COLUMN imovel_descricao_corrigida_por,
  DROP COLUMN imovel_descricao_corrigida_em;
COMMIT;
NOTIFY pgrst, 'reload schema';
