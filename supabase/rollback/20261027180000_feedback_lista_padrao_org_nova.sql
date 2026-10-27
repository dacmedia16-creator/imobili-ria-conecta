-- ROLLBACK de 20261027180000_feedback_lista_padrao_org_nova (t_57750424).
-- Remove só o gatilho e as duas funções. As listas já gravadas nas imobiliárias FICAM (podem estar em uso
-- em feedback/plano). Para apagar a lista de uma imobiliária específica, faça à parte, conferindo antes
-- owner_feedback_action_done e exclusive_plan_done.
BEGIN;
DROP TRIGGER IF EXISTS trg_zz_feedback_lista_padrao ON public.organizations;
DROP FUNCTION IF EXISTS public.owner_feedback_lista_padrao_trg();
DROP FUNCTION IF EXISTS public.owner_feedback_lista_padrao_copiar(uuid);
COMMIT;
