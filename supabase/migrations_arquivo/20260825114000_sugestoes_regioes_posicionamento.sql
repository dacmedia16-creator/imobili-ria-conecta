BEGIN;

CREATE TABLE public.positioning_region_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suggested_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cidade text NOT NULL,
  zona text,
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('bairro', 'condominio', 'cidade', 'grupo')),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'rejeitada')),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  region_id bigint REFERENCES public.positioning_regions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_positioning_region_suggestions_status
  ON public.positioning_region_suggestions(status, created_at DESC);

ALTER TABLE public.positioning_region_suggestions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.positioning_region_suggestions TO authenticated;
GRANT ALL ON public.positioning_region_suggestions TO service_role;

CREATE POLICY positioning_suggestions_select
  ON public.positioning_region_suggestions FOR SELECT TO authenticated
  USING (
    suggested_by = (SELECT auth.uid())
    OR public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::public.app_role[])
  );

CREATE OR REPLACE FUNCTION public.submit_positioning_region_suggestion(
  _cidade text,
  _zona text,
  _nome text,
  _tipo text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user uuid := auth.uid();
  _id uuid;
BEGIN
  IF _user IS NULL OR NOT public.is_active_user(_user)
    OR NOT public.has_role(_user, 'corretor'::public.app_role) THEN
    RAISE EXCEPTION 'Apenas corretores ativos podem sugerir regioes.';
  END IF;
  IF length(trim(coalesce(_cidade, ''))) < 2 OR length(trim(coalesce(_cidade, ''))) > 80
    OR length(trim(coalesce(_nome, ''))) < 2 OR length(trim(coalesce(_nome, ''))) > 120 THEN
    RAISE EXCEPTION 'Preencha cidade e nome da regiao corretamente.';
  END IF;
  IF _tipo NOT IN ('bairro', 'condominio', 'cidade', 'grupo') THEN
    RAISE EXCEPTION 'Tipo de regiao invalido.';
  END IF;
  IF (SELECT count(*) FROM public.positioning_region_suggestions
      WHERE suggested_by = _user AND status = 'pendente') >= 5 THEN
    RAISE EXCEPTION 'Voce ja possui 5 sugestoes pendentes.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.positioning_regions r
    WHERE lower(trim(r.cidade)) = lower(trim(_cidade))
      AND lower(trim(r.nome)) = lower(trim(_nome))
      AND r.ativo
  ) THEN
    RAISE EXCEPTION 'Essa regiao ja esta disponivel no catalogo.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.positioning_region_suggestions s
    WHERE s.status = 'pendente'
      AND lower(trim(s.cidade)) = lower(trim(_cidade))
      AND lower(trim(s.nome)) = lower(trim(_nome))
  ) THEN
    RAISE EXCEPTION 'Essa regiao ja foi sugerida e aguarda analise.';
  END IF;

  INSERT INTO public.positioning_region_suggestions (suggested_by, cidade, zona, nome, tipo)
  VALUES (_user, trim(_cidade), nullif(trim(coalesce(_zona, '')), ''), trim(_nome), _tipo)
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_positioning_region_suggestion(
  _suggestion_id uuid,
  _decision text,
  _cidade text DEFAULT NULL,
  _zona text DEFAULT NULL,
  _nome text DEFAULT NULL,
  _tipo text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user uuid := auth.uid();
  _suggestion public.positioning_region_suggestions%ROWTYPE;
  _region_id bigint;
  _final_cidade text;
  _final_nome text;
  _final_tipo text;
BEGIN
  IF _user IS NULL OR NOT public.is_active_user(_user)
    OR NOT public.has_any_role(_user, ARRAY['admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Apenas administradores podem analisar sugestoes.';
  END IF;
  IF _decision NOT IN ('aprovar', 'rejeitar') THEN RAISE EXCEPTION 'Decisao invalida.'; END IF;

  SELECT * INTO _suggestion FROM public.positioning_region_suggestions
  WHERE id = _suggestion_id FOR UPDATE;
  IF NOT FOUND OR _suggestion.status <> 'pendente' THEN
    RAISE EXCEPTION 'Sugestao nao encontrada ou ja analisada.';
  END IF;

  IF _decision = 'rejeitar' THEN
    UPDATE public.positioning_region_suggestions
    SET status = 'rejeitada', reviewed_by = _user, reviewed_at = now()
    WHERE id = _suggestion_id;
    RETURN NULL;
  END IF;

  _final_cidade := trim(coalesce(nullif(_cidade, ''), _suggestion.cidade));
  _final_nome := trim(coalesce(nullif(_nome, ''), _suggestion.nome));
  _final_tipo := coalesce(nullif(_tipo, ''), _suggestion.tipo);
  IF length(_final_cidade) < 2 OR length(_final_nome) < 2
    OR _final_tipo NOT IN ('bairro', 'condominio', 'cidade', 'grupo') THEN
    RAISE EXCEPTION 'Dados finais da regiao invalidos.';
  END IF;

  INSERT INTO public.positioning_regions (cidade, zona, nome, tipo)
  VALUES (_final_cidade, nullif(trim(coalesce(_zona, _suggestion.zona, '')), ''), _final_nome, _final_tipo)
  ON CONFLICT (cidade, nome, tipo) DO UPDATE SET ativo = true, zona = EXCLUDED.zona
  RETURNING id INTO _region_id;

  UPDATE public.positioning_region_suggestions
  SET status = 'aprovada', reviewed_by = _user, reviewed_at = now(), region_id = _region_id,
      cidade = _final_cidade, zona = nullif(trim(coalesce(_zona, _suggestion.zona, '')), ''),
      nome = _final_nome, tipo = _final_tipo
  WHERE id = _suggestion_id;
  RETURN _region_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_positioning_region_suggestion(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_positioning_region_suggestion(uuid,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_positioning_region_suggestion(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_positioning_region_suggestion(uuid,text,text,text,text,text) TO authenticated;

COMMIT;
