-- Clicksign na VENDA: lista de corretores signatários lida pelo SERVIDOR (edge clicksign-sale).
-- Cartão t_bc726348 (diagnóstico t_5227e61f); aprovado por Denis em 30/10/2026 para preparar.
-- Rollback: supabase/rollback/20261030150000_clicksign_sale_corretores.sql
--
-- Problema: a edge chamava public.sale_corretores com a chave service_role (sem JWT de usuário).
-- sale_corretores é SECURITY DEFINER com dona mt_1b_definer (sem BYPASSRLS) e a política restritiva
-- org_isolation de sales usa current_org_id() (auth.uid()); sem usuário, a lista voltava VAZIA e
-- toda venda caía em "a venda está sem corretor com cadastro".
--
-- Correção ADITIVA: função nova, dona postgres, uso exclusivo do servidor (só service_role executa).
-- Mesma regra de sale_corretores (captador/vendedor da venda + extras corretor_captador/
-- corretor_vendedor; se não houver nenhum, cai no corretor_id), mas presa à organização recebida
-- (_org vem de clicksign_sale_authorize, já validada com o JWT do usuário): venda e extras de outra
-- imobiliária não entram. public.sale_corretores NÃO muda (usada nas políticas RLS dos usuários).

CREATE FUNCTION public.clicksign_sale_corretores(_org uuid, _sale_id uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH v AS (
    SELECT s.id, s.corretor_captador_id, s.corretor_vendedor_id, s.corretor_id
    FROM public.sales s
    WHERE s.id = _sale_id AND s.organization_id = _org
  ), p AS (
    SELECT v.corretor_captador_id AS uid FROM v
    UNION
    SELECT v.corretor_vendedor_id FROM v
    UNION
    SELECT e.user_id FROM public.sale_commission_extras e
    JOIN v ON v.id = e.sale_id
    WHERE e.organization_id = _org AND e.papel IN ('corretor_captador', 'corretor_vendedor')
  )
  SELECT uid FROM p WHERE uid IS NOT NULL
  UNION
  SELECT v.corretor_id FROM v
  WHERE v.corretor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM p WHERE p.uid IS NOT NULL)
$$;

ALTER FUNCTION public.clicksign_sale_corretores(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.clicksign_sale_corretores(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clicksign_sale_corretores(uuid, uuid) TO service_role;
