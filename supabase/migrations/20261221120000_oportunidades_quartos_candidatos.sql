-- Oportunidades: a captação candidata passa a trazer os quartos da ficha (t_b832cf00, Denis 22/11/2026, "3 sim").
-- A Minha Carreira chama esta RPC; o encaixe (src/lib/oportunidades.ts) exige captação com quartos >= ao pedido
-- quando a procura e a captação informam quartos. Mesma regra de acesso de 20261101120000 (nada muda em quem vê o quê).
-- Coluna nova no retorno = DROP + CREATE (Postgres não deixa mudar o tipo de retorno com CREATE OR REPLACE).
--
-- Rollback: supabase/rollback/20261221120000_oportunidades_quartos_candidatos.sql
-- Teste:    supabase/tests/run-oportunidades-quartos-candidatos.sh (homologação, transação desfeita)
BEGIN;

DROP FUNCTION IF EXISTS public.opportunity_capture_candidates();
CREATE FUNCTION public.opportunity_capture_candidates()
RETURNS TABLE (id uuid, captor_id uuid, captor_nome text, tipo_imovel text, bairro text, municipio text, valor_imovel text,
               quartos text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT c.id, c.captor_id, coalesce(nullif(c.broker_name, ''), p.nome),
         c.form_data->'imovel'->>'tipo_imovel', c.form_data->'imovel'->>'bairro',
         c.form_data->'imovel'->>'municipio', c.form_data->'imovel'->>'valor_imovel',
         c.form_data->'ficha'->>'quartos'
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
