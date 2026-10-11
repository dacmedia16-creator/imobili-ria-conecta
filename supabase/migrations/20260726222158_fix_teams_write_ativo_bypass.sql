-- Recuperado de supabase_migrations.schema_migrations (versão 20260726222158) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

-- teams_write tinha "lider_id = auth.uid()" e leads_team_or_parent(...) diretos, sem passar por
-- has_role/has_any_role -- um gestor desativado que lidera uma equipe continuava conseguindo
-- editar/apagar essa equipe (ex.: trocar parent_team_id, criar sub-equipe). Mesma trava aplicada
-- em can_view_sale/can_edit_sale_stage/sales_select nesta sessao.
DROP POLICY IF EXISTS teams_write ON public.teams;
CREATE POLICY teams_write ON public.teams FOR ALL TO authenticated
USING (
  is_active_user(auth.uid()) AND (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role])
    OR leads_team_or_parent(id, auth.uid())
  )
)
WITH CHECK (
  is_active_user(auth.uid()) AND (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role])
    OR lider_id = auth.uid()
    OR (parent_team_id IS NOT NULL AND leads_team_or_parent(parent_team_id, auth.uid()))
  )
);
