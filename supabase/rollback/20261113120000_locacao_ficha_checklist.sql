-- Rollback de 20261113120000_locacao_ficha_checklist.sql (t_28e583e2). GERADO por mk_rb.py a partir do texto
-- exato das migrations 20261110120000 e 20261112120000 (as funções voltam idênticas; os grants ficam como estavam).
-- Remove as funções novas e as colunas ficha, captador_id e docs_completos_em.
-- ATENÇÃO: apaga a ficha cadastral, o captador e a data da documentação completa. Em produção, exportar antes.
-- Reverter junto o front (PR): a tela nova lê partes/ficha e chama locacao_corretores.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- locacao_docs_padrao (20261110120000)
CREATE OR REPLACE FUNCTION public.locacao_docs_padrao() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT '{
    "locatario":["RG/CNH do locatário","CPF do locatário","Comprovante de renda do locatário","Comprovante de residência do locatário"],
    "fiador":["RG/CNH do fiador","Comprovante de renda do fiador","Matrícula do imóvel do fiador (quitado)","Certidão de casamento do fiador (se casado)"],
    "caucao":["Comprovante do depósito da caução","Termo de caução assinado pelo locatário"],
    "seguro_fianca":["Apólice/aprovação do seguro-fiança","Proposta da seguradora aceita"],
    "proprietario":["RG/CNH do proprietário","Matrícula atualizada do imóvel","Formulário do proprietário (dados bancários p/ repasse)","Último IPTU / conta de consumo"]
  }'::jsonb
$$;

-- locacao_cfg (20261110120000)
CREATE OR REPLACE FUNCTION public.locacao_cfg(_org uuid) RETURNS public.locacao_config
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.locacao_config;
BEGIN
  SELECT * INTO _c FROM public.locacao_config WHERE organization_id = _org;
  IF _c.organization_id IS NULL THEN
    -- Sem linha: padrão da maquete (mesmos valores dos DEFAULT da tabela).
    _c.organization_id := _org; _c.pct_coordenador := 10; _c.coordenador_sai_do_corretor := true;
    _c.parceria_divide_por_dois := true; _c.coordenador_na_parceria := true; _c.dia_pagamento_1a15 := 8;
    _c.dia_pagamento_16a31 := 6; _c.reprovada_volta_ao_corretor := true; _c.chave_antes_do_laudo := true;
    _c.seguro_incendio_obrigatorio := false; _c.tabela_taxa := '{"10":50,"9":45,"8":40,"7":35,"6":30}'::jsonb;
    _c.documentos := public.locacao_docs_padrao();
  END IF;
  RETURN _c;
END $$;

-- locacao_salvar_pre (20261110120000)
CREATE OR REPLACE FUNCTION public.locacao_salvar_pre(_id uuid, _dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _cand jsonb;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pre_analise'], 'corretor');
  IF _dados IS NULL OR jsonb_typeof(_dados) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_dados) k WHERE k NOT IN
     ('candidato', 'endereco', 'tipo', 'garantia', 'aluguel', 'condominio', 'iptu', 'taxa_adm', 'parceria')) THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE = '22023';
  END IF;
  _cand := coalesce(_dados->'candidato', _l.candidato);
  IF jsonb_typeof(_cand) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(_cand) e
     WHERE e.key NOT IN ('cpf', 'nome', 'nascimento', 'telefone', 'email') OR jsonb_typeof(e.value) NOT IN ('string', 'null')
        OR length(coalesce(e.value #>> '{}', '')) > 200) THEN
    RAISE EXCEPTION 'Dados do candidato inválidos' USING ERRCODE = '22023';
  END IF;
  UPDATE public.locacoes SET candidato = _cand,
    endereco = CASE WHEN _dados ? 'endereco' THEN nullif(btrim(_dados->>'endereco'), '') ELSE endereco END,
    tipo = coalesce(_dados->>'tipo', tipo), garantia = coalesce(_dados->>'garantia', garantia),
    aluguel = CASE WHEN _dados ? 'aluguel' THEN nullif((_dados->>'aluguel')::numeric, 0) ELSE aluguel END,
    condominio = coalesce((_dados->>'condominio')::numeric, condominio), iptu = coalesce((_dados->>'iptu')::numeric, iptu),
    taxa_adm = coalesce((_dados->>'taxa_adm')::numeric, taxa_adm), parceria = coalesce((_dados->>'parceria')::boolean, parceria),
    atualizado_em = now()
   WHERE id = _id RETURNING * INTO _l;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
  RAISE EXCEPTION 'Valor inválido na pré-análise' USING ERRCODE = '22023';
END $$;

-- locacao_enviar_pre (20261110120000)
CREATE OR REPLACE FUNCTION public.locacao_enviar_pre(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _f text[] := ARRAY[]::text[];
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pre_analise'], 'corretor');
  IF coalesce(_l.candidato->>'cpf', '') !~ '^[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}$' THEN _f := array_append(_f, 'CPF'); END IF;
  IF length(btrim(coalesce(_l.candidato->>'nome', ''))) < 5 THEN _f := array_append(_f, 'nome completo'); END IF;
  IF coalesce(_l.candidato->>'nascimento', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN _f := array_append(_f, 'data de nascimento'); END IF;
  IF length(regexp_replace(coalesce(_l.candidato->>'telefone', ''), '[^0-9]', '', 'g')) < 10 THEN _f := array_append(_f, 'telefone'); END IF;
  IF coalesce(_l.candidato->>'email', '') !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' THEN _f := array_append(_f, 'e-mail'); END IF;
  IF length(coalesce(_l.endereco, '')) < 8 THEN _f := array_append(_f, 'endereço do imóvel'); END IF;
  IF _l.aluguel IS NULL THEN _f := array_append(_f, 'aluguel'); END IF;
  IF cardinality(_f) > 0 THEN
    RAISE EXCEPTION 'Preencha: %', array_to_string(_f, ', ') USING ERRCODE = '22023';
  END IF;
  _l := public.locacao_mover(_id, 'aprovacao', false, NULL);
  PERFORM public.locacao_evento(_l, 'corretor', 'Pré-análise enviada à gestora');
  RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
END $$;

-- locacao_docs_faltando (20261110120000)
CREATE OR REPLACE FUNCTION public.locacao_docs_faltando(_l public.locacoes) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(array_agg(i ORDER BY n), ARRAY[]::text[])
    FROM unnest(public.locacao_checklist(_l.organization_id, _l.garantia)) WITH ORDINALITY AS t(i, n)
   WHERE NOT EXISTS (SELECT 1 FROM public.locacao_documentos d WHERE d.locacao_id = _l.id AND d.item = t.i
                        AND d.removido_em IS NULL)
$$;

-- locacao_documento_preparar (20261110120000)
CREATE OR REPLACE FUNCTION public.locacao_documento_preparar(_id uuid, _item text, _ext text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id);
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao', 'minuta'], 'corretor');
  IF _item IS NULL OR NOT (_item = ANY (public.locacao_checklist(_l.organization_id, _l.garantia))) THEN
    RAISE EXCEPTION 'Documento fora da lista desta garantia.' USING ERRCODE = '22023';
  END IF;
  IF _ext IS NULL OR _ext NOT IN ('pdf', 'jpg', 'jpeg', 'png', 'webp') THEN
    RAISE EXCEPTION 'Tipo de arquivo não aceito (PDF ou imagem).' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('path', _l.organization_id::text || '/' || _l.id::text || '/' || gen_random_uuid()::text || '.' || _ext);
END $$;

-- locacao_documento_registrar (20261110120000)
CREATE OR REPLACE FUNCTION public.locacao_documento_registrar(_id uuid, _item text, _path text, _nome text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _d uuid;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao', 'minuta'], 'corretor');
  IF _item IS NULL OR NOT (_item = ANY (public.locacao_checklist(_l.organization_id, _l.garantia))) THEN
    RAISE EXCEPTION 'Documento fora da lista desta garantia.' USING ERRCODE = '22023';
  END IF;
  IF _path IS NULL OR _path !~ ('^' || _l.organization_id::text || '/' || _l.id::text || '/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$')
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'locacao-documentos' AND o.name = _path) THEN
    RAISE EXCEPTION 'Arquivo não encontrado.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.locacao_documentos WHERE storage_path = _path) THEN
    RAISE EXCEPTION 'Arquivo já registrado.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.locacao_documentos (organization_id, locacao_id, item, storage_path, nome_arquivo, enviado_por)
  VALUES (_l.organization_id, _l.id, _item, _path, left(coalesce(nullif(btrim(_nome), ''), 'arquivo'), 200), auth.uid())
  RETURNING id INTO _d;
  PERFORM public.locacao_evento(_l, 'corretor', 'Documento anexado: ' || _item);
  RETURN jsonb_build_object('id', _d);
END $$;

-- locacao_documento_remover (20261110120000)
CREATE OR REPLACE FUNCTION public.locacao_documento_remover(_doc uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _d public.locacao_documentos; _l public.locacoes;
BEGIN
  SELECT * INTO _d FROM public.locacao_documentos WHERE id = _doc AND removido_em IS NULL;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'Documento não encontrado.' USING ERRCODE = '22023'; END IF;
  _l := public.locacao_pega(_d.locacao_id);
  PERFORM public.locacao_exige(_l, ARRAY['documentacao'], 'corretor');
  UPDATE public.locacao_documentos SET removido_em = now() WHERE id = _doc;
  PERFORM public.locacao_evento(_l, 'corretor', 'Documento removido: ' || _d.item);
  RETURN true;
END $$;

-- locacao_config_salvar (20261110120000)
CREATE OR REPLACE FUNCTION public.locacao_config_salvar(_dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _c public.locacao_config; _k text; _v jsonb;
BEGIN
  IF NOT public.locacao_eh_gerencia(auth.uid()) THEN
    RAISE EXCEPTION 'Só a administração da imobiliária altera as regras.' USING ERRCODE = '42501';
  END IF;
  IF _dados IS NULL OR jsonb_typeof(_dados) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_dados) k WHERE k NOT IN
     ('pct_coordenador', 'coordenador_sai_do_corretor', 'parceria_divide_por_dois', 'coordenador_na_parceria',
      'dia_pagamento_1a15', 'dia_pagamento_16a31', 'reprovada_volta_ao_corretor', 'chave_antes_do_laudo',
      'seguro_incendio_obrigatorio', 'tabela_taxa', 'documentos')) THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE = '22023';
  END IF;
  IF _dados ? 'tabela_taxa' THEN
    IF jsonb_typeof(_dados->'tabela_taxa') <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(_dados->'tabela_taxa') e
       WHERE e.key !~ '^[0-9]{1,2}$' OR jsonb_typeof(e.value) <> 'number' OR (e.value)::text::numeric NOT BETWEEN 0 AND 100) THEN
      RAISE EXCEPTION 'Tabela de taxa inválida' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF _dados ? 'documentos' THEN
    IF jsonb_typeof(_dados->'documentos') <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(_dados->'documentos') e
       WHERE e.key NOT IN ('locatario', 'fiador', 'caucao', 'seguro_fianca', 'proprietario') OR jsonb_typeof(e.value) <> 'array'
          OR jsonb_array_length(e.value) > 30 OR EXISTS (SELECT 1 FROM jsonb_array_elements(e.value) x
             WHERE jsonb_typeof(x) <> 'string' OR length(btrim(x #>> '{}')) NOT BETWEEN 2 AND 200)) THEN
      RAISE EXCEPTION 'Lista de documentos inválida' USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO public.locacao_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.locacao_config SET
    pct_coordenador = coalesce((_dados->>'pct_coordenador')::numeric, pct_coordenador),
    coordenador_sai_do_corretor = coalesce((_dados->>'coordenador_sai_do_corretor')::boolean, coordenador_sai_do_corretor),
    parceria_divide_por_dois = coalesce((_dados->>'parceria_divide_por_dois')::boolean, parceria_divide_por_dois),
    coordenador_na_parceria = coalesce((_dados->>'coordenador_na_parceria')::boolean, coordenador_na_parceria),
    dia_pagamento_1a15 = coalesce((_dados->>'dia_pagamento_1a15')::integer, dia_pagamento_1a15),
    dia_pagamento_16a31 = coalesce((_dados->>'dia_pagamento_16a31')::integer, dia_pagamento_16a31),
    reprovada_volta_ao_corretor = coalesce((_dados->>'reprovada_volta_ao_corretor')::boolean, reprovada_volta_ao_corretor),
    chave_antes_do_laudo = coalesce((_dados->>'chave_antes_do_laudo')::boolean, chave_antes_do_laudo),
    seguro_incendio_obrigatorio = coalesce((_dados->>'seguro_incendio_obrigatorio')::boolean, seguro_incendio_obrigatorio),
    tabela_taxa = coalesce(_dados->'tabela_taxa', tabela_taxa),
    documentos = coalesce(_dados->'documentos', documentos),
    atualizado_em = now(), atualizado_por = auth.uid()
   WHERE organization_id = _org RETURNING * INTO _c;
  RETURN to_jsonb(_c) - 'organization_id' - 'atualizado_por';
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
  RAISE EXCEPTION 'Valor inválido nas regras' USING ERRCODE = '22023';
END $$;

-- locacao_contratos_acao (20261110120000)
CREATE OR REPLACE FUNCTION public.locacao_contratos_acao(_id uuid, _acao text, _dados jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _m jsonb; _a jsonb; _t text; _doc text;
BEGIN
  _m := _l.minuta; _a := _l.assinatura; _dados := coalesce(_dados, '{}'::jsonb);
  _t := nullif(btrim(coalesce(_dados->>'texto', '')), '');
  IF _acao IN ('cobrar_pendencia', 'enviar_minuta', 'marcar_ajuste', 'minuta_externa', 'preparar_assinatura') THEN
    PERFORM public.locacao_exige(_l, ARRAY['minuta'], 'contratos');
  ELSIF _acao IN ('registrar_envio', 'marcar_assinado') THEN
    PERFORM public.locacao_exige(_l, ARRAY['assinatura'], 'contratos');
  ELSE
    RAISE EXCEPTION 'Ação inválida' USING ERRCODE = '22023';
  END IF;

  IF _acao = 'cobrar_pendencia' THEN
    IF _t IS NULL OR length(_t) < 5 THEN RAISE EXCEPTION 'Descreva a pendência.' USING ERRCODE = '22023'; END IF;
    _m := _m || jsonb_build_object('estado', 'pendencia', 'pendencia', left(_t, 500));
    PERFORM public.locacao_evento(_l, 'contratos', 'Contratos cobrou pendência do corretor: ' || _t);
  ELSIF _acao = 'minuta_externa' THEN
    _m := _m || jsonb_build_object('externa', coalesce((_dados->>'externa')::boolean, true));
    PERFORM public.locacao_evento(_l, 'contratos', CASE WHEN (_m->>'externa')::boolean
      THEN 'Atalho: minuta pronta de outra RE/MAX' ELSE 'Atalho de minuta externa desmarcado' END);
  ELSIF _acao = 'enviar_minuta' THEN
    _m := _m || jsonb_build_object('estado', 'com_corretor',
      'modelo', CASE WHEN _l.tipo = 'comercial' THEN 'Comercial' ELSE 'Residencial' END || ' — ' ||
        CASE _l.garantia WHEN 'fiador' THEN 'Fiador' WHEN 'caucao' THEN 'Caução' ELSE 'Seguro-fiança' END);
    PERFORM public.locacao_evento(_l, 'contratos', CASE WHEN coalesce((_m->>'externa')::boolean, false)
      THEN 'Minuta externa (outra RE/MAX) enviada ao corretor' ELSE 'Minuta enviada ao corretor (' || (_m->>'modelo') || ')' END);
  ELSIF _acao = 'marcar_ajuste' THEN
    _m := _m || jsonb_build_object('estado', 'ajuste', 'ajuste_data', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
      'ajuste_motivo', coalesce(left(_t, 500), 'Pedido do proprietário'));
    PERFORM public.locacao_evento(_l, 'contratos', 'Minuta EM AJUSTE: ' || coalesce(_t, 'pedido do proprietário'));
  ELSIF _acao = 'preparar_assinatura' THEN
    IF coalesce(_m->>'estado', '') <> 'aprovada' AND NOT coalesce((_m->>'externa')::boolean, false) THEN
      RAISE EXCEPTION 'A minuta ainda não foi aprovada pelo corretor/proprietário.' USING ERRCODE = '22023';
    END IF;
    _m := _m || jsonb_build_object('estado', 'aprovada');
    UPDATE public.locacoes SET minuta = _m, assinatura = jsonb_build_object('adm', 'nao', 'loc', 'nao', 'vist', 'nao',
      'vist_junto', false, 'modo', 'manual') WHERE id = _id;
    _l := public.locacao_mover(_id, 'assinatura', false, NULL);
    PERFORM public.locacao_evento(_l, 'contratos', 'Minuta aprovada — preparando assinatura');
    RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
  ELSIF _acao = 'registrar_envio' THEN
    IF _a->>'enviado_em' IS NOT NULL THEN RAISE EXCEPTION 'Envio já registrado.' USING ERRCODE = '22023'; END IF;
    _a := _a || jsonb_build_object('enviado_em', (now() AT TIME ZONE 'America/Sao_Paulo')::date, 'adm', 'pendente', 'loc', 'pendente',
      'vist_junto', coalesce((_dados->>'vist_junto')::boolean, false),
      'vist', CASE WHEN coalesce((_dados->>'vist_junto')::boolean, false) THEN 'pendente' ELSE 'nao' END);
    UPDATE public.locacoes SET assinatura = _a, atualizado_em = now() WHERE id = _id;
    PERFORM public.locacao_evento(_l, 'contratos', 'Envio para assinatura registrado (manual, DocuSign)'
      || CASE WHEN (_a->>'vist_junto')::boolean THEN ' com vistoria junto' ELSE '' END);
    RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
  ELSIF _acao = 'marcar_assinado' THEN
    _doc := _dados->>'documento';
    IF _doc IS NULL OR _doc NOT IN ('adm', 'loc', 'vist') OR coalesce(_a->>_doc, 'nao') <> 'pendente' THEN
      RAISE EXCEPTION 'Envelope inválido ou não enviado.' USING ERRCODE = '22023';
    END IF;
    _a := _a || jsonb_build_object(_doc, 'assinado');
    UPDATE public.locacoes SET assinatura = _a, atualizado_em = now(),
      pos = CASE WHEN _doc = 'vist' THEN pos || jsonb_build_object('laudo_em', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
        'vist_junto', true) ELSE pos END
     WHERE id = _id RETURNING * INTO _l;
    PERFORM public.locacao_evento(_l, 'contratos', CASE _doc WHEN 'adm' THEN 'Contrato de administração assinado'
      WHEN 'loc' THEN 'Contrato de locação assinado' ELSE 'Laudo de vistoria assinado' END);
    IF _a->>'adm' = 'assinado' AND _a->>'loc' = 'assinado' THEN
      _l := public.locacao_mover(_id, 'pos_assinatura', false, NULL);
      PERFORM public.locacao_evento(_l, 'contratos', 'Contratos assinados — segue para pós-assinatura');
    END IF;
    RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
  END IF;
  UPDATE public.locacoes SET minuta = _m, etapa_desde = now(), atualizado_em = now() WHERE id = _id;
  RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Valor inválido' USING ERRCODE = '22023';
END $$;

-- locacao_grupo_do_item (20261112120000)
CREATE OR REPLACE FUNCTION public.locacao_grupo_do_item(_l public.locacoes, _item text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  WITH d AS (SELECT (public.locacao_cfg(_l.organization_id)).documentos AS j)
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM d, jsonb_array_elements_text(coalesce(d.j->'locatario', '[]')) x WHERE x = _item) THEN 'locatario'
    WHEN EXISTS (SELECT 1 FROM d, jsonb_array_elements_text(coalesce(d.j->_l.garantia, '[]')) x WHERE x = _item) THEN _l.garantia
    WHEN EXISTS (SELECT 1 FROM d, jsonb_array_elements_text(coalesce(d.j->'proprietario', '[]')) x WHERE x = _item) THEN 'proprietario'
    ELSE 'outro' END
$$;

-- locacao_detalhe (20261112120000)
CREATE OR REPLACE FUNCTION public.locacao_detalhe(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _l public.locacoes;
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id AND organization_id = _org;
  IF _l.id IS NULL OR NOT public.locacao_pode_ver(_l) THEN
    RAISE EXCEPTION 'Sem acesso a esta locação.' USING ERRCODE = '42501';
  END IF;
  RETURN public.locacao_json(_l) || jsonb_build_object(
    'checklist', to_jsonb(public.locacao_checklist(_org, _l.garantia)),
    'faltando', to_jsonb(public.locacao_docs_faltando(_l)),
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

DROP FUNCTION IF EXISTS public.locacao_corretores();
DROP FUNCTION IF EXISTS public.locacao_docs_situacao(uuid);
DROP FUNCTION IF EXISTS public.locacao_docs_completos_em(public.locacoes);
DROP FUNCTION IF EXISTS public.locacao_membro_ativo(uuid, uuid);
DROP FUNCTION IF EXISTS public.locacao_ficha_ok(jsonb);
DROP FUNCTION IF EXISTS public.locacao_partes_json(public.locacoes);
DROP FUNCTION IF EXISTS public.locacao_checklist_l(public.locacoes);
DROP FUNCTION IF EXISTS public.locacao_partes(public.locacoes);
DROP FUNCTION IF EXISTS public.locacao_docs_grupo(uuid, text);
DROP FUNCTION IF EXISTS public.locacao_doc_opcional(text);
ALTER TABLE public.locacoes DROP COLUMN IF EXISTS docs_completos_em, DROP COLUMN IF EXISTS captador_id,
  DROP COLUMN IF EXISTS ficha;

COMMIT;
