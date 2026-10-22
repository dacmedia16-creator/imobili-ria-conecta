-- Wiki MAX: bucket PRIVADO para os vídeos dos guias (t_9bc9447e, 22/10/2026).
--
-- Só o bucket. Nenhuma policy para anon/authenticated: o navegador não lista nem lê direto.
-- O link assinado sai da server function linkDoVideoWiki (src/lib/wiki-max/videos.functions.ts),
-- que exige login e só aceita as chaves fixas de WIKI_VIDEOS. A trava multiempresa
-- (mt_1c_storage_scope) não inclui este bucket: o conteúdo é o mesmo para todas as imobiliárias.
-- Limite de 100 MB por arquivo, só MP4.
--
-- Reverter: apagar os objetos do bucket pela Storage API e depois
--   DELETE FROM storage.buckets WHERE id = 'wiki-midia';
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('wiki-midia', 'wiki-midia', false, 104857600, ARRAY['video/mp4'])
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'wiki-midia' AND public IS DISTINCT FROM false)
  THEN RAISE EXCEPTION 'Bucket wiki-midia deve ser privado'; END IF;
END $$;
