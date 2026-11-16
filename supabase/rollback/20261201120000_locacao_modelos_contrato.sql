-- Desfaz 20261201120000_locacao_modelos_contrato (t_d08cfeee). Rodar em transação, DEPOIS de voltar o código do site.
-- 1) As funções alteradas voltam com o texto exato de antes (base indicada em cada uma).
-- 2) As funções novas (modelos e anexos) saem.
-- 3) locacao_modelos só é apagada se nenhuma imobiliária tiver editado modelo; locacao_anexos só se estiver vazia;
--    as colunas modelo_chave/modelo_versao de locacao_minutas só saem se nenhuma minuta gerada as usou. Se houver dado,
--    tudo fica (RLS ligada, sem acesso pelo navegador) e os arquivos continuam no bucket: nada é perdido.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);
DROP FUNCTION IF EXISTS public.locacao_minuta_registrar(uuid, text, text, text, text, integer);
-- locacao_contrato_chaves: texto de 20261112120000_locacao_documentos_ia.sql
CREATE OR REPLACE FUNCTION public.locacao_contrato_chaves() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT ARRAY[
    'loc_nome', 'loc_cpf', 'loc_rg', 'loc_nascimento', 'loc_nacionalidade', 'loc_estado_civil', 'loc_regime',
    'loc_profissao', 'loc_endereco', 'loc_email', 'loc_telefone',
    'prop_nome', 'prop_cpf', 'prop_rg', 'prop_nascimento', 'prop_nacionalidade', 'prop_estado_civil', 'prop_regime',
    'prop_profissao', 'prop_endereco', 'prop_email', 'prop_telefone',
    'prop_conj_nome', 'prop_conj_cpf', 'prop_conj_rg', 'prop_conj_nascimento', 'prop_conj_nacionalidade', 'prop_conj_profissao',
    'fia_nome', 'fia_cpf', 'fia_rg', 'fia_nascimento', 'fia_nacionalidade', 'fia_estado_civil', 'fia_regime',
    'fia_profissao', 'fia_endereco', 'fia_email', 'fia_telefone',
    'fia_conj_nome', 'fia_conj_cpf', 'fia_conj_rg', 'fia_conj_nascimento', 'fia_conj_nacionalidade', 'fia_conj_profissao',
    'fia_matricula', 'fia_cartorio',
    'imv_inscricao', 'imv_energia', 'imv_agua', 'imv_gas', 'imv_vagas',
    'prazo_meses', 'inicio', 'dia_vencimento', 'moradores']::text[]
$$;
-- locacao_contrato_valor_ok: texto de 20261112120000_locacao_documentos_ia.sql
CREATE OR REPLACE FUNCTION public.locacao_contrato_valor_ok(_k text, _v text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE _d date;
BEGIN
  IF _k IS NULL OR NOT (_k = ANY (public.locacao_contrato_chaves())) THEN RETURN false; END IF;
  IF _v IS NULL OR _v = '' THEN RETURN true; END IF;
  IF length(_v) > (CASE WHEN _k = 'moradores' THEN 2000 ELSE 300 END) THEN RETURN false; END IF;
  IF _k = 'inicio' OR _k LIKE '%nascimento' THEN
    IF _v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
    BEGIN _d := _v::date; EXCEPTION WHEN others THEN RETURN false; END;
    RETURN to_char(_d, 'YYYY-MM-DD') = _v AND _d BETWEEN DATE '1900-01-01' AND DATE '2100-12-31';
  END IF;
  IF _k = 'prazo_meses' THEN RETURN _v ~ '^[0-9]{1,3}$' AND _v::integer BETWEEN 1 AND 240; END IF;
  IF _k = 'dia_vencimento' THEN RETURN _v ~ '^[0-9]{1,2}$' AND _v::integer BETWEEN 1 AND 28; END IF;
  RETURN true;
END $$;
-- locacao_montagem_pega: texto de 20261114120000_locacao_montar_contrato.sql
CREATE OR REPLACE FUNCTION public.locacao_montagem_pega(_id uuid) RETURNS public.locacoes
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id);
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['minuta'], 'contratos');
  IF _l.tipo <> 'residencial' OR _l.garantia <> 'fiador' THEN
    RAISE EXCEPTION 'Modelo disponível apenas para residencial com fiador' USING ERRCODE = '22023';
  END IF;
  IF cardinality(public.locacao_docs_faltando(_l)) > 0 THEN
    RAISE EXCEPTION 'Montar contrato travado: documentos obrigatórios pendentes' USING ERRCODE = '22023';
  END IF;
  RETURN _l;
END $$;
-- locacao_montagem_ler: texto de 20261114120000_locacao_montar_contrato.sql
CREATE OR REPLACE FUNCTION public.locacao_montagem_ler(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_montagem_pega(_id); _o public.organizations; _c jsonb;
BEGIN
  SELECT * INTO _o FROM public.organizations WHERE id = _l.organization_id;
  SELECT campos INTO _c FROM public.locacao_montagem WHERE locacao_id = _id AND organization_id = _l.organization_id;
  RETURN jsonb_build_object('campos', coalesce(_c, '{}'::jsonb),
    'contrato', public.locacao_contrato_valores(_l),
    'administradora', jsonb_build_object('nome', coalesce(_o.razao_social, _o.nome),
      'cnpj', _o.cnpj, 'creci', _o.creci, 'cidade', _o.cidade, 'uf', _o.uf));
END $$;
-- locacao_minuta_registrar: texto de 20261130120000_locacao_minuta_anexada.sql
CREATE OR REPLACE FUNCTION public.locacao_minuta_registrar(_id uuid, _path text, _nome text, _origem text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _m jsonb; _v integer; _o text; _nm text; _novo uuid;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['minuta'], 'contratos');
  IF _origem IS NULL OR _origem NOT IN ('anexo', 'gerada') THEN
    RAISE EXCEPTION 'Origem inválida.' USING ERRCODE = '22023';
  END IF;
  IF _path IS NULL OR _path !~ ('^' || _l.organization_id::text || '/' || _l.id::text || '/minutas/[0-9a-f-]{36}[.](pdf|doc|docx)$')
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'locacao-documentos' AND o.name = _path) THEN
    RAISE EXCEPTION 'Arquivo da minuta não encontrado.' USING ERRCODE = '22023';
  END IF;
  IF _origem = 'gerada' AND (_path !~ '[.]pdf$' OR _l.tipo <> 'residencial' OR _l.garantia <> 'fiador') THEN
    RAISE EXCEPTION 'Só a locação residencial com fiador tem modelo para gerar a minuta (PDF).' USING ERRCODE = '22023';
  END IF;
  -- Tipo real gravado no storage tem de bater com a extensão (o navegador declara o tipo no upload).
  IF (SELECT o.metadata->>'mimetype' FROM storage.objects o WHERE o.bucket_id = 'locacao-documentos' AND o.name = _path)
     IS DISTINCT FROM (CASE WHEN _path LIKE '%.pdf' THEN 'application/pdf'
       WHEN _path LIKE '%.doc' THEN 'application/msword'
       ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' END) THEN
    RAISE EXCEPTION 'O tipo do arquivo não confere com a extensão (envie PDF ou Word).' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.locacao_minutas WHERE storage_path = _path) THEN
    RAISE EXCEPTION 'Arquivo já registrado.' USING ERRCODE = '22023';
  END IF;
  _m := _l.minuta;
  _o := CASE WHEN coalesce((_m->>'externa')::boolean, false) AND _origem = 'anexo' THEN 'externa' ELSE _origem END;
  _nm := left(coalesce(nullif(btrim(_nome), ''), 'minuta'), 200);
  -- A locação está travada (FOR UPDATE em locacao_pega): duas gravações seguidas não pegam o mesmo número.
  SELECT coalesce(max(versao), 0) + 1 INTO _v FROM public.locacao_minutas WHERE locacao_id = _l.id;
  INSERT INTO public.locacao_minutas (organization_id, locacao_id, versao, origem, storage_path, nome_arquivo, enviado_por)
  VALUES (_l.organization_id, _l.id, _v, _o, _path, _nm, auth.uid()) RETURNING id INTO _novo;
  PERFORM public.locacao_evento(_l, 'contratos', 'Minuta v' || _v || ' '
    || CASE _o WHEN 'gerada' THEN 'gerada pelo modelo e guardada' WHEN 'externa' THEN 'de outra RE/MAX anexada'
       ELSE 'anexada' END || ' (' || _nm || ')');
  -- Versão nova depois do envio: volta a "elaborando" para o corretor conferir a versão nova.
  IF coalesce(_m->>'estado', '') IN ('', 'com_corretor', 'aprovada') THEN
    IF _m->>'estado' IN ('com_corretor', 'aprovada') THEN
      PERFORM public.locacao_evento(_l, 'contratos', 'Minuta volta a "elaborando": a versão v' || _v
        || ' ainda não foi enviada ao corretor');
    END IF;
    _m := _m || jsonb_build_object('estado', 'elaborando');
    UPDATE public.locacoes SET minuta = _m, atualizado_em = now() WHERE id = _l.id;
  ELSE
    UPDATE public.locacoes SET atualizado_em = now() WHERE id = _l.id;
  END IF;
  RETURN jsonb_build_object('id', _novo, 'versao', _v);
END $$;
REVOKE ALL ON FUNCTION public.locacao_minuta_registrar(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_minuta_registrar(uuid, text, text, text) TO authenticated;
-- locacao_pos_acao: texto de 20261110120000_locacao_fase1.sql
CREATE OR REPLACE FUNCTION public.locacao_pos_acao(_id uuid, _acao text, _dados jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _p jsonb; _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _c public.locacao_config; _data date; _alerta text; _desc text; _s text;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pos_assinatura', 'chaves'], 'vistoria');
  _p := _l.pos; _dados := coalesce(_dados, '{}'::jsonb);
  IF _acao = 'vistoria_pedida' THEN _p := _p || jsonb_build_object('vistoria_pedida', _hoje); _desc := 'Vistoria pedida';
  ELSIF _acao = 'laudo_assinado' THEN
    IF _p->>'vistoria_pedida' IS NULL AND NOT coalesce((_p->>'vist_junto')::boolean, false) THEN
      RAISE EXCEPTION 'Registre antes o pedido de vistoria.' USING ERRCODE = '22023';
    END IF;
    _p := _p || jsonb_build_object('laudo_em', _hoje); _desc := 'Laudo de vistoria assinado';
  ELSIF _acao = 'contestacao' THEN _p := _p || jsonb_build_object('contestacao_em', _hoje); _desc := 'Contestação de vistoria registrada';
  ELSIF _acao = 'seguro' THEN
    _p := _p || jsonb_build_object('seguro_em', _hoje, 'apolice', left(nullif(btrim(coalesce(_dados->>'apolice', '')), ''), 60));
    _desc := 'Seguro contratado' || coalesce(' — apólice ' || nullif(btrim(coalesce(_dados->>'apolice', '')), ''), '');
  ELSIF _acao = 'condominio_aviso' THEN _p := _p || jsonb_build_object('condominio_aviso', _hoje); _desc := 'Condomínio avisado';
  ELSIF _acao = 'sem_condominio' THEN _p := _p || jsonb_build_object('sem_condominio', true); _desc := 'Imóvel sem condomínio';
  ELSIF _acao = 'mudanca' THEN
    _data := (_dados->>'data')::date;
    IF _data IS NULL THEN RAISE EXCEPTION 'Informe a data da mudança.' USING ERRCODE = '22023'; END IF;
    _p := _p || jsonb_build_object('mudanca', _data); _desc := 'Mudança agendada para ' || to_char(_data, 'DD/MM/YYYY');
  ELSIF _acao = 'titularidade_aplica' THEN
    _s := _dados->>'servico';
    IF _s IS NULL OR _s NOT IN ('cpfl', 'saae', 'gas') THEN RAISE EXCEPTION 'Serviço inválido' USING ERRCODE = '22023'; END IF;
    _p := jsonb_set(_p, ARRAY['tit', _s, 'aplica'], to_jsonb(coalesce((_dados->>'aplica')::boolean, true)), true);
    _desc := upper(_s) || CASE WHEN coalesce((_dados->>'aplica')::boolean, true) THEN ' se aplica' ELSE ' não se aplica' END;
  ELSIF _acao = 'pronto_para_chaves' THEN
    _c := public.locacao_cfg(_l.organization_id);
    IF _l.etapa <> 'pos_assinatura' THEN RAISE EXCEPTION 'Ação não disponível nesta etapa.' USING ERRCODE = '22023'; END IF;
    IF _c.seguro_incendio_obrigatorio AND _p->>'seguro_em' IS NULL THEN
      RAISE EXCEPTION 'Seguro incêndio obrigatório nesta imobiliária: registre o seguro antes.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.locacoes SET pos = _p WHERE id = _id;
    _l := public.locacao_mover(_id, 'chaves', false, NULL);
    PERFORM public.locacao_evento(_l, 'vistoria', 'Pós-assinatura concluída — aguardando entrega das chaves');
    RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
  ELSIF _acao = 'entregar_chaves' THEN
    _c := public.locacao_cfg(_l.organization_id);
    _data := coalesce((_dados->>'data')::date, _hoje);
    IF _data > _hoje + 1 OR _data < _hoje - 120 THEN RAISE EXCEPTION 'Data de entrega inválida.' USING ERRCODE = '22023'; END IF;
    IF _c.seguro_incendio_obrigatorio AND _p->>'seguro_em' IS NULL THEN
      RAISE EXCEPTION 'Seguro incêndio obrigatório nesta imobiliária: registre o seguro antes.' USING ERRCODE = '22023';
    END IF;
    IF _p->>'laudo_em' IS NULL THEN
      IF NOT _c.chave_antes_do_laudo THEN
        RAISE EXCEPTION 'Laudo de vistoria ainda não assinado: entrega da chave bloqueada nesta imobiliária.' USING ERRCODE = '22023';
      END IF;
      _alerta := ' (ALERTA: laudo de vistoria ainda não assinado)';
    END IF;
    UPDATE public.locacoes SET pos = _p, chave_em = _data WHERE id = _id;
    _l := public.locacao_mover(_id, 'comissao', false, NULL);
    UPDATE public.locacoes SET etapa_desde = _data::timestamp AT TIME ZONE 'America/Sao_Paulo' WHERE id = _id RETURNING * INTO _l;
    PERFORM public.locacao_evento(_l, 'vistoria', 'Chaves entregues em ' || to_char(_data, 'DD/MM/YYYY') || coalesce(_alerta, ''));
    RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa, 'alerta', _alerta IS NOT NULL);
  ELSE
    RAISE EXCEPTION 'Ação inválida' USING ERRCODE = '22023';
  END IF;
  UPDATE public.locacoes SET pos = _p, atualizado_em = now() WHERE id = _id RETURNING * INTO _l;
  PERFORM public.locacao_evento(_l, 'vistoria', _desc);
  RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Valor inválido' USING ERRCODE = '22023';
END $$;
-- locacao_detalhe: texto de 20261130120000_locacao_minuta_anexada.sql
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
    'minutas', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'versao', v.versao, 'origem', v.origem,
        'nome_arquivo', v.nome_arquivo, 'enviado_em', v.enviado_em, 'enviado_por_nome', pr.nome)
        ORDER BY v.versao DESC), '[]')
        FROM public.locacao_minutas v LEFT JOIN public.profiles pr ON pr.id = v.enviado_por WHERE v.locacao_id = _l.id),
    'andamentos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'etapa', a.etapa, 'texto', a.texto,
        'aguardando', a.aguardando, 'criado_em', a.criado_em, 'criado_por_nome', pc.nome, 'resolvido_em', a.resolvido_em,
        'resolvido_por_nome', pr.nome, 'resolucao', a.resolucao) ORDER BY a.criado_em DESC), '[]')
        FROM public.locacao_andamentos a LEFT JOIN public.profiles pc ON pc.id = a.criado_por
        LEFT JOIN public.profiles pr ON pr.id = a.resolvido_por WHERE a.locacao_id = _l.id),
    'eventos', (SELECT coalesce(jsonb_agg(jsonb_build_object('em', e.em, 'etapa', e.etapa, 'papel', e.papel,
        'descricao', e.descricao, 'ator_nome', pr.nome) ORDER BY e.em, e.id), '[]')
        FROM public.locacao_eventos e LEFT JOIN public.profiles pr ON pr.id = e.ator_id WHERE e.locacao_id = _l.id));
END $$;
DROP FUNCTION IF EXISTS public.locacao_modelos_listar();
DROP FUNCTION IF EXISTS public.locacao_modelo_ler(text, integer);
DROP FUNCTION IF EXISTS public.locacao_modelo_historico(text);
DROP FUNCTION IF EXISTS public.locacao_modelo_salvar(text, jsonb, text, boolean);
DROP FUNCTION IF EXISTS public.locacao_modelo_restaurar(text, integer, boolean);
DROP FUNCTION IF EXISTS public.locacao_modelo_gravar(uuid, text, jsonb, text, boolean, integer);
DROP FUNCTION IF EXISTS public.locacao_modelo_travados(jsonb);
DROP FUNCTION IF EXISTS public.locacao_modelo_validar(text, jsonb);
DROP FUNCTION IF EXISTS public.locacao_modelo_exige();
DROP FUNCTION IF EXISTS public.locacao_modelo_json(public.locacao_modelos);
DROP FUNCTION IF EXISTS public.locacao_modelo_atual(uuid, text);
DROP FUNCTION IF EXISTS public.locacao_modelo_garantia_ok(text, text);
DROP FUNCTION IF EXISTS public.locacao_modelo_blocos();
DROP FUNCTION IF EXISTS public.locacao_modelo_campos();
DROP FUNCTION IF EXISTS public.locacao_anexo_preparar(uuid, text, text);
DROP FUNCTION IF EXISTS public.locacao_anexo_registrar(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.locacao_anexo_ver(uuid);
DROP FUNCTION IF EXISTS public.locacao_anexo_exige(public.locacoes, text);
DROP FUNCTION IF EXISTS public.locacao_tem_apolice(uuid);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.locacao_modelos WHERE organization_id IS NOT NULL) THEN
    DROP TABLE public.locacao_modelos;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.locacao_anexos) THEN DROP TABLE public.locacao_anexos; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.locacao_minutas WHERE modelo_chave IS NOT NULL OR modelo_versao IS NOT NULL) THEN
    ALTER TABLE public.locacao_minutas DROP COLUMN IF EXISTS modelo_chave, DROP COLUMN IF EXISTS modelo_versao;
  END IF;
END $$;
COMMIT;
