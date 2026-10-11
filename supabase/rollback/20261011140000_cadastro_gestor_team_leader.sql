-- Reversão da 20261011140000_cadastro_gestor_team_leader.sql.
-- Atenção: com a função removida, o servidor novo do ADM recusa TODO cadastro de usuário (falha
-- fechada). Reverta junto o frontend/servidor para a versão anterior (commit-base 4ab373f).
drop function if exists public.cadastro_equipe_destino(uuid, uuid, public.app_role);
