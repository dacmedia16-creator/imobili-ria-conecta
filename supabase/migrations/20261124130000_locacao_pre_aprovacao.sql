-- Locação — PRÉ-APROVAÇÃO da gestora (Paloma) com campos por garantia + 2 modos (corretor preenche / link do cliente).
-- Maquete aprovada por Denis em 13/11/2026 (telas seguro.png e fiador.png, tópico 6238). Cartão t_b2ce1207.
-- Empilhada sobre 20261124120000_locacao_cliente_preenche (PR #316): reaproveita a tabela de tentativas (rate limit).
-- CONSTRUÇÃO EM TESTE: aplicar em produção só com o "pode publicar" de Denis.
--
-- Rollback: supabase/rollback/20261124130000_locacao_pre_aprovacao.sql
-- Teste:    supabase/tests/run-locacao-pre-aprovacao.sh (homologação, transação desfeita; nunca produção).
--
-- O que muda:
--  * Garantias: além de fiador, caução e seguro-fiança, passam a existir loft (antiga CredPago),
--    titulo_capitalizacao e outras (caucionamento / outras). As locações e os contratos que já existem não mudam.
--  * Envio à gestora: pede SÓ os dados da pré-aprovação, conforme a garantia. Nenhum anexo é obrigatório:
--      todas            → imóvel: CEP, endereço, aluguel (condomínio e IPTU: a tela exige preencher, 0 = não tem)
--      seguro, loft, título, outras → locatário: CPF (válido), nome completo, nascimento, telefone, e-mail
--      caução           → idem + renda do locatário
--      fiador           → idem + renda do locatário; fiador: nome completo, CPF (válido), renda e nº da matrícula
--      outras           → observação obrigatória (qual garantia). Loft/título: observação livre e opcional.
--    Os documentos completos continuam sendo cobrados só na Documentação, depois da aprovação.
--  * Anexo da matrícula do fiador (OPCIONAL) já na pré-aprovação: vira o documento do item "matrícula" da lista
--    do fiador da imobiliária, para não ser pedido de novo na Documentação.
--  * Link do cliente na pré-aprovação: escopo PRÓPRIO (tabelas locacao_pre_*). O token da pré-aprovação não existe
--    na tabela da Documentação e vice-versa; cada lado só vale na sua etapa. Mesmas proteções do PR #316:
--    token aleatório de 256 bits (só o hash SHA-256 é salvo), 7 dias, novo link invalida o anterior, limite por IP,
--    cliente vê só a sua parte e nenhum valor da negociação, envio trava a edição, o corretor confere e envia.
-- Funções redefinidas (o rollback devolve o texto exato anterior, conferido por md5 na homologação):
--   locacao_ficha_ok, locacao_salvar_pre, locacao_enviar_pre, locacao_partes, locacao_contratos_acao,
--   locacao_config_salvar, locacao_documento_preparar, locacao_documento_registrar, locacao_documento_remover.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- 1) Garantias novas (aditivo: as três de antes continuam válidas) ---------------------------------------------------
ALTER TABLE public.locacoes DROP CONSTRAINT locacoes_garantia_check;
ALTER TABLE public.locacoes ADD CONSTRAINT locacoes_garantia_check CHECK (garantia IN
  ('fiador', 'caucao', 'seguro_fianca', 'loft', 'titulo_capitalizacao', 'outras'));
ALTER TABLE public.locacao_contratos DROP CONSTRAINT locacao_contratos_garantia_check;
ALTER TABLE public.locacao_contratos ADD CONSTRAINT locacao_contratos_garantia_check CHECK (garantia IN
  ('fiador', 'caucao', 'seguro_fianca', 'loft', 'titulo_capitalizacao', 'outras'));

-- 2) Regras puras (espelho de src/lib/locacao.ts; os testes conferem as duas listas) --------------------------------
CREATE FUNCTION public.locacao_garantia_rotulo(_g text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE _g WHEN 'fiador' THEN 'Fiador' WHEN 'caucao' THEN 'Caução' WHEN 'seguro_fianca' THEN 'Seguro-fiança'
    WHEN 'loft' THEN 'Loft (antiga CredPago)' WHEN 'titulo_capitalizacao' THEN 'Título de capitalização'
    WHEN 'outras' THEN 'Caucionamento / outras' ELSE coalesce(_g, '') END
$$;

-- CPF com dígitos verificadores (aceita com ou sem pontuação). Espelho de cpfValido().
CREATE FUNCTION public.locacao_cpf_ok(_v text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE _d text := regexp_replace(coalesce(_v, ''), '[^0-9]', '', 'g'); _s integer; _r integer; _i integer;
BEGIN
  IF coalesce(_v, '') !~ '^[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}$' OR _d ~ '^([0-9])\1{10}$' THEN RETURN false; END IF;
  FOR _n IN 9..10 LOOP
    _s := 0;
    FOR _i IN 1.._n LOOP _s := _s + substr(_d, _i, 1)::integer * (_n + 2 - _i); END LOOP;
    _r := (_s * 10) % 11;
    IF _r = 10 THEN _r := 0; END IF;
    IF _r <> substr(_d, _n + 1, 1)::integer THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

-- Valor em reais guardado como texto "1234.56" (renda). Espelho de rendaOk().
CREATE FUNCTION public.locacao_renda_ok(_v text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT coalesce(_v ~ '^[0-9]{1,9}([.][0-9]{1,2})?$' AND _v::numeric > 0, false)
$$;

CREATE FUNCTION public.locacao_data_ok(_v text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE _d date;
BEGIN
  IF coalesce(_v, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
  BEGIN _d := _v::date; EXCEPTION WHEN others THEN RETURN false; END;
  RETURN to_char(_d, 'YYYY-MM-DD') = _v AND _d BETWEEN DATE '1900-01-01' AND DATE '2100-12-31';
END $$;

-- O que falta de UMA parte (locatario | fiador) para a garantia. Mesma ordem e texto de faltasParte().
CREATE FUNCTION public.locacao_pre_parte_faltando(_parte text, _garantia text, _d jsonb) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE _f text[] := ARRAY[]::text[]; _x jsonb := coalesce(_d, '{}'::jsonb);
BEGIN
  IF _parte = 'locatario' THEN
    IF NOT public.locacao_cpf_ok(btrim(coalesce(_x->>'cpf', ''))) THEN _f := array_append(_f, 'CPF do locatário'); END IF;
    IF length(btrim(coalesce(_x->>'nome', ''))) < 5 THEN _f := array_append(_f, 'nome completo do locatário'); END IF;
    IF NOT public.locacao_data_ok(_x->>'nascimento') THEN _f := array_append(_f, 'data de nascimento do locatário'); END IF;
    IF length(regexp_replace(coalesce(_x->>'telefone', ''), '[^0-9]', '', 'g')) < 10 THEN
      _f := array_append(_f, 'telefone do locatário');
    END IF;
    IF coalesce(_x->>'email', '') !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' THEN
      _f := array_append(_f, 'e-mail do locatário');
    END IF;
    IF _garantia IN ('caucao', 'fiador') AND NOT public.locacao_renda_ok(_x->>'renda') THEN
      _f := array_append(_f, 'renda do locatário');
    END IF;
  ELSIF _parte = 'fiador' AND _garantia = 'fiador' THEN
    IF length(btrim(coalesce(_x->>'nome', ''))) < 5 THEN _f := array_append(_f, 'nome completo do fiador'); END IF;
    IF NOT public.locacao_cpf_ok(btrim(coalesce(_x->>'cpf', ''))) THEN _f := array_append(_f, 'CPF do fiador'); END IF;
    IF NOT public.locacao_renda_ok(_x->>'renda') THEN _f := array_append(_f, 'renda do fiador'); END IF;
    IF btrim(coalesce(_x->>'matricula', '')) = '' THEN _f := array_append(_f, 'nº da matrícula do imóvel do fiador'); END IF;
  END IF;
  RETURN _f;
END $$;

-- Tudo o que falta para enviar a pré-aprovação à gestora (somente dados; nenhum anexo).
CREATE FUNCTION public.locacao_pre_faltando(_l public.locacoes) RETURNS text[]
LANGUAGE plpgsql STABLE SET search_path TO '' AS $$
DECLARE _f text[] := ARRAY[]::text[];
BEGIN
  IF coalesce(_l.ficha->>'cep', '') !~ '^[0-9]{5}-?[0-9]{3}$' THEN _f := array_append(_f, 'CEP'); END IF;
  IF length(btrim(coalesce(_l.endereco, ''))) < 8 THEN _f := array_append(_f, 'endereço do imóvel'); END IF;
  IF _l.aluguel IS NULL THEN _f := array_append(_f, 'aluguel'); END IF;
  _f := _f || public.locacao_pre_parte_faltando('locatario', _l.garantia, _l.candidato);
  _f := _f || public.locacao_pre_parte_faltando('fiador', _l.garantia, _l.ficha->'fiador');
  IF _l.garantia = 'outras' AND length(btrim(coalesce(_l.ficha->>'garantia_outra', ''))) < 3 THEN
    _f := array_append(_f, 'observação da garantia');
  END IF;
  RETURN _f;
END $$;

-- Item da lista do fiador que recebe o anexo opcional da matrícula (null = garantia sem fiador ou lista sem item).
CREATE FUNCTION public.locacao_pre_item_matricula(_l public.locacoes) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE WHEN _l.garantia = 'fiador' THEN (
    SELECT x FROM unnest(public.locacao_docs_grupo(_l.organization_id,
        CASE WHEN _l.ficha->>'fiador_pessoa' = 'pj' THEN 'fiador_pj' ELSE 'fiador' END)) WITH ORDINALITY t(x, n)
     WHERE x ~* 'matr[ií]cula' ORDER BY n LIMIT 1) END
$$;

REVOKE ALL ON FUNCTION public.locacao_garantia_rotulo(text), public.locacao_cpf_ok(text), public.locacao_renda_ok(text),
  public.locacao_data_ok(text), public.locacao_pre_parte_faltando(text, text, jsonb), public.locacao_pre_faltando(public.locacoes),
  public.locacao_pre_item_matricula(public.locacoes) FROM PUBLIC, anon, authenticated;

-- 3) Ficha: CEP do imóvel e dados do fiador da pré-aprovação ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_ficha_ok(_f jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE _e record; _x record; _t text;
BEGIN
  IF _f IS NULL OR jsonb_typeof(_f) <> 'object' THEN RETURN false; END IF;
  FOR _e IN SELECT key, value FROM jsonb_each(_f) LOOP
    CONTINUE WHEN jsonb_typeof(_e.value) = 'null';
    _t := CASE WHEN jsonb_typeof(_e.value) = 'string' THEN _e.value #>> '{}' END;
    IF _e.key = 'imovel_id' THEN
      IF _t IS NULL OR length(_t) > 40 THEN RETURN false; END IF;
    ELSIF _e.key = 'mobilia' THEN
      IF _t IS NULL OR _t NOT IN ('mobiliado', 'semi', 'sem') THEN RETURN false; END IF;
    ELSIF _e.key = 'metragem' THEN
      IF jsonb_typeof(_e.value) <> 'number' OR (_e.value)::text::numeric <= 0 OR (_e.value)::text::numeric >= 1000000 THEN
        RETURN false;
      END IF;
    ELSIF _e.key IN ('locatario_pessoa', 'proprietario_pessoa', 'fiador_pessoa') THEN
      IF _t IS NULL OR _t NOT IN ('pf', 'pj') THEN RETURN false; END IF;
    ELSIF _e.key IN ('locatario_endereco', 'garantia_outra') THEN
      IF _t IS NULL OR length(_t) > 300 THEN RETURN false; END IF;
    ELSIF _e.key = 'observacoes' THEN
      IF _t IS NULL OR length(_t) > 2000 THEN RETURN false; END IF;
    ELSIF _e.key = 'cep' THEN
      IF _t IS NULL OR _t !~ '^[0-9]{5}-?[0-9]{3}$' THEN RETURN false; END IF;
    ELSIF _e.key = 'proprietario' THEN
      IF jsonb_typeof(_e.value) <> 'object' THEN RETURN false; END IF;
      FOR _x IN SELECT key, value FROM jsonb_each(_e.value) LOOP
        IF _x.key NOT IN ('nome', 'telefone', 'email') OR jsonb_typeof(_x.value) NOT IN ('string', 'null')
           OR length(coalesce(_x.value #>> '{}', '')) > 200 THEN
          RETURN false;
        END IF;
      END LOOP;
    ELSIF _e.key = 'fiador' THEN
      IF jsonb_typeof(_e.value) <> 'object' THEN RETURN false; END IF;
      FOR _x IN SELECT key, value FROM jsonb_each(_e.value) LOOP
        IF _x.key NOT IN ('nome', 'cpf', 'renda', 'matricula') OR jsonb_typeof(_x.value) NOT IN ('string', 'null')
           OR length(coalesce(_x.value #>> '{}', '')) > 200
           OR (_x.key = 'renda' AND coalesce(_x.value #>> '{}', '') <> '' AND NOT public.locacao_renda_ok(_x.value #>> '{}')) THEN
          RETURN false;
        END IF;
      END LOOP;
    ELSE
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

-- 4) Pré-aprovação pelo corretor: renda do locatário + garantias novas ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_salvar_pre(_id uuid, _dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
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
END $$;

-- Envio à gestora: SÓ os dados da pré-aprovação da garantia. No modo "cliente preenche", todas as partes enviaram.
CREATE OR REPLACE FUNCTION public.locacao_enviar_pre(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _f text[]; _parte text;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pre_analise'], 'corretor');
  IF EXISTS (SELECT 1 FROM public.locacao_pre_modos WHERE locacao_id = _id AND modo = 'cliente') THEN
    FOR _parte IN SELECT unnest(CASE WHEN _l.garantia = 'fiador' THEN ARRAY['locatario', 'fiador'] ELSE ARRAY['locatario'] END) LOOP
      IF NOT EXISTS (SELECT 1 FROM public.locacao_pre_links WHERE locacao_id = _id AND parte = _parte AND status = 'enviado') THEN
        RAISE EXCEPTION 'Aguarde o envio de todas as partes.' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
  _f := public.locacao_pre_faltando(_l);
  IF cardinality(_f) > 0 THEN
    RAISE EXCEPTION 'Preencha: %', array_to_string(_f, ', ') USING ERRCODE = '22023';
  END IF;
  _l := public.locacao_mover(_id, 'aprovacao', false, NULL);
  PERFORM public.locacao_evento(_l, 'corretor', 'Pré-análise enviada à gestora');
  RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
END $$;

-- 5) Garantias novas no checklist, na minuta e nas Regras ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_partes(_l public.locacoes)
RETURNS TABLE (ordem integer, parte text, grupo text, rotulo text)
LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT * FROM (VALUES
    (1, 'locatario',
        CASE WHEN _l.ficha->>'locatario_pessoa' = 'pj' THEN 'locatario_pj' ELSE 'locatario' END,
        CASE WHEN _l.ficha->>'locatario_pessoa' = 'pj' THEN 'Locatário PJ' ELSE 'Locatário PF' END),
    (2, _l.garantia,
        CASE WHEN _l.garantia = 'fiador' AND _l.ficha->>'fiador_pessoa' = 'pj' THEN 'fiador_pj' ELSE _l.garantia END,
        CASE WHEN _l.garantia = 'fiador' THEN CASE WHEN _l.ficha->>'fiador_pessoa' = 'pj' THEN 'Fiador PJ' ELSE 'Fiador PF' END
          ELSE 'Garantia — ' || public.locacao_garantia_rotulo(_l.garantia) END),
    (3, 'proprietario',
        CASE WHEN _l.ficha->>'proprietario_pessoa' = 'pj' THEN 'proprietario_pj' ELSE 'proprietario' END,
        CASE WHEN _l.ficha->>'proprietario_pessoa' = 'pj' THEN 'Proprietário PJ' ELSE 'Proprietário PF' END)
  ) v(ordem, parte, grupo, rotulo)
$$;

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

CREATE OR REPLACE FUNCTION public.locacao_config_salvar(_dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _c public.locacao_config; _k text; _v jsonb;
BEGIN
  IF NOT public.locacao_eh_gerencia(auth.uid()) THEN
    RAISE EXCEPTION 'Só a administração da imobiliária altera as regras.' USING ERRCODE = '42501';
  END IF;
  IF _dados IS NULL OR jsonb_typeof(_dados) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(_dados) k WHERE k NOT IN
     ('pct_coordenador', 'coordenador_sai_do_corretor', 'parceria_divide_por_dois', 'coordenador_na_parceria',
      'dia_pagamento_1a15', 'dia_pagamento_16a31', 'reprovada_volta_ao_corretor', 'chave_antes_do_laudo',
      'seguro_incendio_obrigatorio', 'tabela_taxa', 'documentos')) THEN
    RAISE EXCEPTION 'Campos inválidos' USING ERRCODE = '22023';
  END IF;
  IF _dados ? 'tabela_taxa' THEN
    IF jsonb_typeof(_dados->'tabela_taxa') <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(_dados->'tabela_taxa') e
       WHERE e.key !~ '^[0-9]{1,2}$' OR jsonb_typeof(e.value) <> 'number' OR (e.value)::text::numeric NOT BETWEEN 0 AND 100) THEN
      RAISE EXCEPTION 'Tabela de taxa inválida' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF _dados ? 'documentos' THEN
    IF jsonb_typeof(_dados->'documentos') <> 'object' OR EXISTS (SELECT 1 FROM jsonb_each(_dados->'documentos') e
       WHERE e.key NOT IN ('locatario', 'fiador', 'caucao', 'seguro_fianca', 'loft', 'titulo_capitalizacao', 'outras',
                           'proprietario', 'locatario_pj', 'fiador_pj', 'proprietario_pj') OR jsonb_typeof(e.value) <> 'array'
          OR jsonb_array_length(e.value) > 30 OR EXISTS (SELECT 1 FROM jsonb_array_elements(e.value) x
             WHERE jsonb_typeof(x) <> 'string' OR length(btrim(x #>> '{}')) NOT BETWEEN 2 AND 200)) THEN
      RAISE EXCEPTION 'Lista de documentos inválida' USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO public.locacao_config (organization_id) VALUES (_org) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.locacao_config SET
    pct_coordenador = coalesce((_dados->>'pct_coordenador')::numeric, pct_coordenador),
    coordenador_sai_do_corretor = coalesce((_dados->>'coordenador_sai_do_corretor')::boolean, coordenador_sai_do_corretor),
    parceria_divide_por_dois = coalesce((_dados->>'parceria_divide_por_dois')::boolean, parceria_divide_por_dois),
    coordenador_na_parceria = coalesce((_dados->>'coordenador_na_parceria')::boolean, coordenador_na_parceria),
    dia_pagamento_1a15 = coalesce((_dados->>'dia_pagamento_1a15')::integer, dia_pagamento_1a15),
    dia_pagamento_16a31 = coalesce((_dados->>'dia_pagamento_16a31')::integer, dia_pagamento_16a31),
    reprovada_volta_ao_corretor = coalesce((_dados->>'reprovada_volta_ao_corretor')::boolean, reprovada_volta_ao_corretor),
    chave_antes_do_laudo = coalesce((_dados->>'chave_antes_do_laudo')::boolean, chave_antes_do_laudo),
    seguro_incendio_obrigatorio = coalesce((_dados->>'seguro_incendio_obrigatorio')::boolean, seguro_incendio_obrigatorio),
    tabela_taxa = coalesce(_dados->'tabela_taxa', tabela_taxa),
    documentos = coalesce(_dados->'documentos', documentos),
    atualizado_em = now(), atualizado_por = auth.uid()
   WHERE organization_id = _org RETURNING * INTO _c;
  -- Lista de documentos mudou: atualiza a data da documentação completa das locações ativas desta imobiliária.
  IF _dados ? 'documentos' THEN
    PERFORM public.locacao_docs_situacao(l.id) FROM public.locacoes l
     WHERE l.organization_id = _org AND l.situacao = 'ativa'
       AND l.etapa IN ('documentacao', 'conferencia', 'minuta', 'assinatura');
  END IF;
  RETURN to_jsonb(_c) - 'organization_id' - 'atualizado_por';
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
  RAISE EXCEPTION 'Valor inválido nas regras' USING ERRCODE = '22023';
END $$;

-- 6) Anexo opcional da matrícula do fiador já na pré-aprovação (só esse item; o resto segue na Documentação) -------
CREATE OR REPLACE FUNCTION public.locacao_documento_preparar(_id uuid, _item text, _ext text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id);
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao', 'minuta', 'pre_analise'], 'corretor');
  IF _item IS NULL OR NOT (CASE WHEN _l.etapa = 'pre_analise'
       THEN _item IS NOT DISTINCT FROM public.locacao_pre_item_matricula(_l)
       ELSE _item = ANY (public.locacao_checklist_l(_l)) END) THEN
    RAISE EXCEPTION 'Documento fora da lista desta garantia.' USING ERRCODE = '22023';
  END IF;
  IF _ext IS NULL OR _ext NOT IN ('pdf', 'jpg', 'jpeg', 'png', 'webp') THEN
    RAISE EXCEPTION 'Tipo de arquivo não aceito (PDF ou imagem).' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('path', _l.organization_id::text || '/' || _l.id::text || '/' || gen_random_uuid()::text || '.' || _ext);
END $$;

CREATE OR REPLACE FUNCTION public.locacao_documento_registrar(_id uuid, _item text, _path text, _nome text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _d uuid;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao', 'minuta', 'pre_analise'], 'corretor');
  IF _item IS NULL OR NOT (CASE WHEN _l.etapa = 'pre_analise'
       THEN _item IS NOT DISTINCT FROM public.locacao_pre_item_matricula(_l)
       ELSE _item = ANY (public.locacao_checklist_l(_l)) END) THEN
    RAISE EXCEPTION 'Documento fora da lista desta garantia.' USING ERRCODE = '22023';
  END IF;
  IF _path IS NULL OR _path !~ ('^' || _l.organization_id::text || '/' || _l.id::text || '/[0-9a-f-]{36}[.](pdf|jpg|jpeg|png|webp)$')
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'locacao-documentos' AND o.name = _path) THEN
    RAISE EXCEPTION 'Arquivo não encontrado.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.locacao_documentos WHERE storage_path = _path) THEN
    RAISE EXCEPTION 'Arquivo já registrado.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.locacao_documentos (organization_id, locacao_id, item, storage_path, nome_arquivo, enviado_por)
  VALUES (_l.organization_id, _l.id, _item, _path, left(coalesce(nullif(btrim(_nome), ''), 'arquivo'), 200), auth.uid())
  RETURNING id INTO _d;
  PERFORM public.locacao_evento(_l, 'corretor', 'Documento anexado: ' || _item);
  PERFORM public.locacao_docs_situacao(_l.id);
  RETURN jsonb_build_object('id', _d);
END $$;

CREATE OR REPLACE FUNCTION public.locacao_documento_remover(_doc uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _d public.locacao_documentos; _l public.locacoes;
BEGIN
  SELECT * INTO _d FROM public.locacao_documentos WHERE id = _doc AND removido_em IS NULL;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'Documento não encontrado.' USING ERRCODE = '22023'; END IF;
  _l := public.locacao_pega(_d.locacao_id);
  IF _l.etapa = 'pre_analise' AND _d.item IS NOT DISTINCT FROM public.locacao_pre_item_matricula(_l) THEN
    PERFORM public.locacao_exige(_l, ARRAY['pre_analise'], 'corretor');
  ELSE
    PERFORM public.locacao_exige(_l, ARRAY['documentacao'], 'corretor');
  END IF;
  UPDATE public.locacao_documentos SET removido_em = now() WHERE id = _doc;
  PERFORM public.locacao_evento(_l, 'corretor', 'Documento removido: ' || _d.item);
  PERFORM public.locacao_docs_situacao(_l.id);
  RETURN true;
END $$;

-- 7) Link do cliente na PRÉ-APROVAÇÃO: escopo próprio (não abre a Documentação; o link da Documentação não abre isto) --
CREATE TABLE public.locacao_pre_modos (
  locacao_id uuid PRIMARY KEY REFERENCES public.locacoes(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  modo text NOT NULL CHECK (modo IN ('corretor', 'cliente')),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.locacao_pre_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locacao_id uuid NOT NULL REFERENCES public.locacoes(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  parte text NOT NULL CHECK (parte IN ('locatario', 'fiador')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expira_em timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'nao_aberto' CHECK (status IN ('nao_aberto', 'em_preenchimento', 'enviado')),
  dados jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dados) = 'object'),
  enviado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (locacao_id, parte)
);
CREATE TABLE public.locacao_pre_link_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.locacao_pre_links(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  path text NOT NULL UNIQUE,
  nome text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  registrado_em timestamptz
);
CREATE INDEX locacao_pre_link_arquivos_link_idx ON public.locacao_pre_link_arquivos(link_id);
ALTER TABLE public.locacao_pre_modos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_pre_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_pre_link_arquivos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locacao_pre_modos, public.locacao_pre_links, public.locacao_pre_link_arquivos FROM PUBLIC, anon, authenticated;

-- Corretor: escolhe quem preenche (voltar para "Eu preencho" cancela os links da pré-aprovação).
CREATE FUNCTION public.locacao_pre_links_modo(_id uuid, _modo text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id);
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pre_analise'], 'corretor');
  IF _modo IS NULL OR _modo NOT IN ('corretor', 'cliente') THEN RAISE EXCEPTION 'Modo inválido' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.locacao_pre_modos(locacao_id, organization_id, modo) VALUES (_l.id, _l.organization_id, _modo)
  ON CONFLICT(locacao_id) DO UPDATE SET modo = EXCLUDED.modo, atualizado_em = now();
  IF _modo = 'corretor' THEN DELETE FROM public.locacao_pre_links WHERE locacao_id = _id; END IF;
  RETURN true;
END $$;

-- Leitura para quem vê a locação (sem FOR UPDATE: roda em GET/transação só leitura).
CREATE FUNCTION public.locacao_pre_links_lista(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes;
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id AND organization_id = public.locacao_ctx();
  IF _l.id IS NULL OR NOT public.locacao_pode_ver(_l) THEN
    RAISE EXCEPTION 'Sem acesso a esta locação.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('modo', coalesce((SELECT modo FROM public.locacao_pre_modos WHERE locacao_id = _id), 'corretor'),
    'links', (SELECT coalesce(jsonb_agg(jsonb_build_object('parte', parte, 'status', status,
      'expira_em', expira_em, 'enviado_em', enviado_em, 'dados', dados,
      'arquivos', (SELECT coalesce(jsonb_agg(jsonb_build_object('item', 'Matrícula (anexo opcional)', 'nome', a.nome)), '[]'::jsonb)
        FROM public.locacao_pre_link_arquivos a WHERE a.link_id = k.id AND a.registrado_em IS NOT NULL)) ORDER BY parte), '[]'::jsonb)
      FROM public.locacao_pre_links k WHERE locacao_id = _id));
END $$;

CREATE FUNCTION public.locacao_pre_links_emitir(_id uuid, _parte text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _exp timestamptz; _token text;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pre_analise'], 'corretor');
  IF (SELECT modo FROM public.locacao_pre_modos WHERE locacao_id = _id) IS DISTINCT FROM 'cliente'
    OR _parte IS NULL OR _parte NOT IN ('locatario', 'fiador') OR (_parte = 'fiador' AND _l.garantia <> 'fiador') THEN
    RAISE EXCEPTION 'Convite inválido' USING ERRCODE = '22023';
  END IF;
  -- Um link por parte; gerar de novo substitui o anterior (a linha da locação já está travada pelo locacao_pega).
  DELETE FROM public.locacao_pre_links WHERE locacao_id = _id AND parte = _parte;
  _exp := now() + interval '7 days';
  _token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.locacao_pre_links(locacao_id, organization_id, parte, token_hash, expira_em)
  VALUES (_id, _l.organization_id, _parte, encode(extensions.digest(_token, 'sha256'), 'hex'), _exp);
  RETURN jsonb_build_object('token', _token, 'expira_em', _exp);
END $$;

-- Públicas: SÓ a server function (service_role) chama. Tentativa inválida também consome o limite por IP
-- (mesma tabela de tentativas do link da Documentação); erros de aplicação voltam como JSON, sem desfazer o contador.
CREATE FUNCTION public.locacao_pre_link_validar(_token text, _ip_hash text, _escrita boolean DEFAULT false)
RETURNS public.locacao_pre_links LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _k public.locacao_pre_links; _n integer; _l public.locacoes;
BEGIN
  IF _ip_hash IS NULL OR _ip_hash !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  INSERT INTO public.locacao_link_tentativas(ip_hash, janela, quantidade)
  VALUES (_ip_hash, date_trunc('minute', now()), 1)
  ON CONFLICT(ip_hash, janela) DO UPDATE SET quantidade = public.locacao_link_tentativas.quantidade + 1
  RETURNING quantidade INTO _n;
  IF _n > 120 OR _token IS NULL OR _token !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO _k FROM public.locacao_pre_links WHERE token_hash = encode(extensions.digest(_token, 'sha256'), 'hex');
  IF _k.id IS NULL OR _k.expira_em <= now() OR (_escrita AND _k.status = 'enviado') THEN RETURN NULL; END IF;
  SELECT * INTO _l FROM public.locacoes WHERE id = _k.locacao_id AND organization_id = _k.organization_id;
  IF _escrita AND _l.id IS NOT NULL THEN
    -- Mesma ordem de travas do corretor (locação → convite): reemissão e envio não se cruzam.
    SELECT * INTO _l FROM public.locacoes WHERE id = _l.id FOR UPDATE;
    SELECT * INTO _k FROM public.locacao_pre_links WHERE id = _k.id
      AND token_hash = encode(extensions.digest(_token, 'sha256'), 'hex') FOR UPDATE;
    IF _k.id IS NULL OR _k.status = 'enviado' OR _k.expira_em <= now() THEN RETURN NULL; END IF;
  END IF;
  IF _l.id IS NULL OR _l.situacao <> 'ativa' OR _l.etapa <> 'pre_analise'
    OR NOT EXISTS (SELECT 1 FROM public.organizations o JOIN public.organization_modules m ON m.organization_id = o.id
      WHERE o.id = _k.organization_id AND o.status = 'ativa' AND m.module = 'locacao' AND m.enabled)
    OR (SELECT modo FROM public.locacao_pre_modos WHERE locacao_id = _l.id) IS DISTINCT FROM 'cliente'
    OR (_k.parte = 'fiador' AND _l.garantia <> 'fiador') THEN RETURN NULL; END IF;
  RETURN _k;
END $$;

-- O cliente vê: a própria parte, a garantia (que define os campos) e o que ele mesmo digitou. Nenhum valor.
CREATE FUNCTION public.locacao_pre_link_ler(_token text, _ip_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _k public.locacao_pre_links; _l public.locacoes;
BEGIN
  _k := public.locacao_pre_link_validar(_token, _ip_hash);
  IF _k.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT * INTO _l FROM public.locacoes WHERE id = _k.locacao_id AND organization_id = _k.organization_id;
  RETURN jsonb_build_object('ok', true, 'parte', _k.parte, 'status', _k.status, 'dados', _k.dados,
    'expira_em', _k.expira_em, 'garantia', _l.garantia,
    'pede_renda', _k.parte = 'fiador' OR _l.garantia IN ('caucao', 'fiador'),
    'anexo_matricula', _k.parte = 'fiador' AND public.locacao_pre_item_matricula(_l) IS NOT NULL,
    'arquivos', (SELECT coalesce(jsonb_agg(a.nome ORDER BY a.registrado_em), '[]'::jsonb)
      FROM public.locacao_pre_link_arquivos a WHERE a.link_id = _k.id AND a.registrado_em IS NOT NULL));
END $$;

CREATE FUNCTION public.locacao_pre_link_salvar(_token text, _ip_hash text, _dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _k public.locacao_pre_links; _e record; _v text;
BEGIN
  _k := public.locacao_pre_link_validar(_token, _ip_hash, true);
  IF _k.id IS NULL OR _dados IS NULL OR jsonb_typeof(_dados) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(_dados)) > 10 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  FOR _e IN SELECT key, value FROM jsonb_each(_dados) LOOP
    IF jsonb_typeof(_e.value) <> 'string' OR NOT (_e.key = ANY (CASE _k.parte
         WHEN 'locatario' THEN ARRAY['cpf', 'nome', 'nascimento', 'telefone', 'email', 'renda']
         ELSE ARRAY['nome', 'cpf', 'renda', 'matricula'] END)) THEN
      RETURN jsonb_build_object('ok', false);
    END IF;
    _v := btrim(_e.value #>> '{}');
    IF length(_v) > 200 OR (_v <> '' AND ((_e.key = 'renda' AND NOT public.locacao_renda_ok(_v))
        OR (_e.key = 'nascimento' AND NOT public.locacao_data_ok(_v)))) THEN
      RETURN jsonb_build_object('ok', false);
    END IF;
  END LOOP;
  UPDATE public.locacao_pre_links SET dados = dados || _dados, status = 'em_preenchimento'
    WHERE id = _k.id AND status <> 'enviado';
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE FUNCTION public.locacao_pre_link_preparar(_token text, _ip_hash text, _ext text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _k public.locacao_pre_links; _l public.locacoes; _path text;
BEGIN
  _k := public.locacao_pre_link_validar(_token, _ip_hash, true);
  IF _k.id IS NULL OR _k.parte <> 'fiador' THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT * INTO _l FROM public.locacoes WHERE id = _k.locacao_id;
  IF _ext IS NULL OR _ext NOT IN ('pdf', 'jpg', 'jpeg', 'png', 'webp') OR public.locacao_pre_item_matricula(_l) IS NULL
    OR (SELECT count(*) FROM public.locacao_pre_link_arquivos WHERE link_id = _k.id) >= 5 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  _path := _k.organization_id::text || '/' || _k.locacao_id::text || '/pre-fiador/' || gen_random_uuid()::text || '.' || _ext;
  INSERT INTO public.locacao_pre_link_arquivos(link_id, organization_id, path) VALUES (_k.id, _k.organization_id, _path);
  UPDATE public.locacao_pre_links SET status = 'em_preenchimento' WHERE id = _k.id;
  RETURN jsonb_build_object('ok', true, 'path', _path);
END $$;

CREATE FUNCTION public.locacao_pre_link_registrar(_token text, _ip_hash text, _path text, _nome text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _k public.locacao_pre_links;
BEGIN
  _k := public.locacao_pre_link_validar(_token, _ip_hash, true);
  IF _k.id IS NULL OR _nome IS NULL OR length(btrim(_nome)) NOT BETWEEN 1 AND 200
    OR NOT EXISTS (SELECT 1 FROM public.locacao_pre_link_arquivos a JOIN storage.objects o
      ON o.bucket_id = 'locacao-documentos' AND o.name = a.path
      WHERE a.link_id = _k.id AND a.path = _path AND a.registrado_em IS NULL AND a.criado_em > now() - interval '2 hours') THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
  UPDATE public.locacao_pre_link_arquivos SET nome = _nome, registrado_em = now()
    WHERE link_id = _k.id AND path = _path AND registrado_em IS NULL;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Envio do cliente: exige a parte completa para a garantia ATUAL, trava a edição e leva os dados ao corretor
-- (preenche só campo vazio; o corretor confere, corrige e decide quando mandar à gestora).
CREATE FUNCTION public.locacao_pre_link_enviar(_token text, _ip_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _k public.locacao_pre_links; _l public.locacoes; _alvo jsonb; _c text; _item text; _f text[];
BEGIN
  _k := public.locacao_pre_link_validar(_token, _ip_hash, true);
  IF _k.id IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT * INTO _l FROM public.locacoes WHERE id = _k.locacao_id AND organization_id = _k.organization_id FOR UPDATE;
  SELECT * INTO _k FROM public.locacao_pre_links WHERE id = _k.id FOR UPDATE;
  IF _k.id IS NULL OR _k.status = 'enviado' OR _k.expira_em <= now() THEN RETURN jsonb_build_object('ok', false); END IF;
  _f := public.locacao_pre_parte_faltando(_k.parte, _l.garantia, _k.dados);
  IF cardinality(_f) > 0 THEN RETURN jsonb_build_object('ok', false, 'faltando', to_jsonb(_f)); END IF;
  _alvo := CASE WHEN _k.parte = 'locatario' THEN _l.candidato ELSE coalesce(_l.ficha->'fiador', '{}'::jsonb) END;
  FOR _c IN SELECT unnest(CASE WHEN _k.parte = 'locatario' THEN ARRAY['cpf', 'nome', 'nascimento', 'telefone', 'email', 'renda']
                               ELSE ARRAY['nome', 'cpf', 'renda', 'matricula'] END) LOOP
    IF btrim(coalesce(_alvo->>_c, '')) = '' AND btrim(coalesce(_k.dados->>_c, '')) <> '' THEN
      _alvo := _alvo || jsonb_build_object(_c, btrim(_k.dados->>_c));
    END IF;
  END LOOP;
  IF _k.parte = 'locatario' THEN
    UPDATE public.locacoes SET candidato = _alvo, atualizado_em = now() WHERE id = _l.id;
  ELSE
    UPDATE public.locacoes SET ficha = ficha || jsonb_build_object('fiador', _alvo), atualizado_em = now() WHERE id = _l.id;
    _item := public.locacao_pre_item_matricula(_l);
    IF _item IS NOT NULL THEN
      INSERT INTO public.locacao_documentos(organization_id, locacao_id, item, storage_path, nome_arquivo)
        SELECT _l.organization_id, _l.id, _item, a.path, left(coalesce(nullif(btrim(a.nome), ''), 'arquivo'), 200)
          FROM public.locacao_pre_link_arquivos a WHERE a.link_id = _k.id AND a.registrado_em IS NOT NULL;
    END IF;
  END IF;
  UPDATE public.locacao_pre_links SET status = 'enviado', enviado_em = now() WHERE id = _k.id;
  PERFORM public.locacao_evento(_l, 'corretor', 'Link do cliente: ' || CASE _k.parte WHEN 'locatario' THEN 'locatário'
    ELSE 'fiador' END || ' enviou os dados da pré-aprovação');
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.locacao_pre_links_modo(uuid, text), public.locacao_pre_links_lista(uuid),
  public.locacao_pre_links_emitir(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_pre_links_modo(uuid, text), public.locacao_pre_links_lista(uuid),
  public.locacao_pre_links_emitir(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.locacao_pre_link_validar(text, text, boolean), public.locacao_pre_link_ler(text, text),
  public.locacao_pre_link_salvar(text, text, jsonb), public.locacao_pre_link_preparar(text, text, text),
  public.locacao_pre_link_registrar(text, text, text, text), public.locacao_pre_link_enviar(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.locacao_pre_link_validar(text, text, boolean), public.locacao_pre_link_ler(text, text),
  public.locacao_pre_link_salvar(text, text, jsonb), public.locacao_pre_link_preparar(text, text, text),
  public.locacao_pre_link_registrar(text, text, text, text), public.locacao_pre_link_enviar(text, text) TO service_role;
COMMIT;
