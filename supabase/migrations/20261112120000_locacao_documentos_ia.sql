-- Locação — etapa Documentação com leitura dos documentos por IA + dados do contrato (t_127811ca).
-- Pedido de Denis 10/11/2026 (tópico 6238): "igual à esteira de venda: o corretor sobe os documentos e a IA lê e
-- preenche o que precisa", a partir da locação aprovada. CONSTRUÇÃO EM TESTE: aplicar em produção só com novo "sim".
--
-- ADITIVA. Rollback: supabase/rollback/20261112120000_locacao_documentos_ia.sql
-- Teste: supabase/tests/run-locacao-docs-ia.sh (transação desfeita; nunca produção).
--
-- O que muda:
--  * locacao_contrato_dados: os dados que o contrato-modelo (residencial com fiador) precisa, campo a campo, com a
--    ORIGEM de cada um (lido pela IA de qual documento, ou digitado). Fica fora de "locacoes" para não ir na lista.
--  * locacao_doc_leituras: o selo de cada documento (IA lendo / IA ok / IA falhou / sem leitura) e as sugestões
--    JÁ LIMPAS que a IA achou. Nunca guarda o texto bruto da IA nem o arquivo.
--  * A IA SÓ preenche campo vazio. O que o corretor digitou nunca é sobrescrito.
--  * A gravação da leitura só é chamada pelo servidor do ADM (service_role), depois de o banco conferir a permissão
--    de quem clicou (locacao_leitura_preparar com o login dele). Assim ninguém forja o selo "lido do documento".
--  * Envio à Conferência: além dos documentos, exige os campos obrigatórios do contrato, SÓ para residencial com
--    fiador (caução e seguro-fiança seguem exatamente como antes). Se a IA falhar ou estiver fora do ar, o corretor
--    digita e segue: a IA nunca bloqueia.
-- Funções da Fase 1 redefinidas (o rollback devolve o texto exato da 20261110120000): locacao_detalhe,
-- locacao_enviar_documentacao. Nenhuma função da venda ou da captação é tocada.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- 1) Tabelas (RLS ligada, nenhum grant a anon/authenticated; tudo pelas RPCs) -----------------------------------
CREATE TABLE public.locacao_contrato_dados (
  locacao_id uuid PRIMARY KEY REFERENCES public.locacoes(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- { "<chave>": "<texto>" } — só chaves de locacao_contrato_chaves(), só texto.
  valores jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT locacao_contrato_valores_check CHECK (jsonb_typeof(valores) = 'object'),
  -- { "<chave>": {"o":"ia","item":"<item do checklist>"} | {"o":"manual"} }
  origem jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT locacao_contrato_origem_check CHECK (jsonb_typeof(origem) = 'object'),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);

CREATE TABLE public.locacao_doc_leituras (
  documento_id uuid PRIMARY KEY REFERENCES public.locacao_documentos(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  locacao_id uuid NOT NULL REFERENCES public.locacoes(id) ON DELETE CASCADE,
  status text NOT NULL CONSTRAINT locacao_doc_leituras_status_check
    CHECK (status IN ('pendente', 'ok', 'falhou', 'sem_leitura')),
  -- Só um código (nunca texto da IA nem dado do documento).
  erro text CONSTRAINT locacao_doc_leituras_erro_check CHECK (erro IS NULL OR erro IN
    ('IA_SEM_CREDITO', 'IA_COTA_EXCEDIDA', 'TEMPO', 'NAO_CONFIGURADA', 'FALHA', 'SEM_LEITURA')),
  sugestoes jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT locacao_doc_leituras_sug_check CHECK (jsonb_typeof(sugestoes) = 'object'),
  preenchidos integer NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX locacao_doc_leituras_loc_idx ON public.locacao_doc_leituras (locacao_id);

ALTER TABLE public.locacao_contrato_dados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_doc_leituras ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locacao_contrato_dados, public.locacao_doc_leituras FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.locacao_contrato_dados, public.locacao_doc_leituras TO service_role;

-- 2) Regras puras (espelho de src/lib/locacao-contrato.ts; os testes conferem as duas listas) --------------------
CREATE OR REPLACE FUNCTION public.locacao_contrato_chaves() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT ARRAY[
    'loc_nome', 'loc_cpf', 'loc_rg', 'loc_nascimento', 'loc_nacionalidade', 'loc_estado_civil', 'loc_regime',
    'loc_profissao', 'loc_endereco', 'loc_email', 'loc_telefone',
    'prop_nome', 'prop_cpf', 'prop_rg', 'prop_nascimento', 'prop_nacionalidade', 'prop_estado_civil', 'prop_regime',
    'prop_profissao', 'prop_endereco', 'prop_email', 'prop_telefone',
    'prop_conj_nome', 'prop_conj_cpf', 'prop_conj_rg', 'prop_conj_nascimento', 'prop_conj_nacionalidade', 'prop_conj_profissao',
    'fia_nome', 'fia_cpf', 'fia_rg', 'fia_nascimento', 'fia_nacionalidade', 'fia_estado_civil', 'fia_regime',
    'fia_profissao', 'fia_endereco', 'fia_email', 'fia_telefone',
    'fia_conj_nome', 'fia_conj_cpf', 'fia_conj_rg', 'fia_conj_nascimento', 'fia_conj_nacionalidade', 'fia_conj_profissao',
    'fia_matricula', 'fia_cartorio',
    'imv_inscricao', 'imv_energia', 'imv_agua', 'imv_gas', 'imv_vagas',
    'prazo_meses', 'inicio', 'dia_vencimento', 'moradores']::text[]
$$;

CREATE OR REPLACE FUNCTION public.locacao_contrato_valor_ok(_k text, _v text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE _d date;
BEGIN
  IF _k IS NULL OR NOT (_k = ANY (public.locacao_contrato_chaves())) THEN RETURN false; END IF;
  IF _v IS NULL OR _v = '' THEN RETURN true; END IF;
  IF length(_v) > (CASE WHEN _k = 'moradores' THEN 2000 ELSE 300 END) THEN RETURN false; END IF;
  IF _k = 'inicio' OR _k LIKE '%nascimento' THEN
    IF _v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN false; END IF;
    BEGIN _d := _v::date; EXCEPTION WHEN others THEN RETURN false; END;
    RETURN to_char(_d, 'YYYY-MM-DD') = _v AND _d BETWEEN DATE '1900-01-01' AND DATE '2100-12-31';
  END IF;
  IF _k = 'prazo_meses' THEN RETURN _v ~ '^[0-9]{1,3}$' AND _v::integer BETWEEN 1 AND 240; END IF;
  IF _k = 'dia_vencimento' THEN RETURN _v ~ '^[0-9]{1,2}$' AND _v::integer BETWEEN 1 AND 28; END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.locacao_casado(_estado text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT coalesce(lower(_estado) ~ '(casad|uni[aã]o)', false)
$$;

-- Os campos obrigatórios só valem para residencial com fiador (caução e seguro-fiança seguem como estão).
CREATE OR REPLACE FUNCTION public.locacao_exige_contrato(_l public.locacoes) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT _l.tipo = 'residencial' AND _l.garantia = 'fiador'
$$;

-- Valores do contrato com a pré-análise por baixo (nome, CPF, nascimento, e-mail e telefone do candidato).
CREATE OR REPLACE FUNCTION public.locacao_contrato_valores(_l public.locacoes) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
      'loc_nome', nullif(btrim(coalesce(_l.candidato->>'nome', '')), ''),
      'loc_cpf', nullif(btrim(coalesce(_l.candidato->>'cpf', '')), ''),
      'loc_nascimento', nullif(btrim(coalesce(_l.candidato->>'nascimento', '')), ''),
      'loc_email', nullif(btrim(coalesce(_l.candidato->>'email', '')), ''),
      'loc_telefone', nullif(btrim(coalesce(_l.candidato->>'telefone', '')), '')))
    || coalesce((SELECT c.valores FROM public.locacao_contrato_dados c WHERE c.locacao_id = _l.id), '{}'::jsonb)
$$;

-- O que falta para enviar à Conferência. Espelho de faltasContrato() (mesma ordem e texto).
CREATE OR REPLACE FUNCTION public.locacao_contrato_faltando(_l public.locacoes) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _v jsonb; _f text[] := ARRAY[]::text[]; _p record; _i record; _x text;
BEGIN
  IF NOT public.locacao_exige_contrato(_l) THEN RETURN _f; END IF;
  _v := public.locacao_contrato_valores(_l);
  FOR _p IN SELECT * FROM (VALUES (1, 'loc', 'do locatário'), (2, 'prop', 'do proprietário'), (3, 'fia', 'do fiador'))
             AS t(n, pre, rot) ORDER BY n LOOP
    FOR _i IN SELECT * FROM (VALUES (1, 'nome', 'nome'), (2, 'cpf', 'CPF'), (3, 'rg', 'RG'), (4, 'nacionalidade', 'nacionalidade'),
                (5, 'estado_civil', 'estado civil'), (6, 'profissao', 'profissão'), (7, 'endereco', 'endereço'))
               AS t(n, k, nome) ORDER BY n LOOP
      _x := btrim(coalesce(_v->>(_p.pre || '_' || _i.k), ''));
      IF (_i.k = 'cpf' AND length(regexp_replace(_x, '[^0-9]', '', 'g')) <> 11) OR (_i.k <> 'cpf' AND _x = '') THEN
        _f := array_append(_f, _i.nome || ' ' || _p.rot);
      END IF;
    END LOOP;
    IF _p.pre <> 'loc' AND public.locacao_casado(_v->>(_p.pre || '_estado_civil')) THEN
      IF btrim(coalesce(_v->>(_p.pre || '_conj_nome'), '')) = '' THEN
        _f := array_append(_f, 'nome do cônjuge ' || _p.rot);
      END IF;
      IF length(regexp_replace(coalesce(_v->>(_p.pre || '_conj_cpf'), ''), '[^0-9]', '', 'g')) <> 11 THEN
        _f := array_append(_f, 'CPF do cônjuge ' || _p.rot);
      END IF;
    END IF;
  END LOOP;
  FOR _i IN SELECT * FROM (VALUES (1, 'fia_matricula', 'matrícula do imóvel do fiador'), (2, 'fia_cartorio', 'cartório do imóvel do fiador'),
              (3, 'imv_inscricao', 'inscrição municipal do imóvel'), (4, 'imv_energia', 'código de energia'),
              (5, 'imv_agua', 'código de água'), (6, 'imv_vagas', 'vagas de garagem (ou "não possui")'),
              (7, 'prazo_meses', 'prazo (meses)'), (8, 'inicio', 'início do contrato'),
              (9, 'dia_vencimento', 'dia de vencimento')) AS t(n, k, nome) ORDER BY n LOOP
    IF btrim(coalesce(_v->>_i.k, '')) = '' THEN _f := array_append(_f, _i.nome); END IF;
  END LOOP;
  RETURN _f;
END $$;

-- Grupo do checklist a que o item pertence (locatario | <garantia> | proprietario). Mesma lista da Fase 1.
CREATE OR REPLACE FUNCTION public.locacao_grupo_do_item(_l public.locacoes, _item text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  WITH d AS (SELECT (public.locacao_cfg(_l.organization_id)).documentos AS j)
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM d, jsonb_array_elements_text(coalesce(d.j->'locatario', '[]')) x WHERE x = _item) THEN 'locatario'
    WHEN EXISTS (SELECT 1 FROM d, jsonb_array_elements_text(coalesce(d.j->_l.garantia, '[]')) x WHERE x = _item) THEN _l.garantia
    WHEN EXISTS (SELECT 1 FROM d, jsonb_array_elements_text(coalesce(d.j->'proprietario', '[]')) x WHERE x = _item) THEN 'proprietario'
    ELSE 'outro' END
$$;

REVOKE ALL ON FUNCTION public.locacao_contrato_chaves(), public.locacao_contrato_valor_ok(text, text),
  public.locacao_casado(text), public.locacao_exige_contrato(public.locacoes),
  public.locacao_contrato_valores(public.locacoes), public.locacao_contrato_faltando(public.locacoes),
  public.locacao_grupo_do_item(public.locacoes, text) FROM PUBLIC, anon, authenticated;

-- 3) Corretor: salva o que digitou ----------------------------------------------------------------------------
-- _dados: { "<chave>": "<texto>" | null }. Só as chaves enviadas mudam; elas passam a ter origem "digitado".
CREATE OR REPLACE FUNCTION public.locacao_contrato_salvar(_id uuid, _dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.locacao_contrato_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_contrato_salvar(uuid, jsonb) TO authenticated;

-- 4) Leitura por IA -------------------------------------------------------------------------------------------
-- Passo 1 (login de quem clicou): confere corretor + etapa + documento da locação e marca "IA lendo".
-- Devolve o caminho do arquivo (o servidor baixa com a chave de serviço, como em "abrir documento"), o item, o
-- grupo e os valores atuais (para casar a certidão de casamento com a pessoa certa).
CREATE OR REPLACE FUNCTION public.locacao_leitura_preparar(_doc uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _d public.locacao_documentos; _l public.locacoes;
BEGIN
  SELECT * INTO _d FROM public.locacao_documentos WHERE id = _doc AND organization_id = _org AND removido_em IS NULL;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'Documento não encontrado.' USING ERRCODE = '22023'; END IF;
  _l := public.locacao_pega(_d.locacao_id);
  PERFORM public.locacao_exige(_l, ARRAY['documentacao'], 'corretor');
  INSERT INTO public.locacao_doc_leituras (documento_id, organization_id, locacao_id, status, erro, atualizado_em)
  VALUES (_d.id, _d.organization_id, _d.locacao_id, 'pendente', NULL, now())
  ON CONFLICT (documento_id) DO UPDATE SET status = 'pendente', erro = NULL, atualizado_em = now();
  RETURN jsonb_build_object('path', _d.storage_path, 'item', _d.item, 'grupo', public.locacao_grupo_do_item(_l, _d.item),
    'valores', public.locacao_contrato_valores(_l));
END $$;
REVOKE ALL ON FUNCTION public.locacao_leitura_preparar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_leitura_preparar(uuid) TO authenticated;

-- Passo 2 (SÓ o servidor, service_role): grava o selo e as sugestões já limpas e preenche APENAS campo vazio.
-- _uid = quem clicou (já conferido no passo 1, com o login dele). Repete as checagens de documento e etapa.
CREATE OR REPLACE FUNCTION public.locacao_leitura_gravar(_doc uuid, _uid uuid, _status text, _erro text, _sugestoes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _d public.locacao_documentos; _l public.locacoes; _val jsonb; _ori jsonb; _vigente jsonb; _e record; _t text;
  _sug jsonb := '{}'::jsonb; _n integer := 0;
BEGIN
  IF _status IS NULL OR _status NOT IN ('ok', 'falhou', 'sem_leitura') THEN
    RAISE EXCEPTION 'Situação inválida' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _d FROM public.locacao_documentos WHERE id = _doc AND removido_em IS NULL;
  IF _d.id IS NULL THEN RAISE EXCEPTION 'Documento não encontrado.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _l FROM public.locacoes WHERE id = _d.locacao_id FOR UPDATE;
  -- Saiu da Documentação enquanto a IA lia: não mexe em mais nada (o selo fica como estava).
  IF _l.situacao <> 'ativa' OR _l.etapa <> 'documentacao' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'etapa');
  END IF;
  IF _status = 'ok' THEN
    IF _sugestoes IS NULL OR jsonb_typeof(_sugestoes) <> 'object' THEN
      RAISE EXCEPTION 'Sugestões inválidas' USING ERRCODE = '22023';
    END IF;
    FOR _e IN SELECT key, value FROM jsonb_each(_sugestoes) LOOP
      _t := CASE WHEN jsonb_typeof(_e.value) = 'string' THEN nullif(btrim(_e.value #>> '{}'), '') END;
      -- Chave fora da lista ou valor inválido é descartado em silêncio (a IA nunca derruba a leitura).
      IF _t IS NOT NULL AND _e.key = ANY (public.locacao_contrato_chaves()) AND public.locacao_contrato_valor_ok(_e.key, _t) THEN
        _sug := _sug || jsonb_build_object(_e.key, _t);
      END IF;
    END LOOP;
    INSERT INTO public.locacao_contrato_dados (locacao_id, organization_id) VALUES (_l.id, _l.organization_id)
    ON CONFLICT (locacao_id) DO NOTHING;
    SELECT valores, origem INTO _val, _ori FROM public.locacao_contrato_dados WHERE locacao_id = _l.id FOR UPDATE;
    _vigente := public.locacao_contrato_valores(_l);
    FOR _e IN SELECT key, value FROM jsonb_each(_sug) LOOP
      IF btrim(coalesce(_vigente->>_e.key, '')) = '' THEN
        _val := _val || jsonb_build_object(_e.key, _e.value);
        _ori := _ori || jsonb_build_object(_e.key, jsonb_build_object('o', 'ia', 'item', _d.item));
        _vigente := _vigente || jsonb_build_object(_e.key, _e.value);
        _n := _n + 1;
      END IF;
    END LOOP;
    UPDATE public.locacao_contrato_dados SET valores = _val, origem = _ori, atualizado_em = now() WHERE locacao_id = _l.id;
  END IF;
  INSERT INTO public.locacao_doc_leituras (documento_id, organization_id, locacao_id, status, erro, sugestoes, preenchidos, atualizado_em)
  VALUES (_d.id, _d.organization_id, _d.locacao_id, _status,
    CASE WHEN _status = 'falhou' THEN coalesce(nullif(_erro, ''), 'FALHA') WHEN _status = 'sem_leitura' THEN 'SEM_LEITURA' END,
    _sug, _n, now())
  ON CONFLICT (documento_id) DO UPDATE SET status = EXCLUDED.status, erro = EXCLUDED.erro, sugestoes = EXCLUDED.sugestoes,
    preenchidos = EXCLUDED.preenchidos, atualizado_em = now();
  INSERT INTO public.locacao_eventos (organization_id, locacao_id, etapa, papel, descricao, ator_id)
  VALUES (_l.organization_id, _l.id, _l.etapa, 'corretor', left(CASE _status
    WHEN 'ok' THEN 'IA leu "' || _d.item || '": ' || _n || ' campo(s) preenchido(s)'
    WHEN 'falhou' THEN 'IA não conseguiu ler "' || _d.item || '" (corretor preenche)'
    ELSE 'Documento sem leitura automática: ' || _d.item END, 500), _uid);
  RETURN jsonb_build_object('ok', true, 'preenchidos', _n);
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'Valor inválido' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.locacao_leitura_gravar(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.locacao_leitura_gravar(uuid, uuid, text, text, jsonb) TO service_role;

-- 5) Fase 1 redefinida: detalhe (com contrato e selos) e trava de envio ------------------------------------------
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
REVOKE ALL ON FUNCTION public.locacao_detalhe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_detalhe(uuid) TO authenticated;

-- Trava: não envia à gestora com documento pendente nem (residencial com fiador) com dado do contrato faltando.
CREATE OR REPLACE FUNCTION public.locacao_enviar_documentacao(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _f text[]; _c text[];
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao'], 'corretor');
  _f := public.locacao_docs_faltando(_l);
  IF cardinality(_f) > 0 THEN
    RAISE EXCEPTION 'Faltam % documento(s): %', cardinality(_f), array_to_string(_f, '; ') USING ERRCODE = '22023';
  END IF;
  _c := public.locacao_contrato_faltando(_l);
  IF cardinality(_c) > 0 THEN
    RAISE EXCEPTION 'Complete os dados do contrato: %', array_to_string(_c, ', ') USING ERRCODE = '22023';
  END IF;
  _l := public.locacao_mover(_id, 'conferencia', false, NULL);
  PERFORM public.locacao_evento(_l, 'corretor', 'Documentação completa enviada para conferência');
  RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
END $$;
REVOKE ALL ON FUNCTION public.locacao_enviar_documentacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_enviar_documentacao(uuid) TO authenticated;

COMMIT;
