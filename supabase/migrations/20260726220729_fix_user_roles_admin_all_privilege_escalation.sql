-- Recuperado de supabase_migrations.schema_migrations (versão 20260726220729) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

-- user_roles_admin_all (cmd ALL, qual = has_role(admin)) era combinada via OR com
-- user_roles_admin_write, que já cobre corretamente inserts/updates/deletes de admin
-- (bloqueando auto-edição e granting de admin/super_admin). A policy "_all" não tinha
-- nenhuma dessas travas, então um admin conseguia se auto-promover a super_admin
-- (INSERT INTO user_roles (user_id, role) VALUES (auth.uid(), 'super_admin')) -- CVE
-- interno confirmado via simulação de RLS. SELECT de admin sobre todas as linhas
-- continua garantido por user_roles_self_select, que já cobre esse caso.
DROP POLICY IF EXISTS user_roles_admin_all ON public.user_roles;
