-- Item 4 completo: corretor captador/vendedor deixam de ser texto livre e passam a linkar com
-- conta de usuário real (igual gestor/team_leader já fazem via sales.coordenador_id/team_leader_id).
-- occurrence_commissions ganha user_id pra guardar esse link nas linhas de comissão (captador,
-- vendedor, gestor, team_leader — indicador/outro continuam só por nome, geralmente são gente de
-- fora do sistema).
ALTER TABLE public.sales ADD COLUMN corretor_captador_id uuid REFERENCES auth.users(id);
ALTER TABLE public.sales ADD COLUMN corretor_vendedor_id uuid REFERENCES auth.users(id);
ALTER TABLE public.occurrence_commissions ADD COLUMN user_id uuid REFERENCES auth.users(id);
