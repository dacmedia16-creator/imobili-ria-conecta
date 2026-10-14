-- Módulo "Oportunidades" (maquete aprovada por Denis em 14/10/2026, cards t_d8385376 / t_a23144bb).
-- Mural com os pedidos/ofertas do grupo de WhatsApp da imobiliária + encaixe com as captações aprovadas.
-- Liga/desliga por imobiliária (super-admin). Começa DESLIGADO em todas.
-- Desligado: menu some, rota bloqueia, o banco não entrega nada e a ingestão não grava.
-- Guarda só o nome do corretor e o texto limpo (sem telefone, e-mail, link ou senha).

-- 1) Módulo -----------------------------------------------------------------------------------
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades')
     OR _enabled IS NULL THEN
    RAISE EXCEPTION 'Modulo invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN
    RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT enabled INTO _current FROM public.organization_modules
    WHERE organization_id = _org AND module = _module FOR UPDATE;
  IF _current IS NOT DISTINCT FROM _enabled THEN RETURN _enabled; END IF;
  INSERT INTO public.organization_modules (organization_id, module, enabled, updated_at, updated_by)
  VALUES (_org, _module, _enabled, now(), _actor)
  ON CONFLICT (organization_id, module)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by = _actor;
  INSERT INTO public.organization_module_history (organization_id, module, enabled, actor_id)
  VALUES (_org, _module, _enabled, _actor);
  RETURN _enabled;
END $$;

CREATE OR REPLACE FUNCTION public.opportunities_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT enabled FROM public.organization_modules
    WHERE organization_id = public.current_org_id() AND module = 'oportunidades'), false)
$$;
REVOKE ALL ON FUNCTION public.opportunities_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opportunities_enabled() TO authenticated, service_role;

INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o.id, 'oportunidades', false FROM public.organizations o
ON CONFLICT (organization_id, module) DO NOTHING;

-- 2) Tabelas ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.opportunity_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  -- hash (corretor + texto): repostagem do mesmo anúncio não duplica, só atualiza a data
  source_key text NOT NULL CHECK (source_key ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK (kind IN ('procura', 'oferta', 'outros')),
  tipo text CHECK (tipo IN ('Apartamento', 'Casa', 'Terreno', 'Comercial', 'Rural')),
  finalidade text CHECK (finalidade IN ('Venda', 'Locação')),
  bairro text CHECK (char_length(bairro) <= 120),
  valor_min numeric(14,2) CHECK (valor_min >= 0),
  valor_max numeric(14,2) CHECK (valor_max >= 0),
  valor numeric(14,2) CHECK (valor >= 0),
  corretor text NOT NULL CHECK (char_length(corretor) BETWEEN 1 AND 80),
  texto text NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 4000),
  posted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_key)
);
CREATE INDEX IF NOT EXISTS opportunity_posts_org_posted_idx ON public.opportunity_posts (organization_id, posted_at DESC);

-- "Não encaixa": oculta o par para toda a imobiliária (target = outro post ou captação).
CREATE TABLE IF NOT EXISTS public.opportunity_hidden_pairs (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  post_id uuid NOT NULL REFERENCES public.opportunity_posts(id) ON DELETE CASCADE,
  target_id uuid NOT NULL,
  hidden_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, post_id, target_id)
);

-- Alertas de WhatsApp (procura × captação). 'dry_run' = só registrado, nada enviado.
CREATE TABLE IF NOT EXISTS public.opportunity_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  post_id uuid NOT NULL REFERENCES public.opportunity_posts(id) ON DELETE CASCADE,
  capture_id uuid NOT NULL REFERENCES public.exclusive_captures(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES public.profiles(id),
  status text NOT NULL CHECK (status IN ('dry_run', 'sent', 'failed', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- No máximo 1 alerta real por procura + captação.
CREATE UNIQUE INDEX IF NOT EXISTS opportunity_alerts_um_por_par
  ON public.opportunity_alerts (post_id, capture_id) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS opportunity_alerts_recipient_idx ON public.opportunity_alerts (recipient_id, created_at);

-- 3) Acesso -----------------------------------------------------------------------------------
ALTER TABLE public.opportunity_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_hidden_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.opportunity_posts, public.opportunity_hidden_pairs, public.opportunity_alerts FROM anon, authenticated;
GRANT SELECT ON public.opportunity_posts TO authenticated;
GRANT SELECT, INSERT ON public.opportunity_hidden_pairs TO authenticated;
-- opportunity_alerts: só o servidor (service_role).

CREATE POLICY org_isolation ON public.opportunity_posts AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
CREATE POLICY org_isolation ON public.opportunity_hidden_pairs AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
CREATE POLICY zz_mt_modulo_oportunidades ON public.opportunity_posts AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.opportunities_enabled())) WITH CHECK ((SELECT public.opportunities_enabled()));
CREATE POLICY zz_mt_modulo_oportunidades ON public.opportunity_hidden_pairs AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.opportunities_enabled())) WITH CHECK ((SELECT public.opportunities_enabled()));

-- O mural é da imobiliária inteira: qualquer membro lê (o conteúdo já é público no grupo).
CREATE POLICY opportunity_posts_read ON public.opportunity_posts FOR SELECT TO authenticated USING (true);
CREATE POLICY opportunity_hidden_read ON public.opportunity_hidden_pairs FOR SELECT TO authenticated USING (true);
CREATE POLICY opportunity_hidden_insert ON public.opportunity_hidden_pairs FOR INSERT TO authenticated
  WITH CHECK (hidden_by = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.opportunity_posts p WHERE p.id = post_id AND p.organization_id = opportunity_hidden_pairs.organization_id));

-- 4) Encaixe com captações: só os campos do encaixe (sem endereço, proprietário ou documentos).
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
$$;
REVOKE ALL ON FUNCTION public.opportunity_capture_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opportunity_capture_candidates() TO authenticated, service_role;

-- 5) Ingestão (só servidor/VPS com service_role). Repete a limpeza de dados pessoais como defesa extra.
CREATE OR REPLACE FUNCTION public.opportunity_clean_text(_t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(coalesce(_t, ''), '\m(senhas?|password|passwd|pass|pwd|pin|token)\M\s*[:=]\s*\S+', '[senha oculta]', 'gi'),
        'https?://\S+|www\.\S+', '', 'gi'),
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '', 'g'),
    '(\+?55\s*)?\(?\d{2}\)?\s*9?\s*\d{4}[\s.-]?\d{4}', '[número oculto]', 'g'))
$$;

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
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.opportunity_ingest(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.opportunity_ingest(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.opportunity_clean_text(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.opportunity_clean_text(text) TO service_role;
