-- Rollback de 20261221120000_oportunidades_quartos_candidatos.sql (t_b832cf00): a RPC volta a ser exatamente a de produção
-- antes da mudança (sem a coluna quartos). O site antigo e o novo funcionam com qualquer uma das duas versões
-- (sem quartos = sem filtro de quartos na Minha Carreira).
BEGIN;

DROP FUNCTION IF EXISTS public.opportunity_capture_candidates();
CREATE FUNCTION public.opportunity_capture_candidates()
RETURNS TABLE (id uuid, captor_id uuid, captor_nome text, tipo_imovel text, bairro text, municipio text, valor_imovel text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT c.id, c.captor_id, coalesce(nullif(c.broker_name, ''), p.nome),
         c.form_data->'imovel'->>'tipo_imovel', c.form_data->'imovel'->>'bairro',
         c.form_data->'imovel'->>'municipio', c.form_data->'imovel'->>'valor_imovel'
  FROM public.exclusive_captures c
  LEFT JOIN public.profiles p ON p.id = c.captor_id
  WHERE public.opportunities_enabled()
    AND c.organization_id = public.current_org_id()
    AND c.status = 'aprovada' AND c.archived_at IS NULL AND c.discarded_at IS NULL
    AND (c.captor_id = auth.uid() OR public.opportunity_is_staff())
$$;
REVOKE ALL ON FUNCTION public.opportunity_capture_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opportunity_capture_candidates() TO authenticated, service_role;

COMMIT;
