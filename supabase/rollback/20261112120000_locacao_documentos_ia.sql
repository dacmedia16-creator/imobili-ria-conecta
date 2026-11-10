-- Rollback de 20261112120000_locacao_documentos_ia.sql (Locação — Documentação com leitura por IA, t_127811ca).
-- Remove só o que a migration criou: dados do contrato e selos/sugestões de leitura. Documentos, locações e o
-- histórico (locacao_eventos) ficam. As 2 funções da Fase 1 redefinidas voltam EXATAMENTE ao texto da 20261110120000.
-- ATENÇÃO: apaga os dados do contrato digitados/lidos. Em produção, exportar antes locacao_contrato_dados.
-- Reverter junto o front (PR): a tela nova chama locacao_contrato_salvar / locacao_leitura_preparar.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

DROP FUNCTION IF EXISTS public.locacao_leitura_gravar(uuid, uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.locacao_leitura_preparar(uuid);
DROP FUNCTION IF EXISTS public.locacao_contrato_salvar(uuid, jsonb);

-- Fase 1 (texto exato de 20261110120000) ------------------------------------------------------------------------
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
        'enviado_em', d.enviado_em) ORDER BY d.enviado_em), '[]')
        FROM public.locacao_documentos d WHERE d.locacao_id = _l.id AND d.removido_em IS NULL),
    'eventos', (SELECT coalesce(jsonb_agg(jsonb_build_object('em', e.em, 'etapa', e.etapa, 'papel', e.papel,
        'descricao', e.descricao, 'ator_nome', pr.nome) ORDER BY e.em, e.id), '[]')
        FROM public.locacao_eventos e LEFT JOIN public.profiles pr ON pr.id = e.ator_id WHERE e.locacao_id = _l.id));
END $$;
REVOKE ALL ON FUNCTION public.locacao_detalhe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_detalhe(uuid) TO authenticated;

-- Trava: não envia à gestora com documento pendente.
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
REVOKE ALL ON FUNCTION public.locacao_enviar_documentacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_enviar_documentacao(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.locacao_grupo_do_item(public.locacoes, text);
DROP FUNCTION IF EXISTS public.locacao_contrato_faltando(public.locacoes);
DROP FUNCTION IF EXISTS public.locacao_contrato_valores(public.locacoes);
DROP FUNCTION IF EXISTS public.locacao_exige_contrato(public.locacoes);
DROP FUNCTION IF EXISTS public.locacao_casado(text);
DROP FUNCTION IF EXISTS public.locacao_contrato_valor_ok(text, text);
DROP FUNCTION IF EXISTS public.locacao_contrato_chaves();
DROP TABLE IF EXISTS public.locacao_doc_leituras;
DROP TABLE IF EXISTS public.locacao_contrato_dados;

COMMIT;
