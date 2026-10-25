-- Leads — contato (telefone/e-mail) só depois do aceite. Card t_3284da21; "2 sim" de Denis em 25/10/2026,
-- tópico 6238. Base: 20261025150000_leads_p2p3_distribuicao.
--
-- ADITIVA. Rollback: docs/sql/rollback/20261025160000_leads_contato_apos_aceite.rollback.sql
--
-- Regra: o corretor responsável NÃO lê telefone nem e-mail do lead antes de aceitar.
--   - Gestor/admin (leads_gestor) leem sempre.
--   - Responsável (e o Team Leader da equipe) leem só depois do aceite (aceito_em preenchido).
--   - Banco "Leads da imobiliária": o lead está sem responsável -> só gestor/admin leem; quem pega
--     (lead_pegar) já fica aceito e passa a ler.
--   - Redistribuição/atribuição zera aceito_em -> o novo responsável só lê depois de aceitar e o antigo
--     deixa de ver o lead.
-- Como: o app (authenticated) perde o SELECT nas colunas telefone, email e externo_id da tabela leads
-- (inclusive para filtrar/ordenar pela REST) e passa a pedir o contato pela RPC lead_contatos, que
-- aplica a regra acima. As RPCs SECURITY DEFINER continuam lendo tudo (é o dono que lê).
-- externo_id também sai: no P4 (WhatsApp) pode ser o próprio número do cliente.
-- ATENÇÃO para migrations futuras: coluna nova em leads NÃO fica legível para authenticated
-- automaticamente; dê GRANT SELECT (coluna) se o app precisar.
BEGIN;

-- 1) Leitura por coluna: tudo, menos o contato ---------------------------------------------------
REVOKE SELECT ON public.leads FROM authenticated;
DO $$
DECLARE _cols text;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO _cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.leads'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname NOT IN ('telefone', 'email', 'externo_id');
  EXECUTE format('GRANT SELECT (%s) ON public.leads TO authenticated', _cols);
END $$;

-- 2) Contato só para quem pode ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lead_contatos(_ids uuid[])
RETURNS TABLE (id uuid, telefone text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
DECLARE _org uuid := public.lead_ctx(); _gestor boolean := public.leads_gestor();
BEGIN
  IF _ids IS NULL OR cardinality(_ids) > 500 THEN
    RAISE EXCEPTION 'Lista de leads invalida' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT l.id, l.telefone, l.email FROM public.leads l
   WHERE l.organization_id = _org AND l.id = ANY (_ids)
     AND (_gestor
          OR (l.aceito_em IS NOT NULL AND l.no_banco_desde IS NULL
              AND l.responsavel_id IN (SELECT public.leads_responsaveis_visiveis())));
END $$;
REVOKE ALL ON FUNCTION public.lead_contatos(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_contatos(uuid[]) TO authenticated, service_role;

COMMIT;
