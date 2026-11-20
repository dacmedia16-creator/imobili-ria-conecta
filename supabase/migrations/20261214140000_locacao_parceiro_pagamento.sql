-- Locação — dados de pagamento do parceiro (corretor/imobiliária externa) na parceria. Cartão t_756c1c63 (Denis, 20/11,
-- tópico 6238). CONSTRUÇÃO EM TESTE: aplicar em produção só com a revisão do MAX Principal e o "pode publicar" de Denis.
--
-- Rollback: supabase/rollback/20261214140000_locacao_parceiro_pagamento.sql
-- Teste:    supabase/tests/run-locacao-parceiro-pagamento.sh (homologação, transação desfeita; nunca produção).
--
-- Decisões de Denis: (1) o pagamento vai para a imobiliária (CNPJ) OU direto para o corretor (CPF); (2) em parceria um
-- lado é sempre da casa e o outro do parceiro: no máximo 1 lado externo por locação.
--
-- O que muda:
--  1) locacao_lancamentos ganha parceria_lado ('captador' = lado do proprietário | 'locatario' = corretor do locatário) e
--     parceria_creci. Em parceria (RE/MAX ou externa) o lado é obrigatório; na externa passa a valer também o nome do
--     corretor parceiro. Lado 'captador' = o captador é o parceiro, então o captador da casa (captador_id) fica vazio.
--  2) Tabela NOVA locacao_parceiro_pagamento (favorecido imobiliária/CNPJ ou corretor/CPF com dígitos validados, PIX ou
--     banco/agência/conta, telefone, e-mail, emite NF). RLS ligada e SEM acesso do navegador: só pelas RPCs abaixo.
--  3) Quem lê e grava esses dados: o papel Financeiro da locação (linha explícita em locacao_papeis) e a gestão
--     (administrador, administrador principal, staff). Corretor, vistoria, gestora, contratos e o Financeiro global NÃO.
--     Nenhuma lista, detalhe, link de cliente, consulta pública ou "Consultar imóvel" lê essa tabela.
--  4) locacao_parceiros_pagar(): lista do Financeiro com os lançamentos em parceria + dados de pagamento; o valor do
--     parceiro é metade de 1 aluguel, independente da taxa. A comissão interna não muda.
-- Funções redefinidas (o rollback devolve o texto exato de produção): locacao_lancamento_ler, locacao_lancamento_salvar.
-- Locações e lançamentos existentes não mudam (colunas novas vazias; nenhum preenchimento retroativo).
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- 1) Lado do parceiro e CRECI no lançamento -----------------------------------------------------------------------
ALTER TABLE public.locacao_lancamentos
  ADD COLUMN IF NOT EXISTS parceria_lado text CONSTRAINT locacao_lancamentos_plado_check
    CHECK (parceria_lado IN ('captador', 'locatario')),
  ADD COLUMN IF NOT EXISTS parceria_creci text CONSTRAINT locacao_lancamentos_pcreci_check
    CHECK (length(parceria_creci) <= 30);

-- 2) Dados de pagamento do parceiro (sensíveis) -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.locacao_parceiro_pagamento (
  locacao_id uuid PRIMARY KEY REFERENCES public.locacao_lancamentos(locacao_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  favorecido_tipo text NOT NULL CONSTRAINT locacao_ppag_tipo_check CHECK (favorecido_tipo IN ('imobiliaria', 'corretor')),
  favorecido_nome text NOT NULL CONSTRAINT locacao_ppag_nome_check CHECK (length(favorecido_nome) BETWEEN 2 AND 200),
  documento text NOT NULL CONSTRAINT locacao_ppag_doc_check CHECK (
    (favorecido_tipo = 'corretor' AND documento ~ '^[0-9]{11}$')
    OR (favorecido_tipo = 'imobiliaria' AND documento ~ '^[0-9A-Z]{12}[0-9]{2}$')),
  pix text CONSTRAINT locacao_ppag_pix_check CHECK (length(pix) BETWEEN 3 AND 140),
  banco text CONSTRAINT locacao_ppag_banco_check CHECK (length(banco) BETWEEN 2 AND 100),
  agencia text CONSTRAINT locacao_ppag_agencia_check CHECK (length(agencia) BETWEEN 1 AND 20),
  conta text CONSTRAINT locacao_ppag_conta_check CHECK (length(conta) BETWEEN 1 AND 30),
  telefone text CONSTRAINT locacao_ppag_tel_check CHECK (length(telefone) <= 30),
  email text CONSTRAINT locacao_ppag_email_check CHECK (length(email) <= 200),
  emite_nf boolean NOT NULL,
  atualizado_por uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locacao_ppag_destino_check CHECK (pix IS NOT NULL OR (banco IS NOT NULL AND agencia IS NOT NULL AND conta IS NOT NULL))
);
ALTER TABLE public.locacao_parceiro_pagamento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locacao_parceiro_pagamento FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.locacao_parceiro_pagamento TO service_role;

-- Normaliza o CNPJ: tira pontuação e põe em maiúsculas (aceita o CNPJ alfanumérico da Receita, de 07/2026).
CREATE OR REPLACE FUNCTION public.locacao_cnpj_limpo(_v text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT upper(regexp_replace(coalesce(_v, ''), '[./ -]', '', 'g'))
$$;
REVOKE ALL ON FUNCTION public.locacao_cnpj_limpo(text) FROM PUBLIC, anon, authenticated;

-- CNPJ com dígitos verificadores (com ou sem pontuação; numérico ou alfanumérico). Par do locacao_cpf_ok.
-- Cada caractere vale (código ASCII − 48): 0–9 iguais, A=17 … Z=42; os 2 últimos são sempre números.
CREATE OR REPLACE FUNCTION public.locacao_cnpj_ok(_v text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE _d text := public.locacao_cnpj_limpo(_v); _p int[]; _s int; _r int; _n int; _i int;
BEGIN
  IF _d !~ '^[0-9A-Z]{12}[0-9]{2}$' OR _d ~ '^([0-9])\1{13}$' OR coalesce(_v, '') !~ '^[0-9A-Za-z./ -]+$' THEN RETURN false; END IF;
  FOREACH _n IN ARRAY ARRAY[12, 13] LOOP
    _p := CASE WHEN _n = 12 THEN ARRAY[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] ELSE ARRAY[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] END;
    _s := 0;
    FOR _i IN 1.._n LOOP _s := _s + (ascii(substr(_d, _i, 1)) - 48) * _p[_i]; END LOOP;
    _r := _s % 11;
    IF (CASE WHEN _r < 2 THEN 0 ELSE 11 - _r END) <> substr(_d, _n + 1, 1)::int THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.locacao_cnpj_ok(text) FROM PUBLIC, anon, authenticated;

-- Quem vê/grava os dados de pagamento: Financeiro da locação (linha explícita) ou gestão (admin, adm. principal, staff).
CREATE OR REPLACE FUNCTION public.locacao_parceiro_pag_pode(_uid uuid, _org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(_uid IS NOT NULL AND _org IS NOT NULL
    AND (public.locacao_fin_pode_regras(_uid, _org) OR public.locacao_eh_gerencia(_uid)), false)
$$;
REVOKE ALL ON FUNCTION public.locacao_parceiro_pag_pode(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.locacao_parceiro_pag_json(_p public.locacao_parceiro_pagamento) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE WHEN _p.locacao_id IS NULL THEN NULL ELSE jsonb_build_object(
    'favorecido_tipo', _p.favorecido_tipo, 'favorecido_nome', _p.favorecido_nome, 'documento', _p.documento,
    'pix', _p.pix, 'banco', _p.banco, 'agencia', _p.agencia, 'conta', _p.conta, 'telefone', _p.telefone,
    'email', _p.email, 'emite_nf', _p.emite_nf, 'atualizado_em', _p.atualizado_em,
    'atualizado_por_nome', (SELECT pr.nome FROM public.profiles pr WHERE pr.id = _p.atualizado_por)) END
$$;
REVOKE ALL ON FUNCTION public.locacao_parceiro_pag_json(public.locacao_parceiro_pagamento) FROM PUBLIC, anon, authenticated;

-- 3) Lançamento: lê e grava lado + CRECI (+ corretor parceiro também na externa) -----------------------------------
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
REVOKE ALL ON FUNCTION public.locacao_lancamento_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_lancamento_ler(uuid) TO authenticated;

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
REVOKE ALL ON FUNCTION public.locacao_lancamento_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_lancamento_salvar(uuid, jsonb) TO authenticated;

-- 4) Dados de pagamento: ler, gravar e lista do Financeiro ----------------------------------------------------------
-- Ler: quem não pode recebe {pode:false} SEM dado nenhum (a tela só esconde o quadro).
CREATE OR REPLACE FUNCTION public.locacao_parceiro_pag_ler(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _x public.locacao_lancamentos; _p public.locacao_parceiro_pagamento;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.locacoes WHERE id = _id AND organization_id = _org) THEN
    RAISE EXCEPTION 'Sem acesso a esta locação.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.locacao_parceiro_pag_pode(auth.uid(), _org) THEN
    RETURN jsonb_build_object('pode', false);
  END IF;
  SELECT * INTO _x FROM public.locacao_lancamentos WHERE locacao_id = _id;
  SELECT * INTO _p FROM public.locacao_parceiro_pagamento WHERE locacao_id = _id;
  RETURN jsonb_build_object('pode', true, 'parceria', coalesce(_x.parceria, 'nenhuma'),
    'dados', public.locacao_parceiro_pag_json(_p));
END $$;
REVOKE ALL ON FUNCTION public.locacao_parceiro_pag_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_parceiro_pag_ler(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_parceiro_pag_salvar(_id uuid, _dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _d jsonb := coalesce(_dados, '{}'::jsonb); _l public.locacoes;
  _x public.locacao_lancamentos; _tipo text; _nome text; _doc text; _pix text; _ban text; _ag text; _ct text; _tel text;
  _mail text; _nf boolean; _novo boolean;
BEGIN
  IF NOT public.locacao_parceiro_pag_pode(auth.uid(), _org) THEN
    RAISE EXCEPTION 'Só o Financeiro da locação ou a gestão registram dados de pagamento.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _l FROM public.locacoes WHERE id = _id AND organization_id = _org FOR UPDATE;
  IF _l.id IS NULL THEN RAISE EXCEPTION 'Sem acesso a esta locação.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _x FROM public.locacao_lancamentos WHERE locacao_id = _id;
  IF _x.locacao_id IS NULL OR _x.parceria = 'nenhuma' THEN
    RAISE EXCEPTION 'Esta locação não tem parceria lançada.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_d) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(_d) e WHERE e.key NOT IN
     ('favorecido_tipo', 'favorecido_nome', 'documento', 'pix', 'banco', 'agencia', 'conta', 'telefone', 'email', 'emite_nf')
      OR jsonb_typeof(e.value) NOT IN ('string', 'boolean', 'null')) THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE = '22023';
  END IF;
  _tipo := _d->>'favorecido_tipo'; _nome := nullif(btrim(coalesce(_d->>'favorecido_nome', '')), '');
  _doc := CASE WHEN _tipo = 'imobiliaria' THEN public.locacao_cnpj_limpo(_d->>'documento')
               ELSE regexp_replace(coalesce(_d->>'documento', ''), '[^0-9]', '', 'g') END;
  _pix := nullif(btrim(coalesce(_d->>'pix', '')), ''); _ban := nullif(btrim(coalesce(_d->>'banco', '')), '');
  _ag := nullif(btrim(coalesce(_d->>'agencia', '')), ''); _ct := nullif(btrim(coalesce(_d->>'conta', '')), '');
  _tel := nullif(btrim(coalesce(_d->>'telefone', '')), ''); _mail := nullif(btrim(coalesce(_d->>'email', '')), '');
  IF _tipo IS NULL OR _tipo NOT IN ('imobiliaria', 'corretor') THEN
    RAISE EXCEPTION 'Informe o favorecido: imobiliária (CNPJ) ou corretor (CPF).' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(_nome, '')) < 2 THEN RAISE EXCEPTION 'Informe o nome do favorecido.' USING ERRCODE = '22023'; END IF;
  IF _tipo = 'corretor' AND NOT public.locacao_cpf_ok(coalesce(_d->>'documento', '')) THEN
    RAISE EXCEPTION 'CPF do corretor inválido.' USING ERRCODE = '22023';
  END IF;
  IF _tipo = 'imobiliaria' AND NOT public.locacao_cnpj_ok(coalesce(_d->>'documento', '')) THEN
    RAISE EXCEPTION 'CNPJ da imobiliária inválido.' USING ERRCODE = '22023';
  END IF;
  IF _pix IS NULL AND (_ban IS NULL OR _ag IS NULL OR _ct IS NULL) THEN
    RAISE EXCEPTION 'Informe o PIX ou banco, agência e conta.' USING ERRCODE = '22023';
  END IF;
  IF _mail IS NOT NULL AND _mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'E-mail inválido.' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(_d->'emite_nf') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'Informe se o favorecido emite nota fiscal.' USING ERRCODE = '22023';
  END IF;
  _nf := (_d->>'emite_nf')::boolean;
  _novo := NOT EXISTS (SELECT 1 FROM public.locacao_parceiro_pagamento WHERE locacao_id = _id);
  INSERT INTO public.locacao_parceiro_pagamento AS p (locacao_id, organization_id, favorecido_tipo, favorecido_nome, documento,
    pix, banco, agencia, conta, telefone, email, emite_nf, atualizado_por)
  VALUES (_id, _org, _tipo, _nome, _doc, _pix, _ban, _ag, _ct, _tel, _mail, _nf, auth.uid())
  ON CONFLICT (locacao_id) DO UPDATE SET favorecido_tipo = EXCLUDED.favorecido_tipo, favorecido_nome = EXCLUDED.favorecido_nome,
    documento = EXCLUDED.documento, pix = EXCLUDED.pix, banco = EXCLUDED.banco, agencia = EXCLUDED.agencia, conta = EXCLUDED.conta,
    telefone = EXCLUDED.telefone, email = EXCLUDED.email, emite_nf = EXCLUDED.emite_nf,
    atualizado_por = auth.uid(), atualizado_em = now();
  -- Histórico SEM o documento, PIX ou conta (o histórico é visto por quem acompanha a locação).
  PERFORM public.locacao_evento(_l, 'financeiro', 'Dados de pagamento do parceiro ' || CASE WHEN _novo THEN 'registrados' ELSE 'atualizados' END
    || ' (favorecido: ' || CASE _tipo WHEN 'imobiliaria' THEN 'imobiliária' ELSE 'corretor' END || ')');
  RETURN jsonb_build_object('ok', true, 'novo', _novo);
EXCEPTION WHEN invalid_text_representation OR check_violation OR string_data_right_truncation THEN
  RAISE EXCEPTION 'Valor inválido nos dados de pagamento' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.locacao_parceiro_pag_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_parceiro_pag_salvar(uuid, jsonb) TO authenticated;

-- Lista do Financeiro: lançamentos em parceria. O parceiro recebe 1/2 aluguel (não a comissão nem a administração).
CREATE OR REPLACE FUNCTION public.locacao_parceiros_pagar() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx();
BEGIN
  IF NOT public.locacao_parceiro_pag_pode(auth.uid(), _org) THEN
    RAISE EXCEPTION 'Só o Financeiro da locação ou a gestão veem os pagamentos de parceiros.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'config', to_jsonb(public.locacao_cfg(_org)) - 'organization_id' - 'atualizado_por',
    'itens', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'codigo', 'LOC-' || lpad(l.numero::text, 4, '0'), 'endereco', l.endereco, 'chave_em', l.chave_em,
        'etapa', l.etapa, 'situacao', l.situacao, 'aluguel', x.aluguel, 'taxa_adm', x.taxa_adm,
        'valor_parceiro', round(x.aluguel / 2, 2), 'parceria', x.parceria,
        'parceria_lado', x.parceria_lado, 'parceria_unidade', x.parceria_unidade, 'parceria_imobiliaria', x.parceria_imobiliaria,
        'parceria_corretor', x.parceria_corretor, 'parceria_creci', x.parceria_creci,
        'pagamento', public.locacao_parceiro_pag_json(p))
        ORDER BY l.chave_em DESC NULLS LAST, l.numero DESC), '[]')
      FROM public.locacao_lancamentos x
      JOIN public.locacoes l ON l.id = x.locacao_id AND l.organization_id = _org
      LEFT JOIN public.locacao_parceiro_pagamento p ON p.locacao_id = x.locacao_id
     WHERE x.organization_id = _org AND x.parceria <> 'nenhuma'));
END $$;
REVOKE ALL ON FUNCTION public.locacao_parceiros_pagar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_parceiros_pagar() TO authenticated;

COMMIT;
