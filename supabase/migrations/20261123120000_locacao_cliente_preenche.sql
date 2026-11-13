-- Locação: convite individual para preenchimento pelo cliente (t_6fafa9be).
-- Nenhum token em claro persiste; as tabelas ficam fechadas a anon/authenticated.
BEGIN;
CREATE TABLE public.locacao_link_modos (
  locacao_id uuid PRIMARY KEY REFERENCES public.locacoes(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  modo text NOT NULL CHECK (modo IN ('corretor', 'cliente')),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.locacao_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locacao_id uuid NOT NULL REFERENCES public.locacoes(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parte text NOT NULL CHECK (parte IN ('locatario', 'proprietario', 'fiador')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expira_em timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'nao_aberto' CHECK (status IN ('nao_aberto', 'em_preenchimento', 'enviado')),
  dados jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dados) = 'object'),
  enviado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (locacao_id, parte)
);
CREATE TABLE public.locacao_link_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.locacao_links(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item text NOT NULL CHECK (length(item) BETWEEN 1 AND 200),
  path text NOT NULL UNIQUE,
  nome text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  registrado_em timestamptz
);
CREATE INDEX locacao_link_arquivos_link_idx ON public.locacao_link_arquivos(link_id);
CREATE TABLE public.locacao_link_tentativas (
  ip_hash text NOT NULL CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  janela timestamptz NOT NULL,
  quantidade integer NOT NULL,
  PRIMARY KEY (ip_hash, janela)
);
CREATE INDEX locacao_link_tentativas_janela_idx ON public.locacao_link_tentativas(janela);
ALTER TABLE public.locacao_link_modos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_link_arquivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_link_tentativas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locacao_link_modos, public.locacao_links, public.locacao_link_arquivos, public.locacao_link_tentativas FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.locacao_links_modo(_id uuid, _modo text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id);
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao'], 'corretor');
  IF _modo NOT IN ('corretor', 'cliente') OR _modo IS NULL THEN RAISE EXCEPTION 'Modo inválido' USING ERRCODE = '22023'; END IF;
  PERFORM 1 FROM public.locacoes WHERE id = _id FOR UPDATE;
  INSERT INTO public.locacao_link_modos(locacao_id, organization_id, modo) VALUES (_l.id, _l.organization_id, _modo)
  ON CONFLICT(locacao_id) DO UPDATE SET modo = EXCLUDED.modo, atualizado_em = now();
  IF _modo = 'corretor' THEN DELETE FROM public.locacao_links WHERE locacao_id = _id; END IF;
  PERFORM public.locacao_docs_situacao(_id);
  RETURN true;
END $$;

CREATE FUNCTION public.locacao_links_lista(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id);
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao'], 'corretor');
  RETURN jsonb_build_object('modo', coalesce((SELECT modo FROM public.locacao_link_modos WHERE locacao_id = _id), 'corretor'),
    'links', (SELECT coalesce(jsonb_agg(jsonb_build_object('parte', parte, 'status', status,
      'expira_em', expira_em, 'enviado_em', enviado_em, 'dados', dados,
      'arquivos', (SELECT coalesce(jsonb_agg(jsonb_build_object('item', a.item, 'nome', a.nome)), '[]'::jsonb)
        FROM public.locacao_link_arquivos a WHERE a.link_id = k.id AND a.registrado_em IS NOT NULL)) ORDER BY parte), '[]'::jsonb)
      FROM public.locacao_links k WHERE locacao_id = _id));
END $$;

CREATE FUNCTION public.locacao_links_emitir(_id uuid, _parte text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _exp timestamptz; _token text;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao'], 'corretor');
  IF (SELECT modo FROM public.locacao_link_modos WHERE locacao_id = _id) IS DISTINCT FROM 'cliente'
    OR _parte IS NULL OR _parte NOT IN ('locatario', 'proprietario', 'fiador')
    OR (_parte = 'fiador' AND _l.garantia <> 'fiador') THEN
    RAISE EXCEPTION 'Convite inválido' USING ERRCODE = '22023';
  END IF;
  -- Um link por parte, geração substitui o antigo; serializado pela linha da locação.
  PERFORM 1 FROM public.locacoes WHERE id = _id FOR UPDATE;
  DELETE FROM public.locacao_links WHERE locacao_id = _id AND parte = _parte;
  _exp := now() + interval '7 days';
  _token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.locacao_links(locacao_id, organization_id, parte, token_hash, expira_em)
  VALUES (_id, _l.organization_id, _parte, encode(extensions.digest(_token, 'sha256'), 'hex'), _exp);
  RETURN jsonb_build_object('token', _token, 'expira_em', _exp);
END $$;

-- Funções públicas são chamadas SOMENTE pela server function com service_role.
-- Uma tentativa inválida também consome o limite; erros da aplicação retornam JSON, sem desfazer o contador.
CREATE FUNCTION public.locacao_link_validar(_token text, _ip_hash text, _escrita boolean DEFAULT false)
RETURNS public.locacao_links LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _k public.locacao_links; _n integer; _l public.locacoes;
BEGIN
  IF _ip_hash IS NULL OR _ip_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  INSERT INTO public.locacao_link_tentativas(ip_hash, janela, quantidade)
  VALUES (_ip_hash, date_trunc('minute', now()), 1)
  ON CONFLICT(ip_hash, janela) DO UPDATE SET quantidade = public.locacao_link_tentativas.quantidade + 1
  RETURNING quantidade INTO _n;
  IF _n > 120 OR _token IS NULL OR _token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  -- Amostragem: evita crescimento ilimitado da tabela de rate limit sem cron externo.
  IF random() < 0.02 THEN
    DELETE FROM public.locacao_link_tentativas WHERE janela < now() - interval '1 day';
  END IF;
  SELECT * INTO _k FROM public.locacao_links WHERE token_hash = encode(extensions.digest(_token, 'sha256'), 'hex');
  IF _k.id IS NULL OR _k.expira_em <= now() OR (_escrita AND _k.status = 'enviado') THEN RETURN NULL; END IF;
  SELECT * INTO _l FROM public.locacoes WHERE id = _k.locacao_id AND organization_id = _k.organization_id;
  IF _escrita AND _l.id IS NOT NULL THEN
    -- Mesma ordem de travas do corretor (locação → convite): reemissão/envio não se cruzam.
    PERFORM 1 FROM public.locacoes WHERE id = _l.id FOR UPDATE;
    SELECT * INTO _k FROM public.locacao_links WHERE id = _k.id
      AND token_hash = encode(extensions.digest(_token, 'sha256'), 'hex') FOR UPDATE;
    IF _k.id IS NULL OR _k.status = 'enviado' OR _k.expira_em <= now() THEN RETURN NULL; END IF;
  END IF;
  IF _l.id IS NULL OR _l.situacao <> 'ativa' OR _l.etapa <> 'documentacao'
    OR NOT EXISTS (SELECT 1 FROM public.organizations o JOIN public.organization_modules m ON m.organization_id = o.id
      WHERE o.id = _k.organization_id AND o.status = 'ativa' AND m.module = 'locacao' AND m.enabled)
    OR (SELECT modo FROM public.locacao_link_modos WHERE locacao_id = _l.id) IS DISTINCT FROM 'cliente'
    OR (_k.parte = 'fiador' AND _l.garantia <> 'fiador') THEN RETURN NULL; END IF;
  RETURN _k;
END $$;

CREATE FUNCTION public.locacao_link_ler(_token text, _ip_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _k public.locacao_links; _l public.locacoes;
BEGIN
  _k := public.locacao_link_validar(_token, _ip_hash);
  IF _k.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT * INTO _l FROM public.locacoes WHERE id = _k.locacao_id AND organization_id = _k.organization_id;
  -- Não devolver valores financeiros, outras partes ou dados internos. Nem mesmo a ficha completa.
  RETURN jsonb_build_object('ok', true, 'parte', _k.parte,
    'pessoa', coalesce(_l.ficha->>(_k.parte || '_pessoa'), 'pf'), 'status', _k.status,
    'dados', _k.dados, 'expira_em', _k.expira_em,
    'itens', (SELECT coalesce(jsonb_agg(jsonb_build_object('item', x.i,
      'enviado', EXISTS (SELECT 1 FROM public.locacao_link_arquivos a WHERE a.link_id = _k.id
        AND a.item = x.i AND a.registrado_em IS NOT NULL)) ORDER BY x.n), '[]'::jsonb)
      FROM unnest(public.locacao_docs_grupo(_k.organization_id,
        CASE WHEN _l.ficha->>(_k.parte || '_pessoa') = 'pj' THEN _k.parte || '_pj' ELSE _k.parte END))
        WITH ORDINALITY x(i, n)));
END $$;

CREATE FUNCTION public.locacao_link_salvar(_token text, _ip_hash text, _dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _k public.locacao_links; _e record; _v text; _limite text;
BEGIN
  _k := public.locacao_link_validar(_token, _ip_hash, true);
  IF _k.id IS NULL OR _dados IS NULL OR jsonb_typeof(_dados) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(_dados)) > 40 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  _limite := CASE _k.parte WHEN 'locatario' THEN '^(loc_|loc_conj_)'
    WHEN 'proprietario' THEN '^(prop_|prop_conj_)' ELSE '^(fia_|fia_conj_)' END;
  FOR _e IN SELECT key, value FROM jsonb_each(_dados) LOOP
    IF _e.key !~ _limite OR NOT (_e.key = ANY(public.locacao_contrato_chaves()))
      OR jsonb_typeof(_e.value) <> 'string' THEN RETURN jsonb_build_object('ok', false); END IF;
    _v := btrim(_e.value #>> '{}');
    IF NOT public.locacao_contrato_valor_ok(_e.key, _v) THEN RETURN jsonb_build_object('ok', false); END IF;
  END LOOP;
  UPDATE public.locacao_links SET dados = dados || _dados, status = 'em_preenchimento'
    WHERE id = _k.id AND status <> 'enviado';
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE FUNCTION public.locacao_link_preparar(_token text, _ip_hash text, _item text, _ext text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _k public.locacao_links; _l public.locacoes; _path text;
BEGIN
  _k := public.locacao_link_validar(_token, _ip_hash, true);
  IF _k.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT * INTO _l FROM public.locacoes WHERE id = _k.locacao_id;
  IF _ext IS NULL OR _ext NOT IN ('pdf','jpg','jpeg','png','webp') OR _item IS NULL
    OR NOT (_item = ANY(public.locacao_docs_grupo(_k.organization_id,
      CASE WHEN _l.ficha->>(_k.parte || '_pessoa') = 'pj' THEN _k.parte || '_pj' ELSE _k.parte END)))
    OR (SELECT count(*) FROM public.locacao_link_arquivos WHERE link_id = _k.id) >= 30 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  _path := _k.organization_id::text || '/' || _k.locacao_id::text || '/' || _k.parte || '/' || gen_random_uuid()::text || '.' || _ext;
  INSERT INTO public.locacao_link_arquivos(link_id, organization_id, item, path) VALUES (_k.id, _k.organization_id, _item, _path);
  UPDATE public.locacao_links SET status = 'em_preenchimento' WHERE id = _k.id;
  RETURN jsonb_build_object('ok', true, 'path', _path);
END $$;

CREATE FUNCTION public.locacao_link_registrar(_token text, _ip_hash text, _path text, _nome text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _k public.locacao_links;
BEGIN
  _k := public.locacao_link_validar(_token, _ip_hash, true);
  IF _k.id IS NULL OR _nome IS NULL OR length(btrim(_nome)) NOT BETWEEN 1 AND 200
    OR NOT EXISTS (SELECT 1 FROM public.locacao_link_arquivos a JOIN storage.objects o
      ON o.bucket_id = 'locacao-documentos' AND o.name = a.path
      WHERE a.link_id = _k.id AND a.path = _path AND a.registrado_em IS NULL AND a.criado_em > now() - interval '2 hours') THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  UPDATE public.locacao_link_arquivos SET nome = _nome, registrado_em = now()
    WHERE link_id = _k.id AND path = _path AND registrado_em IS NULL;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE FUNCTION public.locacao_link_enviar(_token text, _ip_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _k public.locacao_links; _l public.locacoes; _e record; _val jsonb; _ori jsonb;
BEGIN
  _k := public.locacao_link_validar(_token, _ip_hash, true);
  IF _k.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT * INTO _l FROM public.locacoes WHERE id = _k.locacao_id AND organization_id = _k.organization_id FOR UPDATE;
  -- A reemissão pode ter ocorrido após a primeira validação. Trava e confere outra vez.
  SELECT * INTO _k FROM public.locacao_links WHERE id = _k.id FOR UPDATE;
  IF _k.id IS NULL OR _k.status = 'enviado' OR _k.expira_em <= now() THEN RETURN jsonb_build_object('ok', false); END IF;
  INSERT INTO public.locacao_contrato_dados(locacao_id, organization_id) VALUES (_l.id, _l.organization_id)
    ON CONFLICT (locacao_id) DO NOTHING;
  SELECT valores, origem INTO _val, _ori FROM public.locacao_contrato_dados WHERE locacao_id = _l.id FOR UPDATE;
  FOR _e IN SELECT key, value FROM jsonb_each(_k.dados) LOOP
    IF coalesce(_val->>_e.key, '') = '' THEN
      _val := _val || jsonb_build_object(_e.key, _e.value);
      _ori := _ori || jsonb_build_object(_e.key, jsonb_build_object('o', 'manual'));
    END IF;
  END LOOP;
  UPDATE public.locacao_contrato_dados SET valores = _val, origem = _ori, atualizado_em = now()
    WHERE locacao_id = _l.id;
  INSERT INTO public.locacao_documentos(organization_id, locacao_id, item, storage_path, nome_arquivo)
    SELECT _l.organization_id, _l.id, a.item, a.path, a.nome FROM public.locacao_link_arquivos a
    WHERE a.link_id = _k.id AND a.registrado_em IS NOT NULL;
  UPDATE public.locacao_links SET status = 'enviado', enviado_em = now() WHERE id = _k.id;
  PERFORM public.locacao_docs_situacao(_l.id);
  RETURN jsonb_build_object('ok', true);
END $$;

-- Enquanto o cliente preenche, a data só é liberada quando o corretor envia à conferência.
CREATE OR REPLACE FUNCTION public.locacao_docs_completos_em(_l public.locacoes) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.locacao_link_modos m WHERE m.locacao_id = _l.id AND m.modo = 'cliente')
    THEN CASE WHEN _l.etapa <> 'documentacao' AND cardinality(public.locacao_docs_faltando(_l)) = 0
      THEN coalesce(_l.docs_completos_em, now()) END
    ELSE CASE WHEN cardinality(public.locacao_docs_faltando(_l)) = 0 THEN coalesce(
    (SELECT max(primeiro) FROM (SELECT min(d.enviado_em) AS primeiro FROM public.locacao_documentos d
      WHERE d.locacao_id = _l.id AND d.removido_em IS NULL AND NOT public.locacao_doc_opcional(d.item)
        AND d.item = ANY (public.locacao_checklist_l(_l)) GROUP BY d.item) s),
    _l.docs_completos_em, _l.criado_em) END END
$$;

CREATE OR REPLACE FUNCTION public.locacao_enviar_documentacao(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _f text[]; _parte text;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao'], 'corretor');
  IF EXISTS (SELECT 1 FROM public.locacao_link_modos WHERE locacao_id = _id AND modo = 'cliente') THEN
    FOR _parte IN SELECT unnest(CASE WHEN _l.garantia = 'fiador' THEN ARRAY['locatario','proprietario','fiador']
      ELSE ARRAY['locatario','proprietario'] END) LOOP
      IF NOT EXISTS (SELECT 1 FROM public.locacao_links WHERE locacao_id = _id AND parte = _parte AND status = 'enviado') THEN
        RAISE EXCEPTION 'Aguarde o envio de todas as partes.' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
  _f := public.locacao_docs_faltando(_l);
  IF cardinality(_f) > 0 THEN
    RAISE EXCEPTION 'Faltam % documento(s): %', cardinality(_f), array_to_string(_f, '; ') USING ERRCODE = '22023';
  END IF;
  _l := public.locacao_mover(_id, 'conferencia', false, NULL);
  PERFORM public.locacao_docs_situacao(_id);
  PERFORM public.locacao_evento(_l, 'corretor', 'Documentação completa enviada para conferência');
  RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
END $$;

REVOKE ALL ON FUNCTION public.locacao_links_modo(uuid,text), public.locacao_links_lista(uuid),
  public.locacao_links_emitir(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_links_modo(uuid,text), public.locacao_links_lista(uuid),
  public.locacao_links_emitir(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.locacao_link_validar(text,text,boolean), public.locacao_link_ler(text,text),
  public.locacao_link_salvar(text,text,jsonb), public.locacao_link_preparar(text,text,text,text),
  public.locacao_link_registrar(text,text,text,text), public.locacao_link_enviar(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.locacao_link_validar(text,text,boolean), public.locacao_link_ler(text,text),
  public.locacao_link_salvar(text,text,jsonb), public.locacao_link_preparar(text,text,text,text),
  public.locacao_link_registrar(text,text,text,text), public.locacao_link_enviar(text,text) TO service_role;
-- Detalhe também só marca completa após a confirmação do corretor.
CREATE OR REPLACE FUNCTION public.locacao_detalhe(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _l public.locacoes; _f text[];
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id AND organization_id = _org;
  IF _l.id IS NULL OR NOT public.locacao_pode_ver(_l) THEN
    RAISE EXCEPTION 'Sem acesso a esta locação.' USING ERRCODE = '42501';
  END IF;
  _f := public.locacao_docs_faltando(_l);
  RETURN public.locacao_json(_l) || jsonb_build_object(
    'checklist', to_jsonb(public.locacao_checklist_l(_l)),
    'faltando', to_jsonb(_f),
    'partes', public.locacao_partes_json(_l),
    'docs_completa', public.locacao_docs_completos_em(_l) IS NOT NULL,
    'docs_completos_em', public.locacao_docs_completos_em(_l),
    'captador_nome', (SELECT p.nome FROM public.profiles p WHERE p.id = _l.captador_id),
    'documentos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'item', d.item, 'nome_arquivo', d.nome_arquivo,
        'enviado_em', d.enviado_em, 'leitura', lr.status, 'leitura_erro', lr.erro, 'leitura_em', lr.atualizado_em,
        'preenchidos', lr.preenchidos) ORDER BY d.enviado_em), '[]')
        FROM public.locacao_documentos d LEFT JOIN public.locacao_doc_leituras lr ON lr.documento_id = d.id
       WHERE d.locacao_id = _l.id AND d.removido_em IS NULL),
    'contrato', jsonb_build_object(
      'exige', public.locacao_exige_contrato(_l),
      'valores', public.locacao_contrato_valores(_l),
      'origem', coalesce((SELECT c.origem FROM public.locacao_contrato_dados c WHERE c.locacao_id = _l.id), '{}'::jsonb),
      'faltando', to_jsonb(public.locacao_contrato_faltando(_l))),
    'eventos', (SELECT coalesce(jsonb_agg(jsonb_build_object('em', e.em, 'etapa', e.etapa, 'papel', e.papel,
        'descricao', e.descricao, 'ator_nome', pr.nome) ORDER BY e.em, e.id), '[]')
        FROM public.locacao_eventos e LEFT JOIN public.profiles pr ON pr.id = e.ator_id WHERE e.locacao_id = _l.id));
END $$;
COMMIT;
