-- Desfaz 20261124130000_locacao_pre_aprovacao (t_b2ce1207). Rodar em transação, DEPOIS de voltar o código do site.
-- 1) Links da pré-aprovação: apaga tabelas e funções (rascunhos dos clientes somem; dados já enviados ao corretor ficam
--    na locação). Arquivos do anexo opcional já entregues continuam em locacao_documentos e no bucket privado.
-- 2) Garantias novas (loft, titulo_capitalizacao, outras): para o CHECK antigo voltar, essas locações/contratos passam a
--    'seguro_fianca' e o nome da garantia é guardado em ficha.garantia_outra (nada se perde; o corretor vê "outra: X").
--    Em produção: listar antes quem será convertido (SELECT id, garantia FROM locacoes WHERE garantia NOT IN (...)).
-- 3) Chaves novas da ficha/candidato (cep, fiador, renda) ficam no JSON; o site antigo não as lê e regrava a ficha
--    inteira ao salvar, então nada trava.
-- 4) As 9 funções voltam com o texto exato de antes (conferido por md5 em run-locacao-pre-aprovacao.sh).
BEGIN;
SELECT set_config('lock_timeout', '5s', true);
DROP FUNCTION public.locacao_pre_link_enviar(text, text);
DROP FUNCTION public.locacao_pre_link_registrar(text, text, text, text);
DROP FUNCTION public.locacao_pre_link_preparar(text, text, text);
DROP FUNCTION public.locacao_pre_link_salvar(text, text, jsonb);
DROP FUNCTION public.locacao_pre_link_ler(text, text);
DROP FUNCTION public.locacao_pre_link_validar(text, text, boolean);
DROP FUNCTION public.locacao_pre_links_emitir(uuid, text);
DROP FUNCTION public.locacao_pre_links_lista(uuid);
DROP FUNCTION public.locacao_pre_links_modo(uuid, text);
DROP TABLE public.locacao_pre_link_arquivos;
DROP TABLE public.locacao_pre_links;
DROP TABLE public.locacao_pre_modos;

UPDATE public.locacoes SET ficha = ficha || jsonb_build_object('garantia_outra', left(btrim(
    public.locacao_garantia_rotulo(garantia) || coalesce(' — ' || nullif(btrim(ficha->>'garantia_outra'), ''), '')), 300)),
  garantia = 'seguro_fianca'
 WHERE garantia NOT IN ('fiador', 'caucao', 'seguro_fianca');
UPDATE public.locacao_contratos SET garantia = 'seguro_fianca' WHERE garantia NOT IN ('fiador', 'caucao', 'seguro_fianca');
ALTER TABLE public.locacoes DROP CONSTRAINT locacoes_garantia_check;
ALTER TABLE public.locacoes ADD CONSTRAINT locacoes_garantia_check CHECK (garantia IN ('fiador', 'caucao', 'seguro_fianca'));
ALTER TABLE public.locacao_contratos DROP CONSTRAINT locacao_contratos_garantia_check;
ALTER TABLE public.locacao_contratos ADD CONSTRAINT locacao_contratos_garantia_check CHECK (garantia IN ('fiador', 'caucao', 'seguro_fianca'));

-- Funções redefinidas: texto exato anterior.
CREATE OR REPLACE FUNCTION public.locacao_config_salvar(_dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
       WHERE e.key NOT IN ('locatario', 'fiador', 'caucao', 'seguro_fianca', 'proprietario',
                           'locatario_pj', 'fiador_pj', 'proprietario_pj') OR jsonb_typeof(e.value) <> 'array'
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
  -- Lista de documentos mudou: atualiza a data da documentação completa das locações ativas desta imobiliária.
  IF _dados ? 'documentos' THEN
    PERFORM public.locacao_docs_situacao(l.id) FROM public.locacoes l
     WHERE l.organization_id = _org AND l.situacao = 'ativa'
       AND l.etapa IN ('documentacao', 'conferencia', 'minuta', 'assinatura');
  END IF;
  RETURN to_jsonb(_c) - 'organization_id' - 'atualizado_por';
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
  RAISE EXCEPTION 'Valor inválido nas regras' USING ERRCODE = '22023';
END $function$
;

CREATE OR REPLACE FUNCTION public.locacao_contratos_acao(_id uuid, _acao text, _dados jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _l public.locacoes := public.locacao_pega(_id); _m jsonb; _a jsonb; _t text; _doc text; _f text[];
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
  IF _acao IN ('enviar_minuta', 'preparar_assinatura') THEN
    _f := public.locacao_docs_faltando(_l);
    IF cardinality(_f) > 0 THEN
      RAISE EXCEPTION 'Montar contrato travado: faltam % documento(s) obrigatório(s): %', cardinality(_f),
        array_to_string(_f, '; ') USING ERRCODE = '22023';
    END IF;
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
END $function$
;

CREATE OR REPLACE FUNCTION public.locacao_documento_preparar(_id uuid, _item text, _ext text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _l public.locacoes := public.locacao_pega(_id);
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao', 'minuta'], 'corretor');
  IF _item IS NULL OR NOT (_item = ANY (public.locacao_checklist_l(_l))) THEN
    RAISE EXCEPTION 'Documento fora da lista desta garantia.' USING ERRCODE = '22023';
  END IF;
  IF _ext IS NULL OR _ext NOT IN ('pdf', 'jpg', 'jpeg', 'png', 'webp') THEN
    RAISE EXCEPTION 'Tipo de arquivo não aceito (PDF ou imagem).' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('path', _l.organization_id::text || '/' || _l.id::text || '/' || gen_random_uuid()::text || '.' || _ext);
END $function$
;

CREATE OR REPLACE FUNCTION public.locacao_documento_registrar(_id uuid, _item text, _path text, _nome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _l public.locacoes := public.locacao_pega(_id); _d uuid;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao', 'minuta'], 'corretor');
  IF _item IS NULL OR NOT (_item = ANY (public.locacao_checklist_l(_l))) THEN
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
  PERFORM public.locacao_docs_situacao(_l.id);
  RETURN jsonb_build_object('id', _d);
END $function$
;

CREATE OR REPLACE FUNCTION public.locacao_documento_remover(_doc uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _d public.locacao_documentos; _l public.locacoes;
BEGIN
  SELECT * INTO _d FROM public.locacao_documentos WHERE id = _doc AND removido_em IS NULL;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'Documento não encontrado.' USING ERRCODE = '22023'; END IF;
  _l := public.locacao_pega(_d.locacao_id);
  PERFORM public.locacao_exige(_l, ARRAY['documentacao'], 'corretor');
  UPDATE public.locacao_documentos SET removido_em = now() WHERE id = _doc;
  PERFORM public.locacao_evento(_l, 'corretor', 'Documento removido: ' || _d.item);
  PERFORM public.locacao_docs_situacao(_l.id);
  RETURN true;
END $function$
;

CREATE OR REPLACE FUNCTION public.locacao_enviar_pre(_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  IF btrim(coalesce(_l.ficha->>'imovel_id', '')) = '' THEN _f := array_append(_f, 'ID do imóvel'); END IF;
  IF coalesce(_l.ficha->>'mobilia', '') = '' THEN _f := array_append(_f, 'mobília'); END IF;
  IF coalesce((_l.ficha->>'metragem')::numeric, 0) <= 0 THEN _f := array_append(_f, 'metragem'); END IF;
  IF length(btrim(coalesce(_l.ficha->>'locatario_endereco', ''))) < 8 THEN _f := array_append(_f, 'endereço atual do locatário'); END IF;
  IF length(btrim(coalesce(_l.ficha->'proprietario'->>'nome', ''))) < 3 THEN _f := array_append(_f, 'nome do proprietário'); END IF;
  IF btrim(coalesce(_l.ficha->'proprietario'->>'telefone', '')) = '' AND btrim(coalesce(_l.ficha->'proprietario'->>'email', '')) = '' THEN
    _f := array_append(_f, 'telefone ou e-mail do proprietário');
  END IF;
  IF _l.captador_id IS NULL THEN _f := array_append(_f, 'corretor captador'); END IF;
  IF cardinality(_f) > 0 THEN
    RAISE EXCEPTION 'Preencha: %', array_to_string(_f, ', ') USING ERRCODE = '22023';
  END IF;
  _l := public.locacao_mover(_id, 'aprovacao', false, NULL);
  PERFORM public.locacao_evento(_l, 'corretor', 'Pré-análise enviada à gestora');
  RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
END $function$
;

CREATE OR REPLACE FUNCTION public.locacao_ficha_ok(_f jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE _e record; _x record; _t text;
BEGIN
  IF _f IS NULL OR jsonb_typeof(_f) <> 'object' THEN RETURN false; END IF;
  FOR _e IN SELECT key, value FROM jsonb_each(_f) LOOP
    CONTINUE WHEN jsonb_typeof(_e.value) = 'null';
    _t := CASE WHEN jsonb_typeof(_e.value) = 'string' THEN _e.value #>> '{}' END;
    IF _e.key = 'imovel_id' THEN
      IF _t IS NULL OR length(_t) > 40 THEN RETURN false; END IF;
    ELSIF _e.key = 'mobilia' THEN
      IF _t IS NULL OR _t NOT IN ('mobiliado', 'semi', 'sem') THEN RETURN false; END IF;
    ELSIF _e.key = 'metragem' THEN
      IF jsonb_typeof(_e.value) <> 'number' OR (_e.value)::text::numeric <= 0 OR (_e.value)::text::numeric >= 1000000 THEN
        RETURN false;
      END IF;
    ELSIF _e.key IN ('locatario_pessoa', 'proprietario_pessoa', 'fiador_pessoa') THEN
      IF _t IS NULL OR _t NOT IN ('pf', 'pj') THEN RETURN false; END IF;
    ELSIF _e.key IN ('locatario_endereco', 'garantia_outra') THEN
      IF _t IS NULL OR length(_t) > 300 THEN RETURN false; END IF;
    ELSIF _e.key = 'observacoes' THEN
      IF _t IS NULL OR length(_t) > 2000 THEN RETURN false; END IF;
    ELSIF _e.key = 'proprietario' THEN
      IF jsonb_typeof(_e.value) <> 'object' THEN RETURN false; END IF;
      FOR _x IN SELECT key, value FROM jsonb_each(_e.value) LOOP
        IF _x.key NOT IN ('nome', 'telefone', 'email') OR jsonb_typeof(_x.value) NOT IN ('string', 'null')
           OR length(coalesce(_x.value #>> '{}', '')) > 200 THEN
          RETURN false;
        END IF;
      END LOOP;
    ELSE
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $function$
;

CREATE OR REPLACE FUNCTION public.locacao_partes(_l public.locacoes)
 RETURNS TABLE(ordem integer, parte text, grupo text, rotulo text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT * FROM (VALUES
    (1, 'locatario',
        CASE WHEN _l.ficha->>'locatario_pessoa' = 'pj' THEN 'locatario_pj' ELSE 'locatario' END,
        CASE WHEN _l.ficha->>'locatario_pessoa' = 'pj' THEN 'Locatário PJ' ELSE 'Locatário PF' END),
    (2, _l.garantia,
        CASE WHEN _l.garantia = 'fiador' AND _l.ficha->>'fiador_pessoa' = 'pj' THEN 'fiador_pj' ELSE _l.garantia END,
        CASE _l.garantia WHEN 'fiador' THEN CASE WHEN _l.ficha->>'fiador_pessoa' = 'pj' THEN 'Fiador PJ' ELSE 'Fiador PF' END
          WHEN 'caucao' THEN 'Garantia — Caução' ELSE 'Garantia — Seguro-fiança' END),
    (3, 'proprietario',
        CASE WHEN _l.ficha->>'proprietario_pessoa' = 'pj' THEN 'proprietario_pj' ELSE 'proprietario' END,
        CASE WHEN _l.ficha->>'proprietario_pessoa' = 'pj' THEN 'Proprietário PJ' ELSE 'Proprietário PF' END)
  ) v(ordem, parte, grupo, rotulo)
$function$
;

CREATE OR REPLACE FUNCTION public.locacao_salvar_pre(_id uuid, _dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _l public.locacoes := public.locacao_pega(_id); _cand jsonb; _ficha jsonb; _cap uuid;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pre_analise'], 'corretor');
  IF _dados IS NULL OR jsonb_typeof(_dados) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_dados) k WHERE k NOT IN
     ('candidato', 'endereco', 'tipo', 'garantia', 'aluguel', 'condominio', 'iptu', 'taxa_adm', 'parceria', 'ficha', 'captador_id')) THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE = '22023';
  END IF;
  _cand := coalesce(_dados->'candidato', _l.candidato);
  IF jsonb_typeof(_cand) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(_cand) e
     WHERE e.key NOT IN ('cpf', 'nome', 'nascimento', 'telefone', 'email') OR jsonb_typeof(e.value) NOT IN ('string', 'null')
        OR length(coalesce(e.value #>> '{}', '')) > 200) THEN
    RAISE EXCEPTION 'Dados do candidato inválidos' USING ERRCODE = '22023';
  END IF;
  _ficha := CASE WHEN _dados ? 'ficha' THEN _dados->'ficha' ELSE _l.ficha END;
  IF NOT public.locacao_ficha_ok(_ficha) THEN
    RAISE EXCEPTION 'Dados da ficha inválidos' USING ERRCODE = '22023';
  END IF;
  _ficha := jsonb_strip_nulls(_ficha);
  IF _dados ? 'captador_id' THEN
    _cap := nullif(_dados->>'captador_id', '')::uuid;
    IF _cap IS NOT NULL AND NOT public.locacao_membro_ativo(_cap, _l.organization_id) THEN
      RAISE EXCEPTION 'Captador não pertence a esta imobiliária.' USING ERRCODE = '42501';
    END IF;
  ELSE
    _cap := _l.captador_id;
  END IF;
  UPDATE public.locacoes SET candidato = _cand,
    endereco = CASE WHEN _dados ? 'endereco' THEN nullif(btrim(_dados->>'endereco'), '') ELSE endereco END,
    tipo = coalesce(_dados->>'tipo', tipo), garantia = coalesce(_dados->>'garantia', garantia),
    aluguel = CASE WHEN _dados ? 'aluguel' THEN nullif((_dados->>'aluguel')::numeric, 0) ELSE aluguel END,
    condominio = coalesce((_dados->>'condominio')::numeric, condominio), iptu = coalesce((_dados->>'iptu')::numeric, iptu),
    taxa_adm = coalesce((_dados->>'taxa_adm')::numeric, taxa_adm), parceria = coalesce((_dados->>'parceria')::boolean, parceria),
    ficha = _ficha, captador_id = _cap, atualizado_em = now()
   WHERE id = _id RETURNING * INTO _l;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
  RAISE EXCEPTION 'Valor inválido na pré-análise' USING ERRCODE = '22023';
END $function$
;


DROP FUNCTION public.locacao_pre_item_matricula(public.locacoes);
DROP FUNCTION public.locacao_pre_faltando(public.locacoes);
DROP FUNCTION public.locacao_pre_parte_faltando(text, text, jsonb);
DROP FUNCTION public.locacao_data_ok(text);
DROP FUNCTION public.locacao_renda_ok(text);
DROP FUNCTION public.locacao_cpf_ok(text);
DROP FUNCTION public.locacao_garantia_rotulo(text);
COMMIT;
