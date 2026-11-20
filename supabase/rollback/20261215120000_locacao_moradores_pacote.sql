-- Rollback de 20261215120000_locacao_moradores_pacote (t_40cff7e4).
-- Devolve o texto EXATO de produção (pg_get_functiondef lido em 20/11/2026) de locacao_checklist_l,
-- locacao_partes_json e locacao_contrato_salvar e remove o que a migration criou.
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
DROP FUNCTION public.locacao_pacote_registrar(uuid);
DROP FUNCTION public.locacao_pacote_preparar(uuid);
DROP FUNCTION public.locacao_moradores_salvar(uuid, jsonb);
DROP FUNCTION public.locacao_moradores_ler(uuid);
DROP FUNCTION public.locacao_morador_pode(public.locacoes);
DROP FUNCTION public.locacao_morador_itens(public.locacoes);
DROP FUNCTION public.locacao_moradores_texto(jsonb);
DROP FUNCTION public.locacao_morador_item(text);
DROP FUNCTION public.locacao_morador_adulto(text);
DROP TABLE public.locacao_pacote_downloads;
DROP TABLE public.locacao_moradores;
ALTER TABLE public.locacoes DROP COLUMN moradores_ficha;
COMMIT;
