-- Remove 2 tabelas de backup esquecidas no schema public (t_f4137af5, autorizado por Denis 23/11, tópico 6238).
--  * public.bkp_carreira_plano_2027_zerar — cópia manual de 12/11 (8 linhas), feita antes de zerar planos 2027.
--  * public.locacao_config_sf_backup — guarda criada pela 20261129120000 para o rollback dela (0 linhas).
-- Ambas: RLS ligada, nenhuma policy, nenhum gatilho, view, função, FK de entrada, cron ou código do site/Edge que as use.
-- Cópia prévia (pg_dump -Fc das 2 tabelas, estrutura + dados) conferida por restauração isolada:
--   /root/.config/max/adm-max-prod-backups/t_f4137af5-2tabelas-backup-20261123T013820Z.dump (VPS, chmod 600)
-- Sem CASCADE: se algo passar a depender delas, a migration falha em vez de apagar junto.
-- Rollback: supabase/rollback/20261226120000_remover_tabelas_backup_esquecidas.sql (estrutura; dados vêm do dump).
-- Obs.: o rollback antigo da 20261129120000 lê locacao_config_sf_backup; para usá-lo, rode antes este rollback.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

DROP TABLE public.bkp_carreira_plano_2027_zerar;
DROP TABLE public.locacao_config_sf_backup;

COMMIT;
