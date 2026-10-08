-- Feedback ligado à captação exclusiva e ao Plano de Marketing (maquete t_0ebc87ea, aprovada por Denis 08/10).
--
-- 1) Ligação captação <-> anúncio dos portais (exclusive_listing_links): feita SEMPRE pelo corretor depois da
--    publicação (o contrato em papel não tem o código). Prefixo = ID RE/MAX do captador; código de outro ID
--    (parceiro/TL) fica "aguardando_gestor" até o gestor confirmar. Um código ativo só pode estar em UMA captação.
-- 2) Execução do Plano de Marketing (exclusive_plan_done): por ação escolhida em form_data->'dossie',
--    "feito" + data + quem marcou + prova opcional (foto/print no bucket privado exclusive-captures).
--    Prazo proposto a partir da aprovação: essencial 7 dias, importante 14, complementar 30.
-- 3) Plano alterado depois da aprovação: nada é apagado; o histórico da captação registra a mudança.
-- 4) Painel do gestor (exclusive_feedback_pendencias): sem anúncio após X dias (padrão 7), código salvo que
--    não apareceu na coleta, anúncio de outro ID a confirmar e ações atrasadas.
-- Permissões: as mesmas da captação (exclusive_can_view: captador, líder da equipe, admin; imobiliária isolada).
-- Escrita só por RPC SECURITY DEFINER. Sem DML em dados existentes.
-- Rollback: supabase/rollback/20261009010000_feedback_captacao_plano.sql
BEGIN;

-- Chave de comparação do código: 630601005-114 = 630601005x114 = 630601005XX0114.
CREATE OR REPLACE FUNCTION public.portal_code_key(_code text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN upper(btrim(coalesce(_code, ''))) ~ '^[0-9]{9}(-|X{1,2})[0-9]+$'
    THEN substr(btrim(_code), 1, 9) || '-' ||
         coalesce(nullif(ltrim(substring(upper(btrim(_code)) from '^[0-9]{9}(?:-|X{1,2})([0-9]+)$'), '0'), ''), '0')
    ELSE upper(btrim(coalesce(_code, ''))) END
$$;
GRANT EXECUTE ON FUNCTION public.portal_code_key(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exclusive_plan_prazo_dias(_weight text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE _weight WHEN 'vital' THEN 7 WHEN 'importante' THEN 14 ELSE 30 END
$$;
GRANT EXECUTE ON FUNCTION public.exclusive_plan_prazo_dias(text) TO authenticated, service_role;

-- Data da aprovação (dia, horário de SP); captações antigas sem histórico usam a data de assinatura.
CREATE OR REPLACE FUNCTION public.exclusive_aprovada_em(_id uuid) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(
    (SELECT (max(h.created_at) AT TIME ZONE 'America/Sao_Paulo')::date FROM public.exclusive_history h
      WHERE h.capture_id = _id AND h.action = 'aprovar'),
    (SELECT c.signed_on FROM public.exclusive_captures c WHERE c.id = _id))
$$;
REVOKE ALL ON FUNCTION public.exclusive_aprovada_em(uuid) FROM PUBLIC, anon, authenticated;

-- 1) Ligação captação <-> anúncio -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exclusive_listing_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  capture_id uuid NOT NULL,
  listing_code text NOT NULL CHECK (length(listing_code) BETWEEN 3 AND 60),
  code_key text GENERATED ALWAYS AS (public.portal_code_key(listing_code)) STORED,
  status text NOT NULL CHECK (status IN ('ativo', 'aguardando_gestor', 'recusado', 'encerrado')),
  outro_id boolean NOT NULL DEFAULT false,
  linked_by uuid NOT NULL REFERENCES public.profiles(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.profiles(id),
  decided_at timestamptz,
  ended_by uuid REFERENCES public.profiles(id),
  ended_at timestamptz,
  note text CHECK (note IS NULL OR length(note) <= 500),
  FOREIGN KEY (capture_id, organization_id) REFERENCES public.exclusive_captures (id, organization_id)
);
-- Um código vigente só em uma captação; uma captação com no máximo um anúncio vigente.
CREATE UNIQUE INDEX IF NOT EXISTS exclusive_listing_links_code_uniq ON public.exclusive_listing_links
  (organization_id, code_key) WHERE status IN ('ativo', 'aguardando_gestor');
CREATE UNIQUE INDEX IF NOT EXISTS exclusive_listing_links_capture_uniq ON public.exclusive_listing_links
  (capture_id) WHERE status IN ('ativo', 'aguardando_gestor');
CREATE INDEX IF NOT EXISTS exclusive_listing_links_capture_idx ON public.exclusive_listing_links (capture_id);

-- 2) Execução do Plano de Marketing ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exclusive_plan_done (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  capture_id uuid NOT NULL,
  action_id uuid NOT NULL REFERENCES public.owner_feedback_actions(id),
  done_on date NOT NULL,
  done_by uuid NOT NULL REFERENCES public.profiles(id),
  proof_path text UNIQUE,
  proof_name text CHECK (proof_name IS NULL OR length(proof_name) BETWEEN 1 AND 180),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (capture_id, action_id),
  FOREIGN KEY (capture_id, organization_id) REFERENCES public.exclusive_captures (id, organization_id)
);
CREATE INDEX IF NOT EXISTS exclusive_plan_done_capture_idx ON public.exclusive_plan_done (capture_id);

ALTER TABLE public.exclusive_listing_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exclusive_plan_done ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exclusive_listing_links, public.exclusive_plan_done FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.exclusive_listing_links, public.exclusive_plan_done TO authenticated;
GRANT ALL ON public.exclusive_listing_links, public.exclusive_plan_done TO service_role;

DROP POLICY IF EXISTS org_isolation ON public.exclusive_listing_links;
CREATE POLICY org_isolation ON public.exclusive_listing_links AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
DROP POLICY IF EXISTS org_isolation ON public.exclusive_plan_done;
CREATE POLICY org_isolation ON public.exclusive_plan_done AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
DROP POLICY IF EXISTS exclusive_listing_links_read ON public.exclusive_listing_links;
CREATE POLICY exclusive_listing_links_read ON public.exclusive_listing_links FOR SELECT TO authenticated
  USING (public.exclusive_can_view(capture_id, (SELECT auth.uid())));
DROP POLICY IF EXISTS exclusive_plan_done_read ON public.exclusive_plan_done;
CREATE POLICY exclusive_plan_done_read ON public.exclusive_plan_done FOR SELECT TO authenticated
  USING (public.exclusive_can_view(capture_id, (SELECT auth.uid())));

-- Provas: <org>/<captação>/plano/<uuid>.<jpg|jpeg|png|webp|pdf>, bucket privado. Envia quem vê a captação
-- aprovada; lê quem vê a captação e só arquivo registrado como prova.
DROP POLICY IF EXISTS exclusive_plan_proof_insert ON storage.objects;
CREATE POLICY exclusive_plan_proof_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'exclusive-captures' AND
  CASE WHEN public.mt_1c_relative_path(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/plano/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$'
    THEN public.exclusive_can_view((split_part(public.mt_1c_relative_path(name), '/', 1))::uuid, (SELECT auth.uid()))
      AND EXISTS (SELECT 1 FROM public.exclusive_captures c
        WHERE c.id::text = split_part(public.mt_1c_relative_path(name), '/', 1) AND c.status = 'aprovada'
          AND c.archived_at IS NULL)
    ELSE false END
);
DROP POLICY IF EXISTS exclusive_plan_proof_read ON storage.objects;
CREATE POLICY exclusive_plan_proof_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'exclusive-captures' AND
  CASE WHEN public.mt_1c_relative_path(name) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/plano/'
    THEN public.exclusive_can_view((split_part(public.mt_1c_relative_path(name), '/', 1))::uuid, (SELECT auth.uid()))
      AND EXISTS (SELECT 1 FROM public.exclusive_plan_done d WHERE d.proof_path = name)
    ELSE false END
);

-- Ajudantes -------------------------------------------------------------------------------------------
-- Última coleta em que o código apareceu: portais e números (somente os sem erro).
CREATE OR REPLACE FUNCTION public.exclusive_listing_seen(_org uuid, _key text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH s AS (
    SELECT * FROM public.portal_listing_snapshots
     WHERE organization_id = _org AND public.portal_code_key(listing_code) = _key),
  last AS (SELECT max(collected_on) d FROM s)
  SELECT CASE WHEN (SELECT d FROM last) IS NULL THEN NULL ELSE jsonb_build_object(
    'collected_on', (SELECT d FROM last),
    'listing_code', (SELECT min(listing_code) FROM s WHERE collected_on = (SELECT d FROM last)),
    'portals', (SELECT jsonb_agg(DISTINCT portal) FROM s WHERE collected_on = (SELECT d FROM last)),
    'views', (SELECT sum(views) FROM s WHERE collected_on = (SELECT d FROM last) AND error IS NULL),
    'contacts', (SELECT sum(contacts) FROM s WHERE collected_on = (SELECT d FROM last) AND error IS NULL),
    'remax_id', substr(_key, 1, 9),
    'latest_org', (SELECT max(collected_on) FROM public.portal_listing_snapshots WHERE organization_id = _org)
  ) END
$$;
REVOKE ALL ON FUNCTION public.exclusive_listing_seen(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.exclusive_proxima_segunda() RETURNS date
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT d + (8 - extract(isodow FROM d)::int)
    FROM (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date d) x
$$;
GRANT EXECUTE ON FUNCTION public.exclusive_proxima_segunda() TO authenticated;

-- Contexto da área "Anúncio nos portais": prefixo travado, ligação atual e anúncios do captador sem captação.
CREATE OR REPLACE FUNCTION public.exclusive_listing_context(_capture uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE; _prefix text; _link jsonb; _sug jsonb; _latest date;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _capture;
  IF NOT FOUND OR NOT public.exclusive_can_view(_capture, auth.uid()) THEN
    RAISE EXCEPTION 'Captação não disponível' USING ERRCODE = '42501';
  END IF;
  SELECT remax_id INTO _prefix FROM public.profiles WHERE id = _c.captor_id AND organization_id = _c.organization_id;
  SELECT to_jsonb(x) INTO _link FROM (
    SELECT l.id, l.listing_code, l.status, l.outro_id, l.linked_at, l.decided_at,
           (SELECT nome FROM public.profiles WHERE id = l.linked_by) AS linked_by_nome,
           (SELECT nome FROM public.profiles WHERE id = l.decided_by) AS decided_by_nome,
           public.exclusive_listing_seen(l.organization_id, l.code_key) AS seen
      FROM public.exclusive_listing_links l
     WHERE l.capture_id = _capture
     ORDER BY (l.status IN ('ativo', 'aguardando_gestor')) DESC, coalesce(l.decided_at, l.linked_at) DESC
     LIMIT 1) x;
  SELECT max(collected_on) INTO _latest FROM public.portal_listing_snapshots WHERE organization_id = _c.organization_id;
  IF _prefix IS NOT NULL AND _latest IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(x ORDER BY x.views DESC NULLS LAST, x.code), '[]') INTO _sug FROM (
      SELECT min(s.listing_code) AS code, jsonb_agg(DISTINCT s.portal) AS portals,
             sum(s.views) FILTER (WHERE s.error IS NULL) AS views
        FROM public.portal_listing_snapshots s
       WHERE s.organization_id = _c.organization_id AND s.collected_on = _latest AND s.remax_id = _prefix
         AND NOT EXISTS (SELECT 1 FROM public.exclusive_listing_links l
                          WHERE l.organization_id = s.organization_id AND l.code_key = public.portal_code_key(s.listing_code)
                            AND l.status IN ('ativo', 'aguardando_gestor'))
       GROUP BY public.portal_code_key(s.listing_code)
       LIMIT 30) x;
  END IF;
  RETURN jsonb_build_object('prefix', _prefix, 'link', _link, 'suggestions', coalesce(_sug, '[]'::jsonb),
    'latest_collection', _latest, 'next_monday', public.exclusive_proxima_segunda(),
    'can_link', _c.status = 'aprovada' AND _c.archived_at IS NULL,
    'is_manager', public.exclusive_is_manager(_capture, auth.uid()));
END $$;

-- Confere um código antes de ligar (não grava nada).
CREATE OR REPLACE FUNCTION public.exclusive_listing_check(_capture uuid, _code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE; _prefix text; _key text; _other record; _owner text;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _capture;
  IF NOT FOUND OR NOT public.exclusive_can_view(_capture, auth.uid()) THEN
    RAISE EXCEPTION 'Captação não disponível' USING ERRCODE = '42501';
  END IF;
  IF upper(btrim(coalesce(_code, ''))) !~ '^[0-9]{9}(-|X{1,2})[0-9]{1,6}$' THEN
    RETURN jsonb_build_object('valid', false);
  END IF;
  _key := public.portal_code_key(_code);
  SELECT remax_id INTO _prefix FROM public.profiles WHERE id = _c.captor_id AND organization_id = _c.organization_id;
  SELECT l.capture_id, l.status,
         nullif(concat_ws(' — ', nullif(btrim(c.form_data->'imovel'->>'tipo_imovel'), ''),
                nullif(btrim(c.form_data->'imovel'->>'bairro'), '')), '') AS label,
         public.exclusive_aprovada_em(c.id) AS aprovada_em
    INTO _other
    FROM public.exclusive_listing_links l JOIN public.exclusive_captures c ON c.id = l.capture_id
   WHERE l.organization_id = _c.organization_id AND l.code_key = _key AND l.capture_id <> _capture
     AND l.status IN ('ativo', 'aguardando_gestor');
  SELECT nome INTO _owner FROM public.profiles
   WHERE organization_id = _c.organization_id AND remax_id = substr(_key, 1, 9);
  RETURN jsonb_build_object('valid', true, 'code', _key,
    'own_prefix', _prefix IS NOT NULL AND substr(_key, 1, 9) = _prefix,
    'id_owner_nome', _owner,
    'seen', public.exclusive_listing_seen(_c.organization_id, _key),
    'next_monday', public.exclusive_proxima_segunda(),
    'conflict', CASE WHEN _other.capture_id IS NULL THEN NULL ELSE jsonb_build_object(
      'capture_id', _other.capture_id, 'status', _other.status, 'label', _other.label,
      'aprovada_em', _other.aprovada_em) END);
END $$;

-- Liga (ou troca) o anúncio da captação aprovada.
CREATE OR REPLACE FUNCTION public.exclusive_listing_link(_capture uuid, _code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE; _prefix text; _key text; _code_n text; _seen jsonb;
  _manager boolean; _outro boolean; _status text; _old public.exclusive_listing_links%ROWTYPE;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _capture FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_can_view(_capture, auth.uid()) THEN
    RAISE EXCEPTION 'Captação não disponível' USING ERRCODE = '42501';
  END IF;
  IF _c.status <> 'aprovada' OR _c.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Só captação aprovada pode ser ligada ao anúncio';
  END IF;
  IF upper(btrim(coalesce(_code, ''))) !~ '^[0-9]{9}(-|X{1,2})[0-9]{1,6}$' THEN
    RAISE EXCEPTION 'Código do anúncio inválido (ex.: 630601005-114)';
  END IF;
  _key := public.portal_code_key(_code);
  SELECT remax_id INTO _prefix FROM public.profiles WHERE id = _c.captor_id AND organization_id = _c.organization_id;
  _manager := public.exclusive_is_manager(_capture, auth.uid());
  _outro := _prefix IS NULL OR substr(_key, 1, 9) <> _prefix;
  _status := CASE WHEN _outro AND NOT _manager THEN 'aguardando_gestor' ELSE 'ativo' END;
  IF EXISTS (SELECT 1 FROM public.exclusive_listing_links WHERE organization_id = _c.organization_id
              AND code_key = _key AND capture_id <> _capture AND status IN ('ativo', 'aguardando_gestor')) THEN
    RAISE EXCEPTION 'Este anúncio já está ligado a outra captação. Se for troca, peça ao gestor para mover.';
  END IF;
  -- Usa o código como aparece nos portais quando já foi coletado.
  _seen := public.exclusive_listing_seen(_c.organization_id, _key);
  _code_n := coalesce(_seen->>'listing_code', _key);
  SELECT * INTO _old FROM public.exclusive_listing_links
   WHERE capture_id = _capture AND status IN ('ativo', 'aguardando_gestor') FOR UPDATE;
  IF FOUND THEN
    IF _old.code_key = _key AND (_old.status = _status OR _old.status = 'ativo') THEN RETURN _old.status; END IF;
    UPDATE public.exclusive_listing_links SET status = 'encerrado', ended_by = auth.uid(), ended_at = now(),
      note = 'Trocado por ' || _key WHERE id = _old.id;
  END IF;
  INSERT INTO public.exclusive_listing_links (organization_id, capture_id, listing_code, status, outro_id,
    linked_by, decided_by, decided_at)
  VALUES (_c.organization_id, _capture, _code_n, _status, _outro, auth.uid(),
    CASE WHEN _status = 'ativo' AND _outro THEN auth.uid() END,
    CASE WHEN _status = 'ativo' AND _outro THEN now() END);
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
  VALUES (_capture, auth.uid(), 'anuncio_ligado', _code_n
    || CASE WHEN _status = 'aguardando_gestor' THEN ' (outro ID: aguardando o gestor confirmar)' ELSE '' END
    || CASE WHEN _seen IS NULL THEN ' · ainda não apareceu na coleta' ELSE '' END
    || CASE WHEN _old.id IS NOT NULL THEN ' · substitui ' || _old.listing_code ELSE '' END);
  RETURN _status;
END $$;

-- Gestor confirma ou recusa o anúncio de outro ID.
CREATE OR REPLACE FUNCTION public.exclusive_listing_decide(_link uuid, _approve boolean, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _l public.exclusive_listing_links%ROWTYPE;
BEGIN
  SELECT * INTO _l FROM public.exclusive_listing_links WHERE id = _link FOR UPDATE;
  IF NOT FOUND OR _l.status <> 'aguardando_gestor'
     OR NOT public.exclusive_is_manager(_l.capture_id, auth.uid())
     OR NOT public.exclusive_can_view(_l.capture_id, auth.uid()) THEN
    RAISE EXCEPTION 'Só o gestor da equipe confirma este anúncio' USING ERRCODE = '42501';
  END IF;
  IF NOT _approve AND nullif(btrim(coalesce(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da recusa';
  END IF;
  UPDATE public.exclusive_listing_links
     SET status = CASE WHEN _approve THEN 'ativo' ELSE 'recusado' END, decided_by = auth.uid(), decided_at = now(),
         note = CASE WHEN _approve THEN note ELSE left(btrim(_reason), 500) END
   WHERE id = _link;
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
  VALUES (_l.capture_id, auth.uid(), CASE WHEN _approve THEN 'anuncio_confirmado' ELSE 'anuncio_recusado' END,
    _l.listing_code || CASE WHEN _approve THEN '' ELSE ' · ' || left(btrim(_reason), 300) END);
END $$;

-- Desliga o anúncio (troca de anúncio, erro de digitação). Fica no histórico.
CREATE OR REPLACE FUNCTION public.exclusive_listing_unlink(_capture uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _l public.exclusive_listing_links%ROWTYPE;
BEGIN
  IF NOT public.exclusive_can_view(_capture, auth.uid()) THEN
    RAISE EXCEPTION 'Captação não disponível' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Informe o motivo'; END IF;
  SELECT * INTO _l FROM public.exclusive_listing_links
   WHERE capture_id = _capture AND status IN ('ativo', 'aguardando_gestor') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nenhum anúncio ligado'; END IF;
  -- Anúncio de outro ID já confirmado: só o gestor desfaz.
  IF _l.status = 'ativo' AND _l.outro_id AND NOT public.exclusive_is_manager(_capture, auth.uid()) THEN
    RAISE EXCEPTION 'Peça ao gestor para desligar este anúncio' USING ERRCODE = '42501';
  END IF;
  UPDATE public.exclusive_listing_links SET status = 'encerrado', ended_by = auth.uid(), ended_at = now(),
    note = left(btrim(_reason), 500) WHERE id = _l.id;
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
  VALUES (_capture, auth.uid(), 'anuncio_desligado', _l.listing_code || ' · ' || left(btrim(_reason), 300));
END $$;

-- Plano de Marketing: lista com prazo, feito, quem marcou e prova (inclui ações feitas que saíram do plano).
CREATE OR REPLACE FUNCTION public.exclusive_plan_view(_capture uuid)
RETURNS TABLE(action_id uuid, category text, label text, weight text, sort integer, in_plan boolean,
  prazo date, done_on date, done_by_nome text, proof_path text, proof_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE; _base date;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _capture;
  IF NOT FOUND OR NOT public.exclusive_can_view(_capture, auth.uid()) THEN
    RAISE EXCEPTION 'Captação não disponível' USING ERRCODE = '42501';
  END IF;
  _base := CASE WHEN _c.status = 'aprovada' THEN public.exclusive_aprovada_em(_capture) END;
  RETURN QUERY
  SELECT a.id, a.category, a.label, a.weight, a.sort,
         (_c.form_data->'dossie') ? a.id::text,
         _base + public.exclusive_plan_prazo_dias(a.weight),
         d.done_on, (SELECT p.nome FROM public.profiles p WHERE p.id = d.done_by), d.proof_path, d.proof_name
    FROM public.owner_feedback_actions a
    LEFT JOIN public.exclusive_plan_done d ON d.capture_id = _capture AND d.action_id = a.id
   WHERE a.organization_id = _c.organization_id AND a.list = 'marketing'
     AND (((_c.form_data->'dossie') ? a.id::text) OR d.id IS NOT NULL)
   ORDER BY a.sort;
END $$;

CREATE OR REPLACE FUNCTION public.exclusive_plan_mark(_capture uuid, _action uuid, _done_on date,
  _proof_path text DEFAULT NULL, _proof_name text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c public.exclusive_captures%ROWTYPE; _label text; _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _mime text;
BEGIN
  SELECT * INTO _c FROM public.exclusive_captures WHERE id = _capture FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_can_view(_capture, auth.uid()) THEN
    RAISE EXCEPTION 'Captação não disponível' USING ERRCODE = '42501';
  END IF;
  IF _c.status <> 'aprovada' OR _c.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'O plano é marcado depois da aprovação da captação';
  END IF;
  SELECT a.label INTO _label FROM public.owner_feedback_actions a
   WHERE a.id = _action AND a.organization_id = _c.organization_id AND a.list = 'marketing'
     AND (_c.form_data->'dossie') ? a.id::text;
  IF _label IS NULL THEN RAISE EXCEPTION 'Ação fora do Plano de Marketing desta captação'; END IF;
  IF _done_on IS NULL OR _done_on > _hoje OR _done_on < coalesce(_c.signed_on, _c.created_on_sp) - 30 THEN
    RAISE EXCEPTION 'Data inválida (não pode ser futura)';
  END IF;
  IF _proof_path IS NOT NULL THEN
    IF _proof_path !~ ('^' || _c.organization_id::text || '/' || _capture::text || '/plano/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$')
       OR nullif(btrim(coalesce(_proof_name, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Prova inválida';
    END IF;
    SELECT metadata->>'mimetype' INTO _mime FROM storage.objects
     WHERE bucket_id = 'exclusive-captures' AND name = _proof_path;
    IF NOT FOUND OR _mime NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') THEN
      RAISE EXCEPTION 'Arquivo da prova ausente ou formato inválido';
    END IF;
  END IF;
  INSERT INTO public.exclusive_plan_done (organization_id, capture_id, action_id, done_on, done_by, proof_path, proof_name)
  VALUES (_c.organization_id, _capture, _action, _done_on, auth.uid(), _proof_path, left(btrim(_proof_name), 180))
  ON CONFLICT (capture_id, action_id) DO UPDATE SET done_on = EXCLUDED.done_on, done_by = EXCLUDED.done_by,
    proof_path = coalesce(EXCLUDED.proof_path, public.exclusive_plan_done.proof_path),
    proof_name = CASE WHEN EXCLUDED.proof_path IS NOT NULL THEN EXCLUDED.proof_name
                      ELSE public.exclusive_plan_done.proof_name END;
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
  VALUES (_capture, auth.uid(), 'plano_feito',
    _label || ' · ' || to_char(_done_on, 'DD/MM/YYYY') || CASE WHEN _proof_path IS NOT NULL THEN ' · com prova' ELSE '' END);
END $$;

CREATE OR REPLACE FUNCTION public.exclusive_plan_unmark(_capture uuid, _action uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _d public.exclusive_plan_done%ROWTYPE; _label text;
BEGIN
  IF NOT public.exclusive_can_view(_capture, auth.uid()) THEN
    RAISE EXCEPTION 'Captação não disponível' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.exclusive_plan_done WHERE capture_id = _capture AND action_id = _action RETURNING * INTO _d;
  IF _d.id IS NULL THEN RETURN; END IF;
  SELECT label INTO _label FROM public.owner_feedback_actions WHERE id = _action;
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
  VALUES (_capture, auth.uid(), 'plano_desmarcado', coalesce(_label, 'ação') || ' (marcada em '
    || to_char(_d.done_on, 'DD/MM/YYYY') || ')');
END $$;

-- 3) Plano mudou depois da aprovação: registra no histórico (marcações já feitas ficam guardadas).
CREATE OR REPLACE FUNCTION public.exclusive_plan_change_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _add int; _rem int;
BEGIN
  IF (OLD.form_data->'dossie') IS NOT DISTINCT FROM (NEW.form_data->'dossie') THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.exclusive_history WHERE capture_id = NEW.id AND action = 'aprovar') THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO _add FROM jsonb_array_elements_text(coalesce(NEW.form_data->'dossie', '[]')) n
   WHERE NOT coalesce(OLD.form_data->'dossie', '[]') ? n;
  SELECT count(*) INTO _rem FROM jsonb_array_elements_text(coalesce(OLD.form_data->'dossie', '[]')) o
   WHERE NOT coalesce(NEW.form_data->'dossie', '[]') ? o;
  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
  VALUES (NEW.id, coalesce(auth.uid(), NEW.captor_id), 'plano_alterado',
    format('Plano de Marketing alterado depois da aprovação: +%s / -%s ações (o que já foi feito fica guardado)', _add, _rem));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.exclusive_plan_change_log() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_zz_exclusive_plan_change ON public.exclusive_captures;
CREATE TRIGGER trg_zz_exclusive_plan_change AFTER UPDATE OF form_data ON public.exclusive_captures
  FOR EACH ROW EXECUTE FUNCTION public.exclusive_plan_change_log();

-- 4) Painel do gestor -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exclusive_feedback_pendencias(_dias integer DEFAULT 7)
RETURNS TABLE(kind text, capture_id uuid, imovel text, corretor text, aprovada_em date, dias integer,
  listing_code text, link_id uuid, acao text, prazo date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date; _d int := greatest(1, least(coalesce(_dias, 7), 90));
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['gestor','team_leader','admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Somente gestor, team leader ou admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH caps AS (
    SELECT c.id, c.organization_id, c.form_data, public.exclusive_aprovada_em(c.id) AS ap,
      nullif(concat_ws(' — ', nullif(btrim(c.form_data->'imovel'->>'tipo_imovel'), ''),
        nullif(btrim(c.form_data->'imovel'->>'bairro'), '')), '') AS imovel,
      (SELECT p.nome FROM public.profiles p WHERE p.id = c.captor_id) AS corretor
      FROM public.exclusive_captures c
     WHERE c.organization_id = public.current_org_id() AND c.status = 'aprovada'
       AND c.archived_at IS NULL AND c.discarded_at IS NULL
       AND public.exclusive_is_manager(c.id, auth.uid()) AND public.exclusive_can_view(c.id, auth.uid())),
  lk AS (
    SELECT l.* FROM public.exclusive_listing_links l JOIN caps ON caps.id = l.capture_id
     WHERE l.status IN ('ativo', 'aguardando_gestor'))
  SELECT 'sem_anuncio', caps.id, caps.imovel, caps.corretor, caps.ap, (_hoje - caps.ap), NULL::text, NULL::uuid,
         NULL::text, NULL::date
    FROM caps WHERE NOT EXISTS (SELECT 1 FROM lk WHERE lk.capture_id = caps.id) AND _hoje - caps.ap > _d
  UNION ALL
  SELECT 'nao_coletado', caps.id, caps.imovel, caps.corretor, caps.ap,
         (_hoje - (lk.linked_at AT TIME ZONE 'America/Sao_Paulo')::date), lk.listing_code, lk.id, NULL, NULL
    FROM caps JOIN lk ON lk.capture_id = caps.id
   WHERE _hoje - (lk.linked_at AT TIME ZONE 'America/Sao_Paulo')::date > _d
     AND public.exclusive_listing_seen(caps.organization_id, lk.code_key) IS NULL
  UNION ALL
  SELECT 'confirmar', caps.id, caps.imovel, caps.corretor, caps.ap, NULL, lk.listing_code, lk.id,
         (SELECT p.nome FROM public.profiles p WHERE p.organization_id = caps.organization_id
            AND p.remax_id = substr(lk.code_key, 1, 9)), NULL
    FROM caps JOIN lk ON lk.capture_id = caps.id WHERE lk.status = 'aguardando_gestor'
  UNION ALL
  SELECT 'atrasada', caps.id, caps.imovel, caps.corretor, caps.ap,
         (_hoje - (caps.ap + public.exclusive_plan_prazo_dias(a.weight))), NULL, NULL, a.label,
         caps.ap + public.exclusive_plan_prazo_dias(a.weight)
    FROM caps JOIN public.owner_feedback_actions a
      ON a.organization_id = caps.organization_id AND a.list = 'marketing' AND (caps.form_data->'dossie') ? a.id::text
   WHERE caps.ap + public.exclusive_plan_prazo_dias(a.weight) < _hoje
     AND NOT EXISTS (SELECT 1 FROM public.exclusive_plan_done d WHERE d.capture_id = caps.id AND d.action_id = a.id);
END $$;

-- Feedback: captação ligada ao código (só para quem vê a captação).
CREATE OR REPLACE FUNCTION public.owner_feedback_captacao(_code text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT to_jsonb(x) FROM (
    SELECT l.capture_id, l.status AS link_status, l.listing_code,
      nullif(btrim(c.form_data->'imovel'->>'tipo_imovel'), '') AS tipo,
      nullif(btrim(c.form_data->'imovel'->>'bairro'), '') AS bairro,
      nullif(btrim(c.form_data->'proprietario_1'->>'nome_completo'), '') AS proprietario,
      c.broker_creci AS creci, c.broker_name AS corretor
      FROM public.exclusive_listing_links l JOIN public.exclusive_captures c ON c.id = l.capture_id
     WHERE l.organization_id = public.current_org_id() AND l.code_key = public.portal_code_key(_code)
       AND l.status IN ('ativo', 'aguardando_gestor') AND c.discarded_at IS NULL
       AND public.exclusive_can_view(c.id, auth.uid())
     LIMIT 1) x
$$;

-- Permissões das RPCs
DO $$
DECLARE _f text;
BEGIN
  FOREACH _f IN ARRAY ARRAY[
    'public.exclusive_listing_context(uuid)', 'public.exclusive_listing_check(uuid, text)',
    'public.exclusive_listing_link(uuid, text)', 'public.exclusive_listing_decide(uuid, boolean, text)',
    'public.exclusive_listing_unlink(uuid, text)', 'public.exclusive_plan_view(uuid)',
    'public.exclusive_plan_mark(uuid, uuid, date, text, text)', 'public.exclusive_plan_unmark(uuid, uuid)',
    'public.exclusive_feedback_pendencias(integer)', 'public.owner_feedback_captacao(text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', _f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', _f);
  END LOOP;
END $$;

COMMIT;
