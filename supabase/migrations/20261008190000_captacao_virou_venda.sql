-- "Virou venda" na captação exclusiva (maquete t_44bf526e aprovada por Denis em 08/10/2026).
--
-- Regras aprovadas:
--  1. Só captação aprovada (contrato assinado), não arquivada/descartada. Pode virar venda: o próprio
--     captador, corretor da MESMA equipe do captador ou gestor/TL/líder auxiliar dessa equipe
--     (is_lead_of). Admin de fora da equipe, outra equipe e outra imobiliária: não.
--  2. A venda nasce em rascunho, preenchida com imóvel, proprietários e captador. Comprador, valor,
--     data, Mídia e parceria ficam para o corretor; o fluxo da venda não muda.
--  3. Documentos: a venda APONTA para os arquivos da captação (sem cópia). Quem pode ver a venda (ativa)
--     lê os documentos herdados, exceto o contrato "gerado" (versão sem assinatura).
--  4. Vínculo sales.exclusive_capture_id + índice único parcial: no máximo UMA venda ativa (não
--     arquivada/cancelada) por captação, no banco. O vínculo só nasce pela RPC e não muda depois.
--  5. Situação da captação deriva da venda ativa: rascunho -> continua "Ativa"; enviada ao gestor em
--     diante -> "Em negociação"; contrato assinado/ocorrência -> "Vendida" (sai do mapa); venda
--     arquivada/cancelada -> volta a "Ativa". Cada mudança fica no histórico da captação.
--
-- mapa_captacoes_v2 (migration 20261008170000, em produção) é recriada aqui com 3 colunas novas
-- (negociacao, negociacao_desde, pode_virar_venda) e sem as captações vendidas; a 20261008170000 não
-- é editada. O frontend publicado continua funcionando (só ignora as colunas novas).
-- Rollback: supabase/rollback/20261008190000_captacao_virou_venda.sql
BEGIN;

-- 4) Vínculo venda -> captação ------------------------------------------------------------------
ALTER TABLE public.sales ADD COLUMN exclusive_capture_id uuid;
ALTER TABLE public.sales ADD CONSTRAINT sales_exclusive_capture_org_fk
  FOREIGN KEY (exclusive_capture_id, organization_id)
  REFERENCES public.exclusive_captures (id, organization_id);
COMMENT ON COLUMN public.sales.exclusive_capture_id IS
  'Captação exclusiva de origem ("Virou venda"). Só é gravada pela RPC exclusive_virar_venda.';
-- Uma venda ativa por captação (também serve de índice de busca da captação -> venda ativa).
CREATE UNIQUE INDEX sales_captacao_ativa_key ON public.sales (exclusive_capture_id)
  WHERE exclusive_capture_id IS NOT NULL AND status NOT IN ('arquivada', 'cancelada');
CREATE INDEX sales_exclusive_capture_idx ON public.sales (exclusive_capture_id)
  WHERE exclusive_capture_id IS NOT NULL;

-- O vínculo dá acesso aos documentos da captação: ninguém o cria/altera por fora da RPC.
CREATE FUNCTION public.sales_proteger_vinculo_captacao()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.exclusive_capture_id IS NOT NULL
       AND current_setting('app.virou_venda', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'A venda só pode ser ligada à captação pelo botão "Virou venda".' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.exclusive_capture_id IS DISTINCT FROM OLD.exclusive_capture_id THEN
    RAISE EXCEPTION 'O vínculo da venda com a captação não pode ser alterado.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_sales_proteger_vinculo_captacao BEFORE INSERT OR UPDATE OF exclusive_capture_id
  ON public.sales FOR EACH ROW EXECUTE FUNCTION public.sales_proteger_vinculo_captacao();

-- 5) Situação da captação pela venda ------------------------------------------------------------
CREATE FUNCTION public.venda_situacao_captacao(_status public.sale_status)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN _status IN ('arquivada', 'cancelada') THEN 'encerrada'
    WHEN _status = 'rascunho' THEN 'rascunho'
    WHEN _status IN ('contrato_assinado', 'ocorrencia_pendente', 'ocorrencia_analise_financeiro',
                     'ocorrencia_devolvida_gestor', 'ocorrencia_concluida') THEN 'vendida'
    ELSE 'em_negociacao' END
$function$;

-- Histórico da captação a cada mudança de situação provocada pela venda.
CREATE FUNCTION public.sales_captacao_historico()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE _de text := public.venda_situacao_captacao(OLD.status);
        _para text := public.venda_situacao_captacao(NEW.status);
        _acao text;
BEGIN
  IF _de = _para THEN RETURN NULL; END IF;
  _acao := CASE
    WHEN _para = 'encerrada' THEN 'venda_encerrada_captacao_ativa'
    WHEN _para = 'em_negociacao' AND _de = 'rascunho' THEN 'em_negociacao'
    WHEN _para = 'vendida' THEN 'vendida'
    WHEN _para = 'em_negociacao' AND _de = 'vendida' THEN 'venda_desfeita_em_negociacao'
  END;
  IF _acao IS NOT NULL THEN
    INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
    VALUES (NEW.exclusive_capture_id, coalesce(auth.uid(), NEW.corretor_id), _acao, NEW.id::text);
  END IF;
  RETURN NULL;
END $function$;
CREATE TRIGGER trg_sales_captacao_historico AFTER UPDATE OF status ON public.sales
  FOR EACH ROW WHEN (NEW.exclusive_capture_id IS NOT NULL AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.sales_captacao_historico();

-- 1) Quem pode transformar a captação em venda --------------------------------------------------
CREATE FUNCTION public.exclusive_pode_virar_venda(_id uuid, _actor uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  RETURN coalesce((
    SELECT public.exclusive_capture_enabled()
      AND _actor IS NOT NULL AND _actor = auth.uid()
      AND public.is_active_user(_actor)
      AND public.has_any_role(_actor, ARRAY['corretor','gestor','team_leader']::public.app_role[])
      AND EXISTS (
        SELECT 1 FROM public.exclusive_captures c
        WHERE c.id = _id AND c.organization_id = public.current_org_id()
          AND c.status = 'aprovada' AND c.archived_at IS NULL AND c.discarded_at IS NULL
          AND (
            c.captor_id = _actor
            OR public.is_lead_of(_actor, c.captor_id)
            -- corretor da mesma equipe do captador
            OR EXISTS (SELECT 1 FROM public.team_members a
                       JOIN public.team_members b ON b.team_id = a.team_id
                       WHERE a.membro_id = _actor AND b.membro_id = c.captor_id
                         AND a.organization_id = c.organization_id)
            -- captador é o líder da equipe e o ator é membro dela
            OR EXISTS (SELECT 1 FROM public.teams t
                       JOIN public.team_members a ON a.team_id = t.id
                       WHERE t.lider_id = c.captor_id AND a.membro_id = _actor
                         AND t.organization_id = c.organization_id)
          ))), false);
END $function$;

-- Venda ativa da captação, no formato usado pelas telas (sem dado de comprador/valor).
CREATE FUNCTION public.exclusive_venda_ativa(_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'id', s.id,
    'codigo', upper(left(s.id::text, 8)),
    'status', s.status,
    'situacao', public.venda_situacao_captacao(s.status),
    'aberta_por', nullif(btrim(p.nome), ''),
    'aberta_em', (s.created_at AT TIME ZONE 'America/Sao_Paulo')::date,
    'negociacao_desde', (SELECT (min(h.created_at) AT TIME ZONE 'America/Sao_Paulo')::date
                         FROM public.exclusive_history h
                         WHERE h.capture_id = _id AND h.action = 'em_negociacao' AND h.detail = s.id::text),
    'pode_abrir', coalesce(public.can_view_sale(auth.uid(), s.id), false))
  FROM public.sales s
  LEFT JOIN public.profiles p ON p.id = s.corretor_id
  WHERE s.exclusive_capture_id = _id AND s.organization_id = public.current_org_id()
    AND s.status NOT IN ('arquivada', 'cancelada')
  LIMIT 1
$function$;

-- Tela da captação: pode virar venda? há venda ativa? (só para quem vê a captação ou pode virar)
CREATE FUNCTION public.exclusive_venda_da_captacao(_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE _pode boolean := public.exclusive_pode_virar_venda(_id, auth.uid());
BEGIN
  IF NOT (_pode OR coalesce(public.exclusive_can_view(_id, auth.uid()), false)) THEN
    RAISE EXCEPTION 'Captação não disponível' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('pode_virar', _pode, 'venda', public.exclusive_venda_ativa(_id));
END $function$;

-- 2) Cria a venda (rascunho) preenchida com os dados da captação. Idempotente: com venda ativa,
-- devolve a existente (criada=false) em vez de criar outra (dois cliques / duas abas).
CREATE FUNCTION public.exclusive_virar_venda(_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE _c public.exclusive_captures%ROWTYPE; _actor uuid := auth.uid(); _sale uuid;
        _im jsonb; _p1 jsonb; _p2 jsonb; _v text; _valor numeric; _uf text;
        _lider uuid; _lider_nome text; _captador_nome text; _existente jsonb;
BEGIN
  -- Trava a captação: chamadas simultâneas esperam aqui e enxergam a venda já criada.
  SELECT * INTO _c FROM public.exclusive_captures
    WHERE id = _id AND organization_id = public.current_org_id() FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_pode_virar_venda(_id, _actor) THEN
    RAISE EXCEPTION 'Só o captador, corretores e o gestor da mesma equipe podem transformar esta captação em venda.'
      USING ERRCODE = '42501';
  END IF;
  _existente := public.exclusive_venda_ativa(_id);
  IF _existente IS NOT NULL THEN
    RETURN jsonb_build_object('criada', false, 'venda', _existente);
  END IF;

  _im := coalesce(_c.form_data->'imovel', '{}'::jsonb);
  _p1 := _c.form_data->'proprietario_1';
  _p2 := _c.form_data->'proprietario_2';
  -- "R$ 870.000,00" -> 870000.00 (texto livre da captação; inválido fica em branco)
  _v := regexp_replace(coalesce(_im->>'valor_imovel', ''), '[^0-9,.]', '', 'g');
  _v := CASE WHEN _v LIKE '%,%' THEN replace(replace(_v, '.', ''), ',', '.') ELSE replace(_v, '.', '') END;
  _valor := CASE WHEN _v ~ '^[0-9]{1,13}([.][0-9]{1,2})?$' THEN _v::numeric END;
  _uf := upper(btrim(coalesce(_im->>'estado', '')));
  IF _uf !~ '^[A-Z]{2}$' THEN _uf := NULL; END IF;
  SELECT coalesce(nullif(btrim(p.nome), ''), nullif(btrim(_c.broker_name), '')) INTO _captador_nome
    FROM public.profiles p WHERE p.id = _c.captor_id;
  SELECT t.lider_id, nullif(btrim(lp.nome), '') INTO _lider, _lider_nome
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id AND t.organization_id = _c.organization_id
    LEFT JOIN public.profiles lp ON lp.id = t.lider_id
    WHERE tm.membro_id = _c.captor_id AND t.lider_id IS DISTINCT FROM _c.captor_id
    LIMIT 1;

  PERFORM set_config('app.virou_venda', 'on', true);
  INSERT INTO public.sales (
    corretor_id, status, modalidade, exclusive_capture_id,
    imovel_endereco, imovel_logradouro, imovel_complemento, imovel_bairro, imovel_cidade, imovel_uf,
    matricula, iptu, valor_anunciado,
    corretor_captador_id, corretor_captador, lider_captador_id, lider_captador_nome,
    corretor_vendedor_id, corretor_vendedor)
  VALUES (
    _actor, 'rascunho', 'padrao', _c.id,
    nullif(concat_ws(' - ', nullif(btrim(_im->>'endereco'), ''), nullif(btrim(_im->>'complemento'), '')), ''),
    -- endereço da captação é texto livre: número e CEP ficam para o corretor (decisão 08/10)
    nullif(btrim(_im->>'endereco'), ''),
    nullif(btrim(_im->>'complemento'), ''),
    nullif(btrim(_im->>'bairro'), ''),
    nullif(btrim(_im->>'municipio'), ''),
    _uf,
    nullif(concat_ws(' — ', nullif(btrim(_im->>'numero_matricula'), ''), nullif(btrim(_im->>'cartorio_registro'), '')), ''),
    nullif(btrim(_im->>'classificacao_fiscal_iptu'), ''),
    _valor,
    _c.captor_id, _captador_nome, _lider, CASE WHEN _lider IS NOT NULL THEN _lider_nome END,
    _actor, (SELECT nullif(btrim(nome), '') FROM public.profiles WHERE id = _actor))
  RETURNING id INTO _sale;
  PERFORM set_config('app.virou_venda', 'off', true);

  INSERT INTO public.sale_parties (sale_id, papel, tipo_pessoa, nome, rg, cpf_cnpj, email, telefone,
    endereco, nacionalidade, estado_civil)
  SELECT _sale, x.papel, 'fisica', nullif(btrim(x.o->>'nome_completo'), ''), nullif(btrim(x.o->>'rg'), ''),
    nullif(btrim(x.o->>'cpf'), ''), nullif(btrim(x.o->>'email'), ''), nullif(btrim(x.o->>'telefone_1'), ''),
    nullif(btrim(x.o->>'endereco_completo'), ''), nullif(btrim(x.o->>'nacionalidade'), ''),
    nullif(btrim(x.o->>'estado_civil'), '')
  FROM (VALUES ('vendedor_1', _p1), ('vendedor_2', _p2)) x(papel, o)
  WHERE x.papel = 'vendedor_1' OR nullif(btrim(coalesce(x.o->>'nome_completo', '')), '') IS NOT NULL;
  INSERT INTO public.sale_parties (sale_id, papel, tipo_pessoa) VALUES (_sale, 'comprador_1', 'fisica');

  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
    VALUES (_c.id, _actor, 'virou_venda', _sale::text);
  RETURN jsonb_build_object('criada', true, 'venda', public.exclusive_venda_ativa(_id));
END $function$;

-- 3) Documentos da captação vistos pela venda (sem cópia) ---------------------------------------
-- Lista para a tela da venda: só para quem vê a venda, e só com a venda ativa.
CREATE FUNCTION public.venda_documentos_captacao(_sale_id uuid)
 RETURNS TABLE (id uuid, kind text, owner_index integer, file_name text, storage_path text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT d.id, d.kind, d.owner_index, d.file_name, d.storage_path
  FROM public.sales s
  JOIN public.exclusive_documents d ON d.capture_id = s.exclusive_capture_id
    AND d.organization_id = s.organization_id
  WHERE s.id = _sale_id AND s.organization_id = public.current_org_id()
    AND s.status NOT IN ('arquivada', 'cancelada')
    AND d.kind <> 'gerado'
    AND coalesce(public.can_view_sale(auth.uid(), s.id), false)
  ORDER BY d.kind, d.owner_index
$function$;

-- Storage: o arquivo da captação pode ser lido por quem vê uma venda ATIVA ligada a ela.
CREATE FUNCTION public.exclusive_doc_lido_pela_venda(_name text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE _cap text := split_part(public.mt_1c_relative_path(_name), '/', 1);
BEGIN
  IF _cap !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.exclusive_documents d
    JOIN public.sales s ON s.exclusive_capture_id = d.capture_id AND s.organization_id = d.organization_id
    WHERE d.storage_path = _name AND d.capture_id = _cap::uuid AND d.kind <> 'gerado'
      AND s.organization_id = public.current_org_id()
      AND s.status NOT IN ('arquivada', 'cancelada')
      AND coalesce(public.can_view_sale(auth.uid(), s.id), false));
END $function$;
CREATE POLICY exclusive_storage_read_via_venda ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'exclusive-captures' AND public.exclusive_doc_lido_pela_venda(name));

-- Mapa: recria mapa_captacoes_v2 (20261008170000) com a situação de venda --------------------------
DROP FUNCTION public.mapa_captacoes_v2();
CREATE FUNCTION public.mapa_captacoes_v2()
 RETURNS TABLE (
  id uuid,
  codigo text,
  tipo_imovel text,
  bairro text,
  cidade text,
  captador text,
  geo_lat double precision,
  geo_lon double precision,
  detalhe boolean,
  pode_abrir boolean,
  endereco text,
  status text,
  signed_on date,
  prazo_dias text,
  estado text,
  geo_key text,
  valor_imovel text,
  captador_id uuid,
  captador_telefone text,
  captador_email text,
  equipe text,
  negociacao boolean,
  negociacao_desde date,
  pode_virar_venda boolean
 )
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  _org uuid := public.current_org_id();
  _amplo boolean;
BEGIN
  IF NOT public.relatorio_regiao_permitido() THEN
    RAISE EXCEPTION 'Ação não permitida' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce(public.exclusive_capture_enabled(), false) THEN
    RETURN;  -- módulo de captação desligado nesta imobiliária: mapa vazio
  END IF;
  _amplo := coalesce(public.has_any_role(auth.uid(),
    ARRAY['gestor','admin','super_admin']::public.app_role[]), false);
  RETURN QUERY
  WITH c AS (
    SELECT x.id, x.form_data, x.broker_name, x.captor_id, x.geo_lat, x.geo_lon, x.geo_key, x.status,
           x.signed_on, x.created_at,
           coalesce(public.exclusive_can_view(x.id, auth.uid()), false) AS abre,
           v.id AS venda_id, v.status AS venda_status
    FROM public.exclusive_captures x
    LEFT JOIN public.sales v ON v.exclusive_capture_id = x.id AND v.organization_id = _org
      AND v.status NOT IN ('arquivada', 'cancelada')
    WHERE x.organization_id = _org AND x.status = 'aprovada'
      AND x.discarded_at IS NULL AND x.archived_at IS NULL
      -- vendida (contrato da venda assinado) sai do mapa
      AND (v.id IS NULL OR public.venda_situacao_captacao(v.status) <> 'vendida')
  ), d AS (
    SELECT c.*, (_amplo OR c.abre) AS det,
           (c.venda_id IS NOT NULL AND public.venda_situacao_captacao(c.venda_status) = 'em_negociacao') AS neg
    FROM c
  )
  SELECT d.id,
         upper(left(d.id::text, 8)),
         nullif(btrim(d.form_data->'imovel'->>'tipo_imovel'), ''),
         nullif(btrim(d.form_data->'imovel'->>'bairro'), ''),
         nullif(btrim(d.form_data->'imovel'->>'municipio'), ''),
         coalesce(nullif(btrim(d.broker_name), ''), nullif(btrim(p.nome), '')),
         d.geo_lat,
         d.geo_lon,
         d.det,
         d.abre,
         CASE WHEN d.det THEN nullif(btrim(d.form_data->'imovel'->>'endereco'), '') END,
         CASE WHEN d.det THEN d.status END,
         CASE WHEN d.det THEN d.signed_on END,
         CASE WHEN d.det THEN d.form_data->'condicoes'->>'prazo_dias_numero' END,
         CASE WHEN d.abre THEN nullif(btrim(d.form_data->'imovel'->>'estado'), '') END,
         CASE WHEN d.abre THEN d.geo_key END,
         nullif(btrim(d.form_data->'imovel'->>'valor_imovel'), ''),
         d.captor_id,
         -- contato do corretor captador: só de perfil ativo da mesma imobiliária
         CASE WHEN p.ativo THEN nullif(btrim(p.telefone), '') END,
         CASE WHEN p.ativo THEN nullif(btrim(p.email), '') END,
         eq.nome,
         d.neg,
         CASE WHEN d.neg THEN (
           SELECT (min(h.created_at) AT TIME ZONE 'America/Sao_Paulo')::date
           FROM public.exclusive_history h
           WHERE h.capture_id = d.id AND h.action = 'em_negociacao' AND h.detail = d.venda_id::text) END,
         (d.venda_id IS NULL AND public.exclusive_pode_virar_venda(d.id, auth.uid()))
  FROM d
  LEFT JOIN public.profiles p ON p.id = d.captor_id AND p.organization_id = _org
  LEFT JOIN LATERAL (
    SELECT nullif(btrim(t.nome), '') AS nome
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id AND t.organization_id = _org
    WHERE tm.membro_id = d.captor_id AND tm.organization_id = _org
    ORDER BY tm.created_at
    LIMIT 1
  ) eq ON true
  ORDER BY d.created_at DESC;
END $function$;

-- Dono e permissões (mesmo padrão das migrations de captação) -------------------------------------
GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.sales_captacao_historico() OWNER TO mt_1b_definer;
ALTER FUNCTION public.exclusive_pode_virar_venda(uuid, uuid) OWNER TO mt_1b_definer;
ALTER FUNCTION public.exclusive_venda_ativa(uuid) OWNER TO mt_1b_definer;
ALTER FUNCTION public.exclusive_venda_da_captacao(uuid) OWNER TO mt_1b_definer;
ALTER FUNCTION public.exclusive_virar_venda(uuid) OWNER TO mt_1b_definer;
ALTER FUNCTION public.venda_documentos_captacao(uuid) OWNER TO mt_1b_definer;
ALTER FUNCTION public.exclusive_doc_lido_pela_venda(text) OWNER TO mt_1b_definer;
ALTER FUNCTION public.mapa_captacoes_v2() OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;

REVOKE ALL ON FUNCTION public.sales_proteger_vinculo_captacao() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_captacao_historico() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.venda_situacao_captacao(public.sale_status) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exclusive_pode_virar_venda(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exclusive_venda_ativa(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.exclusive_venda_da_captacao(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exclusive_virar_venda(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.venda_documentos_captacao(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.exclusive_doc_lido_pela_venda(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mapa_captacoes_v2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.venda_situacao_captacao(public.sale_status) TO authenticated, service_role, mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.exclusive_pode_virar_venda(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_venda_ativa(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_venda_da_captacao(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_virar_venda(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.venda_documentos_captacao(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exclusive_doc_lido_pela_venda(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mapa_captacoes_v2() TO authenticated, service_role;

COMMIT;
