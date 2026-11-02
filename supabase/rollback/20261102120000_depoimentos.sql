-- Rollback de 20261102120000_depoimentos (t_c7cfaf00): remove RPCs, helpers e as 4 tabelas.
-- ATENÇÃO: apaga os depoimentos/feedbacks já enviados. Antes de rodar em produção, faça o backup
-- (bash /root/.config/max/adm-max-prod-pg/backup-prod.sh depoimentos-rollback).
-- Nenhuma tabela/função que já existia é tocada (profiles, activity_logs, avatars seguem iguais).
BEGIN;

DROP FUNCTION IF EXISTS public.depoimentos_publicos();
DROP FUNCTION IF EXISTS public.depoimento_corrigir(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.depoimento_moderar(uuid, text, text);
DROP FUNCTION IF EXISTS public.depoimento_moderacao_listar();
DROP FUNCTION IF EXISTS public.depoimento_retirar(uuid);
DROP FUNCTION IF EXISTS public.depoimento_enviar(integer, text, text, text, text, boolean, text, text);
DROP FUNCTION IF EXISTS public.depoimento_responder_convite(text);
DROP FUNCTION IF EXISTS public.depoimento_minha_situacao();
DROP FUNCTION IF EXISTS public.depoimento_eh_moderador();
DROP FUNCTION IF EXISTS public.depoimento_tem_uso_real(uuid);
DROP FUNCTION IF EXISTS public.depoimento_papel(uuid, uuid);
DROP FUNCTION IF EXISTS public.depoimento_nome_vitrine(text);
DROP TABLE IF EXISTS public.depoimento_eventos;
DROP TABLE IF EXISTS public.depoimento_convites;
DROP TABLE IF EXISTS public.depoimentos;
DROP TABLE IF EXISTS public.depoimento_termos;

COMMIT;
