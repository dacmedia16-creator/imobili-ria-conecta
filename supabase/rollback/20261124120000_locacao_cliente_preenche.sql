-- Desfaz 20261124120000_locacao_cliente_preenche. Revogar links e excluir rascunhos de clientes.
-- Os documentos já entregues ficam no bucket privado/tabela de documentos; exportar antes de executar em produção.
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
    'docs_completa', cardinality(_f) = 0,
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
CREATE OR REPLACE FUNCTION public.locacao_docs_completos_em(_l public.locacoes) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE WHEN cardinality(public.locacao_docs_faltando(_l)) = 0 THEN coalesce(
    (SELECT max(primeiro) FROM (SELECT min(d.enviado_em) AS primeiro FROM public.locacao_documentos d
      WHERE d.locacao_id = _l.id AND d.removido_em IS NULL AND NOT public.locacao_doc_opcional(d.item)
        AND d.item = ANY (public.locacao_checklist_l(_l)) GROUP BY d.item) s),
    _l.docs_completos_em, _l.criado_em) END
$$;
CREATE OR REPLACE FUNCTION public.locacao_enviar_documentacao(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _f text[];
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao'], 'corretor');
  _f := public.locacao_docs_faltando(_l);
  IF cardinality(_f) > 0 THEN
    RAISE EXCEPTION 'Faltam % documento(s): %', cardinality(_f), array_to_string(_f, '; ') USING ERRCODE = '22023';
  END IF;
  _l := public.locacao_mover(_id, 'conferencia', false, NULL);
  PERFORM public.locacao_evento(_l, 'corretor', 'Documentação completa enviada para conferência');
  RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
END $$;
DROP FUNCTION public.locacao_link_enviar(text,text);
DROP FUNCTION public.locacao_link_registrar(text,text,text,text);
DROP FUNCTION public.locacao_link_preparar(text,text,text,text);
DROP FUNCTION public.locacao_link_salvar(text,text,jsonb);
DROP FUNCTION public.locacao_link_ler(text,text);
DROP FUNCTION public.locacao_link_validar(text,text,boolean);
DROP FUNCTION public.locacao_links_emitir(uuid,text);
DROP FUNCTION public.locacao_links_lista(uuid);
DROP FUNCTION public.locacao_links_modo(uuid,text);
DROP TABLE public.locacao_link_arquivos;
DROP TABLE public.locacao_links;
DROP TABLE public.locacao_link_tentativas;
DROP TABLE public.locacao_link_modos;
COMMIT;
