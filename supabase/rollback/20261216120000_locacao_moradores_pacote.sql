-- Rollback de 20261216120000_locacao_moradores_pacote (t_40cff7e4).
-- Devolve o texto EXATO de produção (pg_get_functiondef lido em 20/11/2026, já com o lote 2) de locacao_checklist_l,
-- locacao_partes_json, locacao_contrato_salvar, locacao_detalhe e locacao_documento_ver e remove o que a migration criou.
-- ATENÇÃO: apaga a ficha de moradores e o registro de downloads do pacote. As cópias de RG já anexadas continuam em
-- locacao_documentos/bucket (só deixam de ser exigidas). O texto "moradores" do contrato continua como estava.
-- Faça backup (backup-prod.sh) antes de rodar em ambiente com dados.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);
CREATE OR REPLACE FUNCTION public.locacao_checklist_l(_l locacoes)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce(array_agg(x ORDER BY o), ARRAY[]::text[]) FROM (
    SELECT i.x, min(p.ordem * 1000 + i.n) AS o
      FROM public.locacao_partes(_l) p,
           LATERAL unnest(public.locacao_docs_grupo(_l.organization_id, p.grupo)) WITH ORDINALITY i(x, n)
     GROUP BY i.x) s
$function$;
CREATE OR REPLACE FUNCTION public.locacao_partes_json(_l locacoes)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object('parte', p.parte, 'grupo', p.grupo, 'rotulo', p.rotulo,
      'itens', (SELECT coalesce(jsonb_agg(jsonb_build_object('item', i.x, 'obrigatorio', NOT public.locacao_doc_opcional(i.x),
          'entregue', EXISTS (SELECT 1 FROM public.locacao_documentos d WHERE d.locacao_id = _l.id AND d.item = i.x
                                AND d.removido_em IS NULL)) ORDER BY i.n), '[]'::jsonb)
        FROM unnest(public.locacao_docs_grupo(_l.organization_id, p.grupo)) WITH ORDINALITY i(x, n)))
    ORDER BY p.ordem), '[]'::jsonb)
    FROM public.locacao_partes(_l) p
$function$;
CREATE OR REPLACE FUNCTION public.locacao_contrato_salvar(_id uuid, _dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _l public.locacoes := public.locacao_pega(_id); _e record; _val jsonb; _ori jsonb; _t text; _n integer := 0;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao'], 'corretor');
  IF _dados IS NULL OR jsonb_typeof(_dados) <> 'object' THEN RAISE EXCEPTION 'Dados inválidos' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.locacao_contrato_dados (locacao_id, organization_id) VALUES (_l.id, _l.organization_id)
  ON CONFLICT (locacao_id) DO NOTHING;
  SELECT valores, origem INTO _val, _ori FROM public.locacao_contrato_dados WHERE locacao_id = _l.id FOR UPDATE;
  FOR _e IN SELECT key, value FROM jsonb_each(_dados) LOOP
    IF NOT (_e.key = ANY (public.locacao_contrato_chaves())) OR jsonb_typeof(_e.value) NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'Campo inválido: %', left(_e.key, 40) USING ERRCODE = '22023';
    END IF;
    _t := nullif(btrim(coalesce(_e.value #>> '{}', '')), '');
    IF NOT public.locacao_contrato_valor_ok(_e.key, _t) THEN
      RAISE EXCEPTION 'Valor inválido em %', _e.key USING ERRCODE = '22023';
    END IF;
    IF _t IS NULL THEN
      _val := _val - _e.key; _ori := _ori - _e.key;
    ELSE
      _val := _val || jsonb_build_object(_e.key, _t);
      _ori := _ori || jsonb_build_object(_e.key, jsonb_build_object('o', 'manual'));
    END IF;
    _n := _n + 1;
  END LOOP;
  UPDATE public.locacao_contrato_dados SET valores = _val, origem = _ori, atualizado_em = now(), atualizado_por = auth.uid()
   WHERE locacao_id = _l.id;
  IF _n > 0 THEN PERFORM public.locacao_evento(_l, 'corretor', 'Dados do contrato salvos (' || _n || ' campo(s))'); END IF;
  RETURN jsonb_build_object('ok', true, 'campos', _n, 'faltando', to_jsonb(public.locacao_contrato_faltando(
    (SELECT x FROM public.locacoes x WHERE x.id = _l.id))));
END $function$;
CREATE OR REPLACE FUNCTION public.locacao_detalhe(_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.locacao_ctx(); _l public.locacoes; _f text[]; _pf boolean;
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id AND organization_id = _org;
  IF _l.id IS NULL OR NOT public.locacao_pode_ver(_l) THEN
    RAISE EXCEPTION 'Sem acesso a esta locação.' USING ERRCODE = '42501';
  END IF;
  _f := public.locacao_docs_faltando(_l);
  _pf := public.locacao_finais_pode_ver(_l);
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
    -- Documentos finais (t_dfc8daf2): a existência de cada tipo vai para todos (trava na tela); arquivos, envios e
    -- telefones só para quem pode ver (corretor da locação, gestora, contratos, vistoria, gerência).
    'finais_tem', CASE WHEN _pf THEN jsonb_build_object('contrato_locacao', public.locacao_final_tem(_l.id, 'contrato_locacao'),
      'contrato_adm', public.locacao_final_tem(_l.id, 'contrato_adm'), 'laudo', public.locacao_final_tem(_l.id, 'laudo')) END,
    'finais_pode', _pf,
    'finais_tel', CASE WHEN _pf THEN jsonb_build_object(
      'locatario', public.locacao_final_tel_ok(public.locacao_final_telefone(_l, 'locatario')),
      'proprietario', public.locacao_final_tel_ok(public.locacao_final_telefone(_l, 'proprietario'))) END,
    'finais', CASE WHEN _pf THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'tipo', f.tipo,
        'nome_arquivo', f.nome_arquivo, 'enviado_em', f.enviado_em, 'enviado_por_nome', pr.nome,
        'envios', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'destinatario', e.destinatario,
            'origem', e.origem, 'status', e.status, 'erro', e.erro, 'telefone_final', e.telefone_final,
            'criado_em', e.criado_em, 'solicitado_por_nome', ps.nome) ORDER BY e.criado_em DESC), '[]')
            FROM public.locacao_docs_finais_envios e LEFT JOIN public.profiles ps ON ps.id = e.solicitado_por
           WHERE e.doc_final_id = f.id)) ORDER BY f.enviado_em DESC), '[]')
        FROM public.locacao_docs_finais f LEFT JOIN public.profiles pr ON pr.id = f.enviado_por WHERE f.locacao_id = _l.id)
      ELSE '[]'::jsonb END,
    'andamentos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'etapa', a.etapa, 'texto', a.texto,
        'aguardando', a.aguardando, 'criado_em', a.criado_em, 'criado_por_nome', pc.nome, 'resolvido_em', a.resolvido_em,
        'resolvido_por_nome', pr.nome, 'resolucao', a.resolucao) ORDER BY a.criado_em DESC), '[]')
        FROM public.locacao_andamentos a LEFT JOIN public.profiles pc ON pc.id = a.criado_por
        LEFT JOIN public.profiles pr ON pr.id = a.resolvido_por WHERE a.locacao_id = _l.id),
    'eventos', (SELECT coalesce(jsonb_agg(jsonb_build_object('em', e.em, 'etapa', e.etapa, 'papel', e.papel,
        'descricao', e.descricao, 'ator_nome', pr.nome) ORDER BY e.em, e.id), '[]')
        FROM public.locacao_eventos e LEFT JOIN public.profiles pr ON pr.id = e.ator_id WHERE e.locacao_id = _l.id));
END $function$;
CREATE OR REPLACE FUNCTION public.locacao_documento_ver(_doc uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.locacao_ctx(); _d public.locacao_documentos; _l public.locacoes;
BEGIN
  SELECT * INTO _d FROM public.locacao_documentos WHERE id = _doc AND organization_id = _org AND removido_em IS NULL;
  SELECT * INTO _l FROM public.locacoes WHERE id = _d.locacao_id;
  IF _d.id IS NULL OR _l.id IS NULL OR NOT public.locacao_pode_ver(_l) THEN
    RAISE EXCEPTION 'Sem acesso a este documento.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('path', _d.storage_path, 'nome', _d.nome_arquivo);
END $function$;
DROP TRIGGER locacao_zz_moradores_ref ON public.locacoes;
DROP FUNCTION public.locacao_trg_moradores_ref();
DROP FUNCTION public.locacao_pacote_registrar(uuid);
DROP FUNCTION public.locacao_pacote_preparar(uuid);
DROP FUNCTION public.locacao_moradores_salvar(uuid, jsonb);
DROP FUNCTION public.locacao_moradores_ler(uuid);
DROP FUNCTION public.locacao_partes_sem_rg(jsonb);
DROP FUNCTION public.locacao_morador_pode(public.locacoes);
DROP FUNCTION public.locacao_morador_itens(public.locacoes);
DROP FUNCTION public.locacao_morador_ref(public.locacoes);
DROP FUNCTION public.locacao_moradores_texto(jsonb);
DROP FUNCTION public.locacao_cpf_mascara(text);
DROP FUNCTION public.locacao_eh_rg_morador(text);
DROP FUNCTION public.locacao_morador_item(text);
DROP FUNCTION public.locacao_morador_adulto(text, date);
DROP FUNCTION public.locacao_hoje_sp();
DROP TABLE public.locacao_pacote_downloads;
DROP TABLE public.locacao_moradores;
ALTER TABLE public.locacoes DROP COLUMN moradores_ficha;
COMMIT;
