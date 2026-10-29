-- Rollback de 20261029130000_ficha_colaborador (t_618b64bc): remove RPCs, helpers e as duas tabelas
-- da ficha do colaborador. ATENÇÃO: apaga as fichas já preenchidas. Antes de rodar em produção,
-- faça o backup (bash /root/.config/max/adm-max-prod-pg/backup-prod.sh ficha-rollback).
-- profile_birthdates (data de nascimento) NÃO é tocada: ela já existia antes desta migration.
-- Os registros de activity_logs ('colaborador_fichas_exportadas' / '_prazo_alterado') ficam como histórico.
BEGIN;

DROP FUNCTION IF EXISTS public.ficha_config_salvar(timestamptz);
DROP FUNCTION IF EXISTS public.ficha_colaboradores_registrar_exportacao(text, integer);
DROP FUNCTION IF EXISTS public.ficha_colaboradores_listar();
DROP FUNCTION IF EXISTS public.ficha_salvar_minha(integer, boolean, text, text, text, text, text, text, date, boolean);
DROP FUNCTION IF EXISTS public.ficha_minha_situacao();
DROP FUNCTION IF EXISTS public.ficha_pode_ver_colaboradores();
DROP FUNCTION IF EXISTS public.ficha_esta_completa(public.colaborador_fichas, date);
DROP FUNCTION IF EXISTS public.ficha_sessao_restrita();
DROP FUNCTION IF EXISTS public.ficha_obrigatoria_desde(uuid);
DROP TABLE IF EXISTS public.ficha_config;
DROP TABLE IF EXISTS public.colaborador_fichas;

COMMIT;
