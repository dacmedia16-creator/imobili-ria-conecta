-- Rollback de 20261118120000_ajuda_max_segue_locacao.sql (t_8fd40b23).
-- Volta à ligação manual: o balão só aparece com Locação ligada E linha 'ajuda_max_locacao' com enabled=true
-- (corpo idêntico ao da 20261116120000). Nenhuma linha de organization_modules é tocada: a Conferência, que tem a
-- linha enabled=true, continua com o balão; as demais com Locação ligada e sem linha deixam de ver.
-- Reverter junto o front (tela Módulos passa a mostrar "ligado" só com linha enabled=true).
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

CREATE OR REPLACE FUNCTION public.ajuda_max_locacao_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(public.locacao_enabled() AND EXISTS (
    SELECT 1 FROM public.organization_modules m
     WHERE m.organization_id = public.current_org_id() AND m.module = 'ajuda_max_locacao' AND m.enabled), false)
$$;
REVOKE ALL ON FUNCTION public.ajuda_max_locacao_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajuda_max_locacao_enabled() TO authenticated, service_role;
COMMENT ON FUNCTION public.ajuda_max_locacao_enabled() IS NULL;

COMMIT;
