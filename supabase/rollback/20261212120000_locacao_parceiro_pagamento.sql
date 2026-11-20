-- Rollback da 20261212120000_locacao_parceiro_pagamento (t_756c1c63).
-- Devolve o texto exato (lido da produção em 20/11/2026) de locacao_lancamento_ler e locacao_lancamento_salvar e apaga
-- o que a migration criou. ATENÇÃO: apaga junto os dados de pagamento de parceiros gravados depois da publicação
-- (tabela locacao_parceiro_pagamento) e as colunas parceria_lado/parceria_creci dos lançamentos.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);
DROP FUNCTION IF EXISTS public.locacao_parceiros_pagar();
DROP FUNCTION IF EXISTS public.locacao_parceiro_pag_salvar(uuid, jsonb);
DROP FUNCTION IF EXISTS public.locacao_parceiro_pag_ler(uuid);
DROP FUNCTION IF EXISTS public.locacao_parceiro_pag_json(public.locacao_parceiro_pagamento);
DROP FUNCTION IF EXISTS public.locacao_parceiro_pag_pode(uuid, uuid);
DROP FUNCTION IF EXISTS public.locacao_cnpj_ok(text);
DROP TABLE IF EXISTS public.locacao_parceiro_pagamento;

CREATE OR REPLACE FUNCTION public.locacao_lancamento_ler(_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.locacao_ctx(); _l public.locacoes; _x public.locacao_lancamentos;
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id AND organization_id = _org;
  IF _l.id IS NULL OR NOT public.locacao_pode_ver(_l) THEN
    RAISE EXCEPTION 'Sem acesso a esta locação.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _x FROM public.locacao_lancamentos WHERE locacao_id = _id;
  RETURN jsonb_build_object(
    'pode_editar', _l.situacao = 'ativa' AND _l.etapa IN ('pos_assinatura', 'chaves', 'comissao')
                   AND public.locacao_tem_papel(auth.uid(), 'vistoria'),
    'lancado', _x.locacao_id IS NOT NULL,
    'valores', CASE WHEN _x.locacao_id IS NOT NULL THEN jsonb_build_object(
        'captador_id', _x.captador_id, 'locador', _x.locador, 'gestor_id', _x.gestor_id, 'team_leader_id', _x.team_leader_id,
        'aluguel', _x.aluguel, 'taxa_adm', _x.taxa_adm, 'parceria', _x.parceria, 'parceria_unidade', _x.parceria_unidade,
        'parceria_corretor', _x.parceria_corretor, 'parceria_imobiliaria', _x.parceria_imobiliaria, 'observacao', _x.observacao)
      ELSE jsonb_build_object(
        'captador_id', _l.captador_id, 'locador', nullif(btrim(coalesce(_l.ficha#>>'{proprietario,nome}', '')), ''),
        'gestor_id', _l.equipe_gestor_id, 'team_leader_id', _l.equipe_tl_id, 'aluguel', _l.aluguel, 'taxa_adm', _l.taxa_adm,
        'parceria', CASE WHEN _l.parceria THEN 'externa' ELSE 'nenhuma' END) END,
    'nomes', jsonb_build_object(
      'captador', (SELECT p.nome FROM public.profiles p WHERE p.id = coalesce(_x.captador_id, CASE WHEN _x.locacao_id IS NULL THEN _l.captador_id END)),
      'gestor', (SELECT p.nome FROM public.profiles p WHERE p.id = coalesce(_x.gestor_id, CASE WHEN _x.locacao_id IS NULL THEN _l.equipe_gestor_id END)),
      'team_leader', (SELECT p.nome FROM public.profiles p WHERE p.id = coalesce(_x.team_leader_id, CASE WHEN _x.locacao_id IS NULL THEN _l.equipe_tl_id END))),
    'lancado_por_nome', (SELECT p.nome FROM public.profiles p WHERE p.id = coalesce(_x.atualizado_por, _x.lancado_por)),
    'atualizado_em', _x.atualizado_em);
END $function$;

REVOKE ALL ON FUNCTION public.locacao_lancamento_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_lancamento_ler(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_lancamento_salvar(_id uuid, _dados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _l public.locacoes := public.locacao_pega(_id); _d jsonb := coalesce(_dados, '{}'::jsonb);
  _cap uuid; _ge uuid; _tl uuid; _alu numeric; _tx numeric; _par text; _uni text; _pco text; _pim text; _loc text; _obs text;
  _novo boolean; _k text;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pos_assinatura', 'chaves', 'comissao'], 'vistoria');
  IF jsonb_typeof(_d) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(_d) e WHERE e.key NOT IN
     ('captador_id', 'locador', 'gestor_id', 'team_leader_id', 'aluguel', 'taxa_adm', 'parceria', 'parceria_unidade',
      'parceria_corretor', 'parceria_imobiliaria', 'observacao') OR jsonb_typeof(e.value) NOT IN ('string', 'number', 'null')) THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE = '22023';
  END IF;
  FOREACH _k IN ARRAY ARRAY['captador_id', 'gestor_id', 'team_leader_id'] LOOP
    IF nullif(_d->>_k, '') IS NOT NULL AND NOT public.locacao_membro_ativo((_d->>_k)::uuid, _l.organization_id) THEN
      RAISE EXCEPTION 'Pessoa fora desta imobiliária.' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  _cap := nullif(_d->>'captador_id', '')::uuid; _ge := nullif(_d->>'gestor_id', '')::uuid; _tl := nullif(_d->>'team_leader_id', '')::uuid;
  _alu := nullif(_d->>'aluguel', '')::numeric; _tx := nullif(_d->>'taxa_adm', '')::numeric;
  _par := coalesce(nullif(_d->>'parceria', ''), 'nenhuma');
  _loc := nullif(btrim(coalesce(_d->>'locador', '')), ''); _obs := nullif(btrim(coalesce(_d->>'observacao', '')), '');
  _uni := nullif(btrim(coalesce(_d->>'parceria_unidade', '')), ''); _pco := nullif(btrim(coalesce(_d->>'parceria_corretor', '')), '');
  _pim := nullif(btrim(coalesce(_d->>'parceria_imobiliaria', '')), '');
  IF _alu IS NULL OR _alu <= 0 THEN RAISE EXCEPTION 'Informe o aluguel.' USING ERRCODE = '22023'; END IF;
  IF _tx IS NULL OR _tx <= 0 OR _tx > 30 THEN RAISE EXCEPTION 'Informe a taxa de administração (até 30%%).' USING ERRCODE = '22023'; END IF;
  IF _par NOT IN ('nenhuma', 'remax', 'externa') THEN RAISE EXCEPTION 'Parceria inválida.' USING ERRCODE = '22023'; END IF;
  IF _par = 'remax' AND (length(coalesce(_uni, '')) < 2 OR length(coalesce(_pco, '')) < 2) THEN
    RAISE EXCEPTION 'Parceria RE/MAX: informe a unidade e o corretor parceiro.' USING ERRCODE = '22023';
  END IF;
  IF _par = 'externa' AND length(coalesce(_pim, '')) < 2 THEN
    RAISE EXCEPTION 'Parceria externa: informe a imobiliária parceira.' USING ERRCODE = '22023';
  END IF;
  IF _par <> 'remax' THEN _uni := NULL; _pco := NULL; END IF;
  IF _par <> 'externa' THEN _pim := NULL; END IF;
  _novo := NOT EXISTS (SELECT 1 FROM public.locacao_lancamentos WHERE locacao_id = _id);
  INSERT INTO public.locacao_lancamentos AS x (locacao_id, organization_id, captador_id, locador, gestor_id, team_leader_id, aluguel,
    taxa_adm, parceria, parceria_unidade, parceria_corretor, parceria_imobiliaria, observacao, lancado_por, atualizado_por)
  VALUES (_id, _l.organization_id, _cap, _loc, _ge, _tl, _alu, _tx, _par, _uni, _pco, _pim, _obs, auth.uid(), auth.uid())
  ON CONFLICT (locacao_id) DO UPDATE SET captador_id = EXCLUDED.captador_id, locador = EXCLUDED.locador,
    gestor_id = EXCLUDED.gestor_id, team_leader_id = EXCLUDED.team_leader_id, aluguel = EXCLUDED.aluguel, taxa_adm = EXCLUDED.taxa_adm,
    parceria = EXCLUDED.parceria, parceria_unidade = EXCLUDED.parceria_unidade, parceria_corretor = EXCLUDED.parceria_corretor,
    parceria_imobiliaria = EXCLUDED.parceria_imobiliaria, observacao = EXCLUDED.observacao,
    atualizado_por = auth.uid(), atualizado_em = now();
  PERFORM public.locacao_evento(_l, 'vistoria', 'Lançamento para comissão ' || CASE WHEN _novo THEN 'registrado' ELSE 'atualizado' END
    || ': aluguel ' || public.locacao_fin_brl(_alu) || ', taxa ' || trim(to_char(_tx, 'FM990.99')) || '%, parceria '
    || CASE _par WHEN 'nenhuma' THEN 'nenhuma' WHEN 'remax' THEN 'RE/MAX (' || _uni || ')' ELSE 'externa (' || _pim || ')' END);
  RETURN jsonb_build_object('ok', true, 'novo', _novo);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
  RAISE EXCEPTION 'Valor inválido no lançamento' USING ERRCODE = '22023';
END $function$;

REVOKE ALL ON FUNCTION public.locacao_lancamento_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_lancamento_salvar(uuid, jsonb) TO authenticated;

ALTER TABLE public.locacao_lancamentos DROP COLUMN IF EXISTS parceria_creci, DROP COLUMN IF EXISTS parceria_lado;
COMMIT;
