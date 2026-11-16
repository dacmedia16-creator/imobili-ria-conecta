-- Desfaz 20261130120000_locacao_minuta_anexada (t_f8f83f9f). Rodar em transação, DEPOIS de voltar o código do site.
-- 1) locacao_contratos_acao, locacao_detalhe, locacao_cfg e locacao_corretor_minuta voltam com o texto exato de antes.
-- 2) As funções novas da minuta e do andamento saem.
-- 3) As tabelas locacao_minutas e locacao_andamentos só são apagadas se estiverem VAZIAS. Se já houver minuta ou
--    andamento registrado, elas ficam (RLS ligada, sem acesso pelo navegador) e os arquivos continuam no bucket:
--    nada do que a equipe registrou é perdido.
-- 4) O bucket volta a aceitar só PDF/imagem e o padrão do dia de 16 a 31 volta para 6. Nenhum arquivo é tocado.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- locacao_contratos_acao: texto de 20261124130000_locacao_pre_aprovacao.sql
CREATE OR REPLACE FUNCTION public.locacao_contratos_acao(_id uuid, _acao text, _dados jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
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
        public.locacao_garantia_rotulo(_l.garantia));
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

-- locacao_detalhe: texto de 20261124120000_locacao_cliente_preenche.sql
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

-- locacao_cfg: texto de 20261113120000_locacao_ficha_checklist.sql
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
  ELSE
    _c.documentos := (SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                        FROM jsonb_each(public.locacao_docs_padrao()) e WHERE right(e.key, 3) = '_pj') || _c.documentos;
  END IF;
  RETURN _c;
END $$;

-- locacao_corretor_minuta: texto de 20261110120000_locacao_fase1.sql
CREATE OR REPLACE FUNCTION public.locacao_corretor_minuta(_id uuid, _acao text, _texto text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _m jsonb; _t text := nullif(btrim(coalesce(_texto, '')), '');
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['minuta'], 'corretor');
  _m := _l.minuta;
  IF _acao = 'resolver_pendencia' AND _m->>'estado' = 'pendencia' THEN
    _m := _m || jsonb_build_object('estado', 'elaborando', 'pendencia', NULL);
    PERFORM public.locacao_evento(_l, 'corretor', 'Pendência resolvida' || coalesce(': ' || _t, ''));
  ELSIF _acao = 'de_acordo' AND _m->>'estado' = 'com_corretor' THEN
    _m := _m || jsonb_build_object('estado', 'aprovada');
    PERFORM public.locacao_evento(_l, 'corretor', 'Corretor/proprietário de acordo com a minuta');
  ELSIF _acao = 'pedir_ajuste' AND _m->>'estado' = 'com_corretor' THEN
    IF _t IS NULL OR length(_t) < 5 THEN RAISE EXCEPTION 'Descreva o ajuste pedido.' USING ERRCODE = '22023'; END IF;
    _m := _m || jsonb_build_object('estado', 'ajuste', 'ajuste_data', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
      'ajuste_motivo', left(_t, 500));
    PERFORM public.locacao_evento(_l, 'corretor', 'Minuta EM AJUSTE (pedido do proprietário): ' || _t);
  ELSE
    RAISE EXCEPTION 'Ação não disponível agora.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.locacoes SET minuta = _m, etapa_desde = now(), atualizado_em = now() WHERE id = _id;
  RETURN jsonb_build_object('ok', true);
END $$;

DROP FUNCTION IF EXISTS public.locacao_minuta_preparar(uuid, text);
DROP FUNCTION IF EXISTS public.locacao_minuta_registrar(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.locacao_minuta_ver(uuid);
DROP FUNCTION IF EXISTS public.locacao_andamento_registrar(uuid, text, text);
DROP FUNCTION IF EXISTS public.locacao_andamento_resolver(uuid, text);
DROP FUNCTION IF EXISTS public.locacao_minuta_atual(uuid);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.locacao_minutas) THEN DROP TABLE public.locacao_minutas;
  ELSE RAISE NOTICE 'locacao_minutas tem registros: tabela mantida (sem acesso pelo navegador).'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.locacao_andamentos) THEN DROP TABLE public.locacao_andamentos;
  ELSE RAISE NOTICE 'locacao_andamentos tem registros: tabela mantida (sem acesso pelo navegador).'; END IF;
END $$;

UPDATE storage.buckets SET allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'locacao-documentos';
ALTER TABLE public.locacao_config ALTER COLUMN dia_pagamento_16a31 SET DEFAULT 6;
COMMIT;
