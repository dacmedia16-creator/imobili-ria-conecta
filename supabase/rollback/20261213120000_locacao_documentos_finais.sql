-- Reverte 20261213120000_locacao_documentos_finais; rode só após retirar o frontend novo.
BEGIN;
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
        'nome_arquivo', v.nome_arquivo, 'enviado_em', v.enviado_em, 'enviado_por_nome', pr.nome,
        'modelo_chave', v.modelo_chave, 'modelo_versao', v.modelo_versao)
        ORDER BY v.versao DESC), '[]')
        FROM public.locacao_minutas v LEFT JOIN public.profiles pr ON pr.id = v.enviado_por WHERE v.locacao_id = _l.id),
    'anexos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'tipo', x.tipo, 'nome_arquivo', x.nome_arquivo,
        'numero', x.numero, 'enviado_em', x.enviado_em, 'enviado_por_nome', pr.nome) ORDER BY x.enviado_em DESC), '[]')
        FROM public.locacao_anexos x LEFT JOIN public.profiles pr ON pr.id = x.enviado_por WHERE x.locacao_id = _l.id),
    'apolice_pendente', _l.garantia = 'seguro_fianca' AND NOT public.locacao_tem_apolice(_l.id),
    'andamentos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'etapa', a.etapa, 'texto', a.texto,
        'aguardando', a.aguardando, 'criado_em', a.criado_em, 'criado_por_nome', pc.nome, 'resolvido_em', a.resolvido_em,
        'resolvido_por_nome', pr.nome, 'resolucao', a.resolucao) ORDER BY a.criado_em DESC), '[]')
        FROM public.locacao_andamentos a LEFT JOIN public.profiles pc ON pc.id = a.criado_por
        LEFT JOIN public.profiles pr ON pr.id = a.resolvido_por WHERE a.locacao_id = _l.id),
    'eventos', (SELECT coalesce(jsonb_agg(jsonb_build_object('em', e.em, 'etapa', e.etapa, 'papel', e.papel,
        'descricao', e.descricao, 'ator_nome', pr.nome) ORDER BY e.em, e.id), '[]')
        FROM public.locacao_eventos e LEFT JOIN public.profiles pr ON pr.id = e.ator_id WHERE e.locacao_id = _l.id));
END $$;

CREATE OR REPLACE FUNCTION public.locacao_contratos_acao(_id uuid, _acao text, _dados jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _m jsonb; _a jsonb; _t text; _doc text; _f text[];
  _mv public.locacao_minutas;
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
    -- Sem arquivo de minuta guardado no sistema, o corretor não teria o que conferir nem a assinatura o que enviar.
    _mv := public.locacao_minuta_atual(_l.id);
    IF _mv.id IS NULL THEN
      RAISE EXCEPTION '%', CASE WHEN _acao = 'enviar_minuta'
        THEN 'Envio travado: anexe a minuta (PDF ou Word) ou use "Gerar e guardar" antes de enviar ao corretor.'
        ELSE 'Assinatura travada: anexe o arquivo da minuta antes de preparar a assinatura'
          || CASE WHEN coalesce((_m->>'externa')::boolean, false) THEN ' (vale também para a minuta pronta de outra RE/MAX).'
             ELSE '.' END END USING ERRCODE = '22023';
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
    _m := _m || jsonb_build_object('estado', 'com_corretor', 'versao_enviada', _mv.versao,
      'modelo', CASE WHEN _l.tipo = 'comercial' THEN 'Comercial' ELSE 'Residencial' END || ' — ' ||
        public.locacao_garantia_rotulo(_l.garantia));
    PERFORM public.locacao_evento(_l, 'contratos', 'Minuta v' || _mv.versao || ' enviada ao corretor ('
      || _mv.nome_arquivo || CASE WHEN coalesce((_m->>'externa')::boolean, false) THEN ', de outra RE/MAX' ELSE '' END || ')');
  ELSIF _acao = 'marcar_ajuste' THEN
    _m := _m || jsonb_build_object('estado', 'ajuste', 'ajuste_data', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
      'ajuste_motivo', coalesce(left(_t, 500), 'Pedido do proprietário'));
    PERFORM public.locacao_evento(_l, 'contratos', 'Minuta EM AJUSTE: ' || coalesce(_t, 'pedido do proprietário'));
  ELSIF _acao = 'preparar_assinatura' THEN
    IF coalesce(_m->>'estado', '') <> 'aprovada' AND NOT coalesce((_m->>'externa')::boolean, false) THEN
      RAISE EXCEPTION 'A minuta ainda não foi aprovada pelo corretor/proprietário.' USING ERRCODE = '22023';
    END IF;
    _m := _m || jsonb_build_object('estado', 'aprovada', 'versao_assinatura', _mv.versao);
    UPDATE public.locacoes SET minuta = _m, assinatura = jsonb_build_object('adm', 'nao', 'loc', 'nao', 'vist', 'nao',
      'vist_junto', false, 'modo', 'manual') WHERE id = _id;
    _l := public.locacao_mover(_id, 'assinatura', false, NULL);
    PERFORM public.locacao_evento(_l, 'contratos', 'Minuta v' || _mv.versao || ' aprovada — preparando assinatura');
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
    IF _l.garantia = 'seguro_fianca' AND NOT public.locacao_tem_apolice(_l.id) THEN
      RAISE EXCEPTION 'Apólice pendente — anexe para liberar a entrega de chaves.' USING ERRCODE = '22023';
    END IF;
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

REVOKE ALL ON FUNCTION public.locacao_final_reservar(uuid,text,text,uuid), public.locacao_final_concluir(uuid,text,text) FROM service_role;
DROP FUNCTION public.locacao_final_reservar(uuid,text,text,uuid), public.locacao_final_concluir(uuid,text,text);
DROP FUNCTION public.locacao_final_registrar(uuid,text,text,text,text), public.locacao_final_preparar(uuid,text), public.locacao_final_ver(uuid);
DROP FUNCTION public.locacao_final_destinos(text), public.locacao_final_tel_ok(text), public.locacao_final_telefone(public.locacoes,text), public.locacao_final_tem(uuid,text), public.locacao_final_exige(public.locacoes,text), public.locacao_finais_pode_ver(public.locacoes);
DROP TABLE public.locacao_docs_finais_envios;
DROP TABLE public.locacao_docs_finais;
-- Arquivos no bucket locacao-documentos/finais não são excluídos por SQL; apagar com API Storage, após inventário.
COMMIT;
