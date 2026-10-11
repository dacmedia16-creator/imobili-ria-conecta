-- O botão "Nova Venda" aparece pra corretor/gestor/team_leader (dashboard.tsx, vendas.index.tsx),
-- mas a policy de INSERT só liberava quem tinha a role 'corretor'. Gestor/team_leader sem o papel
-- de corretor (ex: gestor puro) tomava "new row violates row-level security policy" ao tentar
-- criar um rascunho pra si mesmo. Alinha a policy ao que a UI já oferece.
DROP POLICY IF EXISTS sales_insert_corretor ON public.sales;
CREATE POLICY sales_insert_corretor ON public.sales AS PERMISSIVE FOR INSERT TO authenticated
WITH CHECK (
  (corretor_id = (select auth.uid()))
  AND (
    has_role((select auth.uid()), 'corretor'::app_role)
    OR has_any_role((select auth.uid()), ARRAY['gestor'::app_role, 'team_leader'::app_role])
  )
);
