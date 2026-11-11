-- Ajuda MAX acompanha a Locação (t_8fd40b23; decisão de Denis em 11/11/2026: "todas vão ter quando tiver a
-- locação ligada").
-- Antes: o balão exigia Locação ligada E uma linha 'ajuda_max_locacao' com enabled=true (ligação manual).
-- Agora: Locação ligada basta. A linha 'ajuda_max_locacao' vira só o DESLIGADOR por imobiliária:
--   sem linha ou enabled=true  -> segue a Locação (ligado se a Locação estiver ligada);
--   enabled=false              -> desligado nesta imobiliária, mesmo com a Locação ligada.
-- Nada mais muda: limite de 20/dia, contador, isolamento por imobiliária, só-fotógrafo sem acesso (locacao_enabled)
-- e todas as RPCs do balão e de "Sugestões e erros" continuam chamando esta mesma função.
-- Rollback: supabase/rollback/20261118120000_ajuda_max_segue_locacao.sql
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

CREATE OR REPLACE FUNCTION public.ajuda_max_locacao_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(public.locacao_enabled() AND NOT EXISTS (
    SELECT 1 FROM public.organization_modules m
     WHERE m.organization_id = public.current_org_id() AND m.module = 'ajuda_max_locacao' AND NOT m.enabled), false)
$$;
REVOKE ALL ON FUNCTION public.ajuda_max_locacao_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajuda_max_locacao_enabled() TO authenticated, service_role;
COMMENT ON FUNCTION public.ajuda_max_locacao_enabled() IS
  'Ajuda MAX (t_8fd40b23): ligado quando a Locação está liberada para quem está logado, salvo desligador '
  '(organization_modules ajuda_max_locacao enabled=false) na imobiliária.';

COMMIT;
