-- Rollback da 20261215120000_locacao_sem_administracao (t_ec2962bd). Rodar em transação, DEPOIS de voltar o site.
-- 1) As 5 funções voltam com o texto exato lido em produção em 20/11/2026 (conferido por md5 no
--    run-locacao-sem-administracao.sh).
-- 2) Locações/lançamentos marcados "sem administração" voltam a ser "com administração" com taxa 10% (o CHECK antigo
--    não aceita taxa 0). Antes, em produção, listar quem muda:
--      SELECT id, numero FROM public.locacoes WHERE sem_administracao;
--      SELECT locacao_id FROM public.locacao_lancamentos WHERE sem_administracao;
--    Locação sem administração que já entregou a chave fica SEM contrato no Financeiro (nada é criado no rollback).
--    ATENÇÃO: uma locação "sem" que ainda NÃO entregou a chave volta como "com 10%"; na entrega da chave nasceria
--    contrato cobrando 10% de administração. Antes do rollback, combinar com o Financeiro o que fazer com elas.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

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
     WHERE e.key NOT IN ('cpf', 'nome', 'nascimento', 'telefone', 'email', 'renda') OR jsonb_typeof(e.value) NOT IN ('string', 'null')
        OR length(coalesce(e.value #>> '{}', '')) > 200
        OR (e.key = 'renda' AND coalesce(e.value #>> '{}', '') <> '' AND NOT public.locacao_renda_ok(e.value #>> '{}'))) THEN
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
END $function$;

CREATE OR REPLACE FUNCTION public.locacao_lancamento_ler(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
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
        'parceria_corretor', _x.parceria_corretor, 'parceria_imobiliaria', _x.parceria_imobiliaria, 'observacao', _x.observacao,
        -- t_756c1c63: lado do parceiro e CRECI (não sensíveis; dados de pagamento ficam em locacao_parceiro_pag_ler).
        'parceria_lado', _x.parceria_lado, 'parceria_creci', _x.parceria_creci)
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
END $$;

CREATE OR REPLACE FUNCTION public.locacao_lancamento_salvar(_id uuid, _dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _d jsonb := coalesce(_dados, '{}'::jsonb);
  _cap uuid; _ge uuid; _tl uuid; _alu numeric; _tx numeric; _par text; _uni text; _pco text; _pim text; _loc text; _obs text;
  _lado text; _creci text; _novo boolean; _k text; _ant public.locacao_lancamentos;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pos_assinatura', 'chaves', 'comissao'], 'vistoria');
  IF jsonb_typeof(_d) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(_d) e WHERE e.key NOT IN
     ('captador_id', 'locador', 'gestor_id', 'team_leader_id', 'aluguel', 'taxa_adm', 'parceria', 'parceria_unidade',
      'parceria_corretor', 'parceria_imobiliaria', 'observacao', 'parceria_lado', 'parceria_creci')
      OR jsonb_typeof(e.value) NOT IN ('string', 'number', 'null')) THEN
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
  _lado := nullif(btrim(coalesce(_d->>'parceria_lado', '')), ''); _creci := nullif(btrim(coalesce(_d->>'parceria_creci', '')), '');
  IF _alu IS NULL OR _alu <= 0 THEN RAISE EXCEPTION 'Informe o aluguel.' USING ERRCODE = '22023'; END IF;
  IF _tx IS NULL OR _tx <= 0 OR _tx > 30 THEN RAISE EXCEPTION 'Informe a taxa de administração (até 30%%).' USING ERRCODE = '22023'; END IF;
  IF _par NOT IN ('nenhuma', 'remax', 'externa') THEN RAISE EXCEPTION 'Parceria inválida.' USING ERRCODE = '22023'; END IF;
  IF _par = 'remax' AND (length(coalesce(_uni, '')) < 2 OR length(coalesce(_pco, '')) < 2) THEN
    RAISE EXCEPTION 'Parceria RE/MAX: informe a unidade e o corretor parceiro.' USING ERRCODE = '22023';
  END IF;
  IF _par = 'externa' AND length(coalesce(_pim, '')) < 2 THEN
    RAISE EXCEPTION 'Parceria externa: informe a imobiliária parceira.' USING ERRCODE = '22023';
  END IF;
  -- t_756c1c63: em parceria, um lado é da casa e o outro do parceiro (no máximo 1 lado externo).
  IF _par <> 'nenhuma' AND (_lado IS NULL OR _lado NOT IN ('captador', 'locatario')) THEN
    RAISE EXCEPTION 'Parceria: informe qual lado é do parceiro (captador ou corretor do locatário).' USING ERRCODE = '22023';
  END IF;
  IF _par = 'nenhuma' THEN _lado := NULL; _creci := NULL; END IF;
  -- Lado do proprietário com o parceiro: o captador não é da casa.
  IF _lado = 'captador' THEN _cap := NULL; END IF;
  IF _par = 'nenhuma' THEN _pco := NULL; END IF;
  IF _par <> 'remax' THEN _uni := NULL; END IF;
  IF _par <> 'externa' THEN _pim := NULL; END IF;
  SELECT * INTO _ant FROM public.locacao_lancamentos WHERE locacao_id = _id;
  _novo := _ant.locacao_id IS NULL;
  INSERT INTO public.locacao_lancamentos AS x (locacao_id, organization_id, captador_id, locador, gestor_id, team_leader_id, aluguel,
    taxa_adm, parceria, parceria_unidade, parceria_corretor, parceria_imobiliaria, observacao, parceria_lado, parceria_creci,
    lancado_por, atualizado_por)
  VALUES (_id, _l.organization_id, _cap, _loc, _ge, _tl, _alu, _tx, _par, _uni, _pco, _pim, _obs, _lado, _creci, auth.uid(), auth.uid())
  ON CONFLICT (locacao_id) DO UPDATE SET captador_id = EXCLUDED.captador_id, locador = EXCLUDED.locador,
    gestor_id = EXCLUDED.gestor_id, team_leader_id = EXCLUDED.team_leader_id, aluguel = EXCLUDED.aluguel, taxa_adm = EXCLUDED.taxa_adm,
    parceria = EXCLUDED.parceria, parceria_unidade = EXCLUDED.parceria_unidade, parceria_corretor = EXCLUDED.parceria_corretor,
    parceria_imobiliaria = EXCLUDED.parceria_imobiliaria, observacao = EXCLUDED.observacao,
    parceria_lado = EXCLUDED.parceria_lado, parceria_creci = EXCLUDED.parceria_creci,
    atualizado_por = auth.uid(), atualizado_em = now();
  -- Sem parceria não há a quem pagar (LGPD); se o parceiro mudou (tipo, imobiliária/unidade, corretor ou lado), os dados
  -- antigos não valem mais: apaga para o Financeiro não pagar a pessoa errada. Histórico sem os dados.
  IF NOT _novo AND (_par = 'nenhuma' OR _ant.parceria IS DISTINCT FROM _par OR _ant.parceria_imobiliaria IS DISTINCT FROM _pim
     OR _ant.parceria_unidade IS DISTINCT FROM _uni OR _ant.parceria_corretor IS DISTINCT FROM _pco
     OR _ant.parceria_lado IS DISTINCT FROM _lado) THEN
    DELETE FROM public.locacao_parceiro_pagamento WHERE locacao_id = _id;
    IF FOUND THEN
      PERFORM public.locacao_evento(_l, 'vistoria', 'Dados de pagamento do parceiro removidos (parceria alterada no lançamento)');
    END IF;
  END IF;
  PERFORM public.locacao_evento(_l, 'vistoria', 'Lançamento para comissão ' || CASE WHEN _novo THEN 'registrado' ELSE 'atualizado' END
    || ': aluguel ' || public.locacao_fin_brl(_alu) || ', taxa ' || trim(to_char(_tx, 'FM990.99')) || '%, parceria '
    || CASE _par WHEN 'nenhuma' THEN 'nenhuma' WHEN 'remax' THEN 'RE/MAX (' || _uni || ')' ELSE 'externa (' || _pim || ')' END
    || CASE _lado WHEN 'captador' THEN ', lado do parceiro: captador' WHEN 'locatario' THEN ', lado do parceiro: locatário' ELSE '' END);
  RETURN jsonb_build_object('ok', true, 'novo', _novo);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
  RAISE EXCEPTION 'Valor inválido no lançamento' USING ERRCODE = '22023';
END $$;

CREATE OR REPLACE FUNCTION public.locacao_lista()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.locacao_ctx();
BEGIN
  RETURN (SELECT coalesce(jsonb_agg((public.locacao_json(l) - 'ficha') || jsonb_build_object(
      -- t_8f09d406: complemento (bloco/apto) e valores lançados pela Fernanda para a aba Comissão.
      'complemento', nullif(btrim(coalesce(l.ficha->>'complemento', '')), ''),
      'lancamento', (SELECT jsonb_build_object('aluguel', x.aluguel, 'taxa_adm', x.taxa_adm, 'parceria', x.parceria,
          'atualizado_em', x.atualizado_em) FROM public.locacao_lancamentos x WHERE x.locacao_id = l.id))
      ORDER BY l.etapa_desde), '[]')
            FROM public.locacoes l WHERE l.organization_id = _org AND public.locacao_pode_ver(l));
END $function$;

CREATE OR REPLACE FUNCTION public.locacao_fin_criar_contrato(_l public.locacoes)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _cfg public.locacao_fin_config := public.locacao_fin_cfg(_l.organization_id); _id uuid;
BEGIN
  IF _l.chave_em IS NULL OR _l.aluguel IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.locacao_contratos (organization_id, locacao_id, endereco, inquilino_nome, garantia, aluguel, taxa_adm,
    condominio, iptu, dia_vencimento, inicio, proximo_reajuste, indice)
  VALUES (_l.organization_id, _l.id, _l.endereco, nullif(btrim(coalesce(_l.candidato->>'nome', '')), ''), _l.garantia,
    _l.aluguel, _l.taxa_adm, _l.condominio, _l.iptu, least(28, extract(day FROM _l.chave_em)::integer), _l.chave_em,
    (_l.chave_em + interval '1 year')::date, _cfg.indice)
  ON CONFLICT (locacao_id) DO NOTHING RETURNING id INTO _id;
  IF _id IS NOT NULL THEN
    INSERT INTO public.locacao_fin_eventos (organization_id, contrato_id, acao, descricao, ator_id)
    VALUES (_l.organization_id, _id, 'contrato_criado', 'Contrato criado na entrega das chaves (' ||
      to_char(_l.chave_em, 'DD/MM/YYYY') || ') — aguardando o Financeiro completar e ativar', auth.uid());
  END IF;
  RETURN _id;
END $function$;


-- A regra nova é derrubada ANTES de trocar a taxa (senão "sem administração + taxa 10" é recusado).
ALTER TABLE public.locacao_lancamentos DROP CONSTRAINT locacao_lancamentos_taxa_check;
UPDATE public.locacao_lancamentos SET taxa_adm = 10 WHERE sem_administracao;
ALTER TABLE public.locacao_lancamentos DROP COLUMN sem_administracao;
ALTER TABLE public.locacao_lancamentos ADD CONSTRAINT locacao_lancamentos_taxa_check CHECK (taxa_adm > 0 AND taxa_adm <= 30);

ALTER TABLE public.locacoes DROP CONSTRAINT locacoes_taxa_check;
UPDATE public.locacoes SET taxa_adm = 10 WHERE sem_administracao;
ALTER TABLE public.locacoes DROP COLUMN sem_administracao;
ALTER TABLE public.locacoes ADD CONSTRAINT locacoes_taxa_check CHECK (taxa_adm > 0 AND taxa_adm <= 30);
COMMIT;
