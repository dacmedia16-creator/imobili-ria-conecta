-- Locação "Sem administração" (pedido de Denis, tópico 6238, 20/11/2026). Cartão t_ec2962bd.
-- CONSTRUÇÃO EM TESTE: aplicar em produção só depois da revisão do MAX Principal e do "pode publicar" de Denis.
--
-- Rollback: supabase/rollback/20261211120000_locacao_sem_administracao.sql
-- Teste:    supabase/tests/run-locacao-sem-administracao.sh (homologação, transação desfeita; nunca produção).
--
-- Regra (Denis): sem administração a imobiliária cobra 1 aluguel (100% do 1º aluguel) de intermediação. A comissão segue
-- a mesma divisão (coordenador, corretor, parceria ÷ 2); só a base do lado da casa passa a ser 100% do aluguel (isso é
-- calculado no site, em calcularComissao).
--
-- O que muda (mínimo):
--  1) locacoes.sem_administracao (padrão false). Sem administração grava taxa_adm = 0 de forma explícita; com
--     administração continua exigindo taxa entre >0 e 30. Locações existentes não mudam (todas ficam "com").
--  2) locacao_lancamentos.sem_administracao (padrão false), com a mesma regra da taxa.
--  3) locacao_salvar_pre aceita "sem_administracao". Sem: taxa 0. Voltando para "com" sem informar taxa: 10%.
--  4) locacao_lancamento_salvar/ler aceitam e devolvem "sem_administracao"; sem administração não cobra a taxa.
--     Locação e lançamento ficam sempre iguais: antes da chave, a escolha da Fernanda também atualiza a locação;
--     depois da chave, trocar com/sem pelo lançamento é recusado (o Financeiro já foi definido na entrega da chave).
--     Sem a chave no pedido (site antigo), mantém o valor atual.
--  5) locacao_lista leva "sem_administracao" do lançamento (aba Comissão).
--  6) locacao_fin_criar_contrato NÃO cria contrato no Financeiro para locação sem administração: sem cobrança mensal,
--     sem repasse e sem taxa de administração.
-- Funções redefinidas (o rollback devolve o texto exato anterior): locacao_salvar_pre, locacao_lancamento_ler,
--   locacao_lancamento_salvar, locacao_lista, locacao_fin_criar_contrato.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- 1) e 2) Colunas e regra da taxa ---------------------------------------------------------------------------------
ALTER TABLE public.locacoes ADD COLUMN sem_administracao boolean NOT NULL DEFAULT false;
ALTER TABLE public.locacoes DROP CONSTRAINT locacoes_taxa_check;
ALTER TABLE public.locacoes ADD CONSTRAINT locacoes_taxa_check CHECK (
  (sem_administracao AND taxa_adm = 0) OR (NOT sem_administracao AND taxa_adm > 0 AND taxa_adm <= 30));

ALTER TABLE public.locacao_lancamentos ADD COLUMN sem_administracao boolean NOT NULL DEFAULT false;
ALTER TABLE public.locacao_lancamentos DROP CONSTRAINT locacao_lancamentos_taxa_check;
ALTER TABLE public.locacao_lancamentos ADD CONSTRAINT locacao_lancamentos_taxa_check CHECK (
  (sem_administracao AND taxa_adm = 0) OR (NOT sem_administracao AND taxa_adm > 0 AND taxa_adm <= 30));

-- 3) Pré-análise --------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_salvar_pre(_id uuid, _dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _cand jsonb; _ficha jsonb; _cap uuid; _sem boolean;
  _antes boolean := _l.sem_administracao;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pre_analise'], 'corretor');
  IF _dados IS NULL OR jsonb_typeof(_dados) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_dados) k WHERE k NOT IN
     ('candidato', 'endereco', 'tipo', 'garantia', 'aluguel', 'condominio', 'iptu', 'taxa_adm', 'parceria', 'ficha', 'captador_id',
      'sem_administracao')) THEN
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
  -- t_ec2962bd: sem administração grava taxa 0 explícita; voltando para "com" sem taxa informada, 10%.
  _sem := CASE WHEN _dados ? 'sem_administracao' THEN coalesce((_dados->>'sem_administracao')::boolean, false)
               ELSE _l.sem_administracao END;
  UPDATE public.locacoes SET candidato = _cand,
    endereco = CASE WHEN _dados ? 'endereco' THEN nullif(btrim(_dados->>'endereco'), '') ELSE endereco END,
    tipo = coalesce(_dados->>'tipo', tipo), garantia = coalesce(_dados->>'garantia', garantia),
    aluguel = CASE WHEN _dados ? 'aluguel' THEN nullif((_dados->>'aluguel')::numeric, 0) ELSE aluguel END,
    condominio = coalesce((_dados->>'condominio')::numeric, condominio), iptu = coalesce((_dados->>'iptu')::numeric, iptu),
    taxa_adm = CASE WHEN _sem THEN 0
                    ELSE coalesce((_dados->>'taxa_adm')::numeric, CASE WHEN sem_administracao THEN 10 ELSE taxa_adm END) END,
    sem_administracao = _sem, parceria = coalesce((_dados->>'parceria')::boolean, parceria),
    ficha = _ficha, captador_id = _cap, atualizado_em = now()
   WHERE id = _id RETURNING * INTO _l;
  IF _l.sem_administracao IS DISTINCT FROM _antes THEN
    PERFORM public.locacao_evento(_l, 'corretor', CASE WHEN _l.sem_administracao
      THEN 'Marcada sem administração (intermediação: 1 aluguel)' ELSE 'Marcada com administração (taxa '
        || trim(to_char(_l.taxa_adm, 'FM990.99')) || '%)' END);
  END IF;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
  RAISE EXCEPTION 'Valor inválido na pré-análise' USING ERRCODE = '22023';
END $$;

-- 4) Lançamento para comissão (Fernanda) ---------------------------------------------------------------------------
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
        'sem_administracao', _x.sem_administracao)
      ELSE jsonb_build_object(
        'captador_id', _l.captador_id, 'locador', nullif(btrim(coalesce(_l.ficha#>>'{proprietario,nome}', '')), ''),
        'gestor_id', _l.equipe_gestor_id, 'team_leader_id', _l.equipe_tl_id, 'aluguel', _l.aluguel, 'taxa_adm', _l.taxa_adm,
        'parceria', CASE WHEN _l.parceria THEN 'externa' ELSE 'nenhuma' END, 'sem_administracao', _l.sem_administracao) END,
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
  _novo boolean; _k text; _sem boolean;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pos_assinatura', 'chaves', 'comissao'], 'vistoria');
  IF jsonb_typeof(_d) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(_d) e WHERE e.key NOT IN
     ('captador_id', 'locador', 'gestor_id', 'team_leader_id', 'aluguel', 'taxa_adm', 'parceria', 'parceria_unidade',
      'parceria_corretor', 'parceria_imobiliaria', 'observacao', 'sem_administracao')
      OR jsonb_typeof(e.value) NOT IN ('string', 'number', 'null')
         AND NOT (e.key = 'sem_administracao' AND jsonb_typeof(e.value) = 'boolean')) THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE = '22023';
  END IF;
  FOREACH _k IN ARRAY ARRAY['captador_id', 'gestor_id', 'team_leader_id'] LOOP
    IF nullif(_d->>_k, '') IS NOT NULL AND NOT public.locacao_membro_ativo((_d->>_k)::uuid, _l.organization_id) THEN
      RAISE EXCEPTION 'Pessoa fora desta imobiliária.' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  _cap := nullif(_d->>'captador_id', '')::uuid; _ge := nullif(_d->>'gestor_id', '')::uuid; _tl := nullif(_d->>'team_leader_id', '')::uuid;
  _alu := nullif(_d->>'aluguel', '')::numeric; _tx := nullif(_d->>'taxa_adm', '')::numeric;
  -- Sem a chave (ex.: aba com o site antigo), mantém o que já estava (lançamento ou, se não houver, a locação).
  _sem := CASE WHEN _d ? 'sem_administracao' THEN coalesce(nullif(_d->>'sem_administracao', '')::boolean, false)
               ELSE coalesce((SELECT x.sem_administracao FROM public.locacao_lancamentos x WHERE x.locacao_id = _id),
                             _l.sem_administracao) END;
  _par := coalesce(nullif(_d->>'parceria', ''), 'nenhuma');
  _loc := nullif(btrim(coalesce(_d->>'locador', '')), ''); _obs := nullif(btrim(coalesce(_d->>'observacao', '')), '');
  _uni := nullif(btrim(coalesce(_d->>'parceria_unidade', '')), ''); _pco := nullif(btrim(coalesce(_d->>'parceria_corretor', '')), '');
  _pim := nullif(btrim(coalesce(_d->>'parceria_imobiliaria', '')), '');
  IF _alu IS NULL OR _alu <= 0 THEN RAISE EXCEPTION 'Informe o aluguel.' USING ERRCODE = '22023'; END IF;
  -- t_ec2962bd: sem administração não cobra taxa (grava 0); com administração, taxa entre >0 e 30.
  IF _sem THEN _tx := 0;
  ELSIF _tx IS NULL OR _tx <= 0 OR _tx > 30 THEN RAISE EXCEPTION 'Informe a taxa de administração (até 30%%).' USING ERRCODE = '22023'; END IF;
  IF _par NOT IN ('nenhuma', 'remax', 'externa') THEN RAISE EXCEPTION 'Parceria inválida.' USING ERRCODE = '22023'; END IF;
  IF _par = 'remax' AND (length(coalesce(_uni, '')) < 2 OR length(coalesce(_pco, '')) < 2) THEN
    RAISE EXCEPTION 'Parceria RE/MAX: informe a unidade e o corretor parceiro.' USING ERRCODE = '22023';
  END IF;
  IF _par = 'externa' AND length(coalesce(_pim, '')) < 2 THEN
    RAISE EXCEPTION 'Parceria externa: informe a imobiliária parceira.' USING ERRCODE = '22023';
  END IF;
  IF _par <> 'remax' THEN _uni := NULL; _pco := NULL; END IF;
  IF _par <> 'externa' THEN _pim := NULL; END IF;
  -- Locação e lançamento não podem divergir na administração (o Financeiro segue a locação).
  -- Antes da chave: a escolha da Fernanda vale também para a locação. Depois da chave: não muda mais aqui.
  IF _sem IS DISTINCT FROM _l.sem_administracao THEN
    IF _l.chave_em IS NOT NULL THEN
      RAISE EXCEPTION 'Chaves já entregues: com/sem administração não muda mais pelo lançamento (fale com o Financeiro).'
        USING ERRCODE = '22023';
    END IF;
    UPDATE public.locacoes SET sem_administracao = _sem, taxa_adm = CASE WHEN _sem THEN 0 ELSE _tx END, atualizado_em = now()
     WHERE id = _id;
  END IF;
  _novo := NOT EXISTS (SELECT 1 FROM public.locacao_lancamentos WHERE locacao_id = _id);
  INSERT INTO public.locacao_lancamentos AS x (locacao_id, organization_id, captador_id, locador, gestor_id, team_leader_id, aluguel,
    taxa_adm, sem_administracao, parceria, parceria_unidade, parceria_corretor, parceria_imobiliaria, observacao, lancado_por, atualizado_por)
  VALUES (_id, _l.organization_id, _cap, _loc, _ge, _tl, _alu, _tx, _sem, _par, _uni, _pco, _pim, _obs, auth.uid(), auth.uid())
  ON CONFLICT (locacao_id) DO UPDATE SET captador_id = EXCLUDED.captador_id, locador = EXCLUDED.locador,
    gestor_id = EXCLUDED.gestor_id, team_leader_id = EXCLUDED.team_leader_id, aluguel = EXCLUDED.aluguel, taxa_adm = EXCLUDED.taxa_adm,
    sem_administracao = EXCLUDED.sem_administracao,
    parceria = EXCLUDED.parceria, parceria_unidade = EXCLUDED.parceria_unidade, parceria_corretor = EXCLUDED.parceria_corretor,
    parceria_imobiliaria = EXCLUDED.parceria_imobiliaria, observacao = EXCLUDED.observacao,
    atualizado_por = auth.uid(), atualizado_em = now();
  PERFORM public.locacao_evento(_l, 'vistoria', 'Lançamento para comissão ' || CASE WHEN _novo THEN 'registrado' ELSE 'atualizado' END
    || ': aluguel ' || public.locacao_fin_brl(_alu) || ', '
    || CASE WHEN _sem THEN 'sem administração (intermediação: 1 aluguel)' ELSE 'taxa ' || trim(to_char(_tx, 'FM990.99')) || '%' END
    || ', parceria '
    || CASE _par WHEN 'nenhuma' THEN 'nenhuma' WHEN 'remax' THEN 'RE/MAX (' || _uni || ')' ELSE 'externa (' || _pim || ')' END);
  RETURN jsonb_build_object('ok', true, 'novo', _novo);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
  RAISE EXCEPTION 'Valor inválido no lançamento' USING ERRCODE = '22023';
END $$;

-- 5) Lista (aba Comissão) -----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_lista() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx();
BEGIN
  RETURN (SELECT coalesce(jsonb_agg((public.locacao_json(l) - 'ficha') || jsonb_build_object(
      -- t_8f09d406: complemento (bloco/apto) e valores lançados pela Fernanda para a aba Comissão.
      'complemento', nullif(btrim(coalesce(l.ficha->>'complemento', '')), ''),
      'lancamento', (SELECT jsonb_build_object('aluguel', x.aluguel, 'taxa_adm', x.taxa_adm, 'parceria', x.parceria,
          'sem_administracao', x.sem_administracao, 'atualizado_em', x.atualizado_em)
          FROM public.locacao_lancamentos x WHERE x.locacao_id = l.id))
      ORDER BY l.etapa_desde), '[]')
            FROM public.locacoes l WHERE l.organization_id = _org AND public.locacao_pode_ver(l));
END $$;

-- 6) Financeiro: sem administração não nasce contrato (sem cobrança, repasse nem taxa) -------------------------------
CREATE OR REPLACE FUNCTION public.locacao_fin_criar_contrato(_l public.locacoes) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cfg public.locacao_fin_config := public.locacao_fin_cfg(_l.organization_id); _id uuid;
BEGIN
  IF _l.chave_em IS NULL OR _l.aluguel IS NULL THEN RETURN NULL; END IF;
  -- t_ec2962bd: locação só de intermediação (sem administração) não entra no Financeiro.
  IF _l.sem_administracao THEN RETURN NULL; END IF;
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
END $$;

COMMIT;
