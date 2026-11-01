-- Oportunidades: o bloco de encaixes (🤝 / ⭐, lista e "não encaixa") só para quem está no par
-- (pedido de Denis, tópico 6238, card t_6dd4a31b). O cartão do post continua visível para todos.
--
-- Regras:
--   ⭐ procura × captação: o dono da captação (captor_id) e o autor da procura.
--   🤝 procura × oferta do grupo: os autores dos dois posts.
--   Gestor / administrador / staff / team leader / coordenador da imobiliária veem todos os encaixes.
-- O autor do post (author_profile_id) é ligado ao cadastro pelo TELEFONE do remetente na ingestão,
-- só quando há exatamente 1 membro ativo da imobiliária com aquele celular. O telefone NÃO é gravado.
-- Sem autor identificado, o post não dá direito de ver encaixe a nenhum corretor.
-- Reversão: supabase/rollback/20261101120000_oportunidades_encaixe_envolvidos.sql
BEGIN;

-- 1) Autor do post -----------------------------------------------------------------------------
ALTER TABLE public.opportunity_posts
  ADD COLUMN IF NOT EXISTS author_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS opportunity_posts_author_idx
  ON public.opportunity_posts (author_profile_id) WHERE author_profile_id IS NOT NULL;
-- O autor não é lido pela tela (só pelo servidor): o SELECT do usuário passa a ser por coluna.
-- Coluna nova no futuro precisa entrar nesta lista para a tela conseguir ler.
REVOKE SELECT ON public.opportunity_posts FROM authenticated;
GRANT SELECT (id, organization_id, source_key, kind, tipo, finalidade, bairro, valor_min, valor_max, valor,
              corretor, texto, posted_at, created_at) ON public.opportunity_posts TO authenticated;

-- 2) Quem vê tudo: gestor, administrador, administrador principal, staff, team leader e coordenador
--    (papel na imobiliária ativa; TL e coordenador incluídos por decisão de Denis, t_1805d507).
CREATE OR REPLACE FUNCTION public.opportunity_is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL
    AND public.has_any_role(auth.uid(),
      ARRAY['gestor', 'admin', 'super_admin', 'staff', 'team_leader', 'coordenador']::public.app_role[])
$$;
REVOKE ALL ON FUNCTION public.opportunity_is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opportunity_is_staff() TO authenticated, service_role;

-- Quem está vendo o mural (para o servidor calcular os encaixes). Vazio com o módulo desligado.
CREATE OR REPLACE FUNCTION public.opportunity_viewer()
RETURNS TABLE (org_id uuid, is_staff boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.current_org_id(), public.opportunity_is_staff()
  WHERE auth.uid() IS NOT NULL AND public.opportunities_enabled() AND public.current_org_id() IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.opportunity_viewer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opportunity_viewer() TO authenticated;

-- O usuário logado faz parte do par (post → alvo)? Alvo = outro post ou captação.
CREATE OR REPLACE FUNCTION public.opportunity_pair_involves_me(_post uuid, _target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.opportunity_is_staff()
    OR EXISTS (SELECT 1 FROM public.opportunity_posts p
               WHERE p.id IN (_post, _target) AND p.author_profile_id = auth.uid()
                 AND p.organization_id = public.current_org_id())
    OR EXISTS (SELECT 1 FROM public.exclusive_captures c
               WHERE c.id = _target AND c.captor_id = auth.uid()
                 AND c.organization_id = public.current_org_id()))
$$;
REVOKE ALL ON FUNCTION public.opportunity_pair_involves_me(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opportunity_pair_involves_me(uuid, uuid) TO authenticated;

-- 3) "Não encaixa": só quem está no par lê e marca -----------------------------------------------
DROP POLICY IF EXISTS opportunity_hidden_read ON public.opportunity_hidden_pairs;
CREATE POLICY opportunity_hidden_read ON public.opportunity_hidden_pairs FOR SELECT TO authenticated
  USING (public.opportunity_pair_involves_me(post_id, target_id));
DROP POLICY IF EXISTS opportunity_hidden_insert ON public.opportunity_hidden_pairs;
CREATE POLICY opportunity_hidden_insert ON public.opportunity_hidden_pairs FOR INSERT TO authenticated
  WITH CHECK (hidden_by = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.opportunity_posts p WHERE p.id = post_id AND p.organization_id = opportunity_hidden_pairs.organization_id)
    AND public.opportunity_pair_involves_me(post_id, target_id));

-- 4) Captações candidatas: staff recebe todas; corretor, só as próprias (Minha Carreira).
--    O mural calcula os encaixes no servidor e devolve a cada um só o que é dele.
CREATE OR REPLACE FUNCTION public.opportunity_capture_candidates()
RETURNS TABLE (id uuid, captor_id uuid, captor_nome text, tipo_imovel text, bairro text, municipio text, valor_imovel text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT c.id, c.captor_id, coalesce(nullif(c.broker_name, ''), p.nome),
         c.form_data->'imovel'->>'tipo_imovel', c.form_data->'imovel'->>'bairro',
         c.form_data->'imovel'->>'municipio', c.form_data->'imovel'->>'valor_imovel'
  FROM public.exclusive_captures c
  LEFT JOIN public.profiles p ON p.id = c.captor_id
  WHERE public.opportunities_enabled()
    AND c.organization_id = public.current_org_id()
    AND c.status = 'aprovada' AND c.archived_at IS NULL AND c.discarded_at IS NULL
    AND (c.captor_id = auth.uid() OR public.opportunity_is_staff())
$$;
REVOKE ALL ON FUNCTION public.opportunity_capture_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opportunity_capture_candidates() TO authenticated, service_role;

-- 5) Ingestão: liga o autor pelo telefone (sem gravar o número) ---------------------------------
-- Chave do celular: DDD + 8 dígitos (sem 55 e sem o 9 da frente), para casar "+55 15 99123-4567"
-- com "1591234567" (WhatsApp antigo). Fora desse formato = sem chave (não liga ninguém).
CREATE OR REPLACE FUNCTION public.opportunity_phone_key(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  WITH d AS (SELECT regexp_replace(coalesce(_t, ''), '\D', '', 'g') AS s),
       n AS (SELECT CASE WHEN length(s) IN (12, 13) AND left(s, 2) = '55' THEN substr(s, 3) ELSE s END AS s FROM d)
  SELECT CASE
    WHEN length(s) = 11 AND substr(s, 3, 1) = '9' THEN substr(s, 1, 2) || substr(s, 4)
    WHEN length(s) = 10 THEN s
  END FROM n
$$;
REVOKE ALL ON FUNCTION public.opportunity_phone_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.opportunity_phone_key(text) TO service_role;

CREATE OR REPLACE FUNCTION public.opportunity_ingest(_org uuid, _posts jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _n integer;
BEGIN
  IF NOT coalesce((SELECT enabled FROM public.organization_modules
      WHERE organization_id = _org AND module = 'oportunidades'), false) THEN
    RETURN 0;
  END IF;
  IF jsonb_typeof(_posts) <> 'array' OR jsonb_array_length(_posts) > 500 THEN
    RAISE EXCEPTION 'Lote invalido' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.opportunity_posts AS op
    (organization_id, source_key, kind, tipo, finalidade, bairro, valor_min, valor_max, valor, corretor, texto, posted_at)
  SELECT _org, x.source_key, x.kind, x.tipo, x.finalidade, left(x.bairro, 120), x.valor_min, x.valor_max, x.valor,
         left(regexp_replace(x.corretor, '\d', '', 'g'), 80), left(public.opportunity_clean_text(x.texto), 4000), x.posted_at
  FROM jsonb_to_recordset(_posts) AS x(source_key text, kind text, tipo text, finalidade text, bairro text,
       valor_min numeric, valor_max numeric, valor numeric, corretor text, texto text, posted_at timestamptz)
  ON CONFLICT (organization_id, source_key)
  DO UPDATE SET posted_at = greatest(op.posted_at, EXCLUDED.posted_at);
  GET DIAGNOSTICS _n = ROW_COUNT;

  -- Autor: recalculado a cada envio que traz telefone (corrige troca de celular, desligamento e
  -- celular repetido). Só liga com 1 membro ativo da imobiliária com o mesmo celular; 0 ou 2+ = sem
  -- autor. Envio sem telefone não mexe no autor já ligado. O telefone não é gravado em lugar nenhum.
  UPDATE public.opportunity_posts op SET author_profile_id = a.id
  FROM jsonb_to_recordset(_posts) AS x(source_key text, autor_telefone text)
  CROSS JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN (array_agg(p.id))[1] END AS id
    FROM public.profiles p
    JOIN public.organization_members m ON m.user_id = p.id AND m.organization_id = _org AND m.ativo
    WHERE p.ativo IS TRUE
      AND public.opportunity_phone_key(p.telefone) = public.opportunity_phone_key(x.autor_telefone)
  ) a
  WHERE op.organization_id = _org AND op.source_key = x.source_key
    AND public.opportunity_phone_key(x.autor_telefone) IS NOT NULL
    AND op.author_profile_id IS DISTINCT FROM a.id;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.opportunity_ingest(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.opportunity_ingest(uuid, jsonb) TO service_role;

COMMIT;
