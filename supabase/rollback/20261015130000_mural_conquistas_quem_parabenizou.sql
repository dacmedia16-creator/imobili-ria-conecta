-- Reversão de 20261015130000_mural_conquistas_quem_parabenizou.sql. Só remove a função de leitura; não apaga dados.
DROP FUNCTION IF EXISTS public.achievement_cheerers(uuid[]);
