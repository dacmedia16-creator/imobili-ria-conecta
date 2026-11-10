-- Locação — ficha de abertura pelo corretor + checklist por parte + trava do "Montar contrato" (t_28e583e2).
-- Pedido de Denis 10/11/2026 (tópico 6238, "pode executar"), com a correção de escopo do mesmo dia: "é o corretor
-- que envia tudo como no da venda". NÃO há link público: quem preenche os dados e sobe os documentos de todas as
-- partes é o CORRETOR, dentro do ADM (etapa Documentação com leitura por IA, igual à venda).
-- CONSTRUÇÃO EM TESTE: aplicar em produção só com novo "sim" de Denis.
--
-- ADITIVA. Rollback: supabase/rollback/20261113120000_locacao_ficha_checklist.sql
-- Teste: supabase/tests/run-locacao-ficha.sh (transação desfeita; nunca produção).
--
-- O que muda:
--  * locacoes.ficha (jsonb): o restante da ficha cadastral da locação (Google Forms "formulário cadastral"):
--    ID do imóvel, mobília, metragem, proprietário (nome/telefone/e-mail), PF ou PJ de cada parte, endereço do
--    locatário, outra garantia (texto livre, lista final a confirmar) e observações/tratativas.
--  * locacoes.captador_id: corretor captador (responsável = corretor_id). Só registra; comissão não é desta entrega.
--  * locacoes.docs_completos_em: data em que todos os documentos obrigatórios ficaram entregues.
--  * Checklist por parte: Locatário PF/PJ, garantia (Fiador PF/PJ, Caução, Seguro-fiança) e Proprietário PF/PJ.
--    Listas novas por imobiliária: locatario_pj, proprietario_pj, fiador_pj (editáveis em Regras, sem código).
--    Imobiliária que já salvou as listas recebe as PJ padrão (só as chaves que faltam). Lista PJ vazia usa a PF da
--    mesma parte (fiador PJ: a confirmar, sem lista própria).
--  * Item cujo nome termina em "(opcional)" aparece no checklist mas NÃO trava.
--  * Trava "Montar contrato": o setor de contratos não envia a minuta nem prepara a assinatura com documento
--    obrigatório faltando (a gestora já não conferia; agora o contrato também não é montado).
-- Funções redefinidas (o rollback devolve o texto exato anterior): locacao_docs_padrao, locacao_cfg, locacao_salvar_pre,
-- locacao_enviar_pre, locacao_docs_faltando, locacao_documento_preparar, locacao_documento_registrar,
-- locacao_documento_remover, locacao_config_salvar, locacao_contratos_acao (de 20261110120000) e
-- locacao_grupo_do_item, locacao_detalhe (de 20261112120000). Nenhuma função da venda ou da captação é tocada.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- 1) Colunas novas (nada muda para as locações que já existem: ficha vazia, sem captador, sem data) ---------------
ALTER TABLE public.locacoes
  ADD COLUMN ficha jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT locacoes_ficha_check CHECK (jsonb_typeof(ficha) = 'object'),
  ADD COLUMN captador_id uuid,
  ADD COLUMN docs_completos_em timestamptz;

-- 2) Listas padrão: as 5 de antes IGUAIS + PJ (formulários reais de 10/11). Fiador PJ não foi informado: sem lista.
CREATE OR REPLACE FUNCTION public.locacao_docs_padrao() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT '{
    "locatario":["RG/CNH do locatário","CPF do locatário","Comprovante de renda do locatário","Comprovante de residência do locatário"],
    "fiador":["RG/CNH do fiador","Comprovante de renda do fiador","Matrícula do imóvel do fiador (quitado)","Certidão de casamento do fiador (se casado)"],
    "caucao":["Comprovante do depósito da caução","Termo de caução assinado pelo locatário"],
    "seguro_fianca":["Apólice/aprovação do seguro-fiança","Proposta da seguradora aceita"],
    "proprietario":["RG/CNH do proprietário","Matrícula atualizada do imóvel","Formulário do proprietário (dados bancários p/ repasse)","Último IPTU / conta de consumo"],
    "locatario_pj":["Contrato social da empresa locatária (última alteração)","Cartão CNPJ da empresa locatária","Faturamento 12 meses ou extrato bancário da empresa locatária","IR da empresa locatária","RG/CNH dos representantes da empresa locatária","Certidão de estado civil dos representantes da locatária","RG/CNH dos moradores maiores de 18 anos"],
    "proprietario_pj":["Contrato social da empresa proprietária (última alteração)","RG/CNH do representante da empresa proprietária","Certidão de estado civil do representante da proprietária","Matrícula, escritura ou contrato de compra e venda do imóvel","Fatura CPFL do imóvel","Contracapa do IPTU do imóvel","Fatura SAAE do imóvel","Boleto do condomínio (opcional)","CND do condomínio (opcional)","Boleto do gás (opcional)"]
  }'::jsonb
$$;

-- 3) Regras internas (sem grant a ninguém) -------------------------------------------------------------------------
-- Item opcional: nome termina em "(opcional)". Aparece no checklist, não trava. Espelho de itemOpcional().
CREATE OR REPLACE FUNCTION public.locacao_doc_opcional(_item text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT coalesce(_item ~* '[(]opcional[)][[:space:]]*$', false)
$$;

-- Regras da imobiliária: igual à Fase 1, mas a imobiliária que já salvou a lista de documentos (antes das listas PJ)
-- passa a ver as listas PJ padrão (só as chaves que ela ainda não tem; nada do que salvou muda).
CREATE OR REPLACE FUNCTION public.locacao_cfg(_org uuid) RETURNS public.locacao_config
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.locacao_config;
BEGIN
  SELECT * INTO _c FROM public.locacao_config WHERE organization_id = _org;
  IF _c.organization_id IS NULL THEN
    -- Sem linha: padrão da maquete (mesmos valores dos DEFAULT da tabela).
    _c.organization_id := _org; _c.pct_coordenador := 10; _c.coordenador_sai_do_corretor := true;
    _c.parceria_divide_por_dois := true; _c.coordenador_na_parceria := true; _c.dia_pagamento_1a15 := 8;
    _c.dia_pagamento_16a31 := 6; _c.reprovada_volta_ao_corretor := true; _c.chave_antes_do_laudo := true;
    _c.seguro_incendio_obrigatorio := false; _c.tabela_taxa := '{"10":50,"9":45,"8":40,"7":35,"6":30}'::jsonb;
    _c.documentos := public.locacao_docs_padrao();
  ELSE
    _c.documentos := (SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                        FROM jsonb_each(public.locacao_docs_padrao()) e WHERE right(e.key, 3) = '_pj') || _c.documentos;
  END IF;
  RETURN _c;
END $$;

-- Lista de um grupo na imobiliária. Grupos PJ sem lista (ou com a lista apagada em Regras) usam a lista PF da
-- mesma parte (é o caso do fiador PJ, cujos documentos ainda não foram informados).
CREATE OR REPLACE FUNCTION public.locacao_docs_grupo(_org uuid, _grupo text) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _j jsonb := (public.locacao_cfg(_org)).documentos; _v jsonb;
BEGIN
  _v := _j->_grupo;
  IF right(_grupo, 3) = '_pj' AND (_v IS NULL OR jsonb_typeof(_v) <> 'array' OR jsonb_array_length(_v) = 0) THEN
    _v := _j->left(_grupo, -3);
  END IF;
  IF _v IS NULL OR jsonb_typeof(_v) <> 'array' THEN RETURN ARRAY[]::text[]; END IF;
  RETURN coalesce((SELECT array_agg(x ORDER BY n) FROM jsonb_array_elements_text(_v) WITH ORDINALITY t(x, n)), ARRAY[]::text[]);
END $$;

-- As 3 partes da locação, na ordem do checklist, com o grupo de documentos de cada uma (PF/PJ vem da ficha).
CREATE OR REPLACE FUNCTION public.locacao_partes(_l public.locacoes)
RETURNS TABLE (ordem integer, parte text, grupo text, rotulo text)
LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT * FROM (VALUES
    (1, 'locatario',
        CASE WHEN _l.ficha->>'locatario_pessoa' = 'pj' THEN 'locatario_pj' ELSE 'locatario' END,
        CASE WHEN _l.ficha->>'locatario_pessoa' = 'pj' THEN 'Locatário PJ' ELSE 'Locatário PF' END),
    (2, _l.garantia,
        CASE WHEN _l.garantia = 'fiador' AND _l.ficha->>'fiador_pessoa' = 'pj' THEN 'fiador_pj' ELSE _l.garantia END,
        CASE _l.garantia WHEN 'fiador' THEN CASE WHEN _l.ficha->>'fiador_pessoa' = 'pj' THEN 'Fiador PJ' ELSE 'Fiador PF' END
          WHEN 'caucao' THEN 'Garantia — Caução' ELSE 'Garantia — Seguro-fiança' END),
    (3, 'proprietario',
        CASE WHEN _l.ficha->>'proprietario_pessoa' = 'pj' THEN 'proprietario_pj' ELSE 'proprietario' END,
        CASE WHEN _l.ficha->>'proprietario_pessoa' = 'pj' THEN 'Proprietário PJ' ELSE 'Proprietário PF' END)
  ) v(ordem, parte, grupo, rotulo)
$$;

-- Checklist da locação (ordem: parte, depois a lista). Nome repetido em duas partes conta uma vez só.
-- Para PF (padrão) dá exatamente a lista de antes (locacao_checklist da Fase 1).
CREATE OR REPLACE FUNCTION public.locacao_checklist_l(_l public.locacoes) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(array_agg(x ORDER BY o), ARRAY[]::text[]) FROM (
    SELECT i.x, min(p.ordem * 1000 + i.n) AS o
      FROM public.locacao_partes(_l) p,
           LATERAL unnest(public.locacao_docs_grupo(_l.organization_id, p.grupo)) WITH ORDINALITY i(x, n)
     GROUP BY i.x) s
$$;

-- Checklist por parte, para a tela (corretor, gestora, setor de contratos — quem vê a locação).
CREATE OR REPLACE FUNCTION public.locacao_partes_json(_l public.locacoes) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('parte', p.parte, 'grupo', p.grupo, 'rotulo', p.rotulo,
      'itens', (SELECT coalesce(jsonb_agg(jsonb_build_object('item', i.x, 'obrigatorio', NOT public.locacao_doc_opcional(i.x),
          'entregue', EXISTS (SELECT 1 FROM public.locacao_documentos d WHERE d.locacao_id = _l.id AND d.item = i.x
                                AND d.removido_em IS NULL)) ORDER BY i.n), '[]'::jsonb)
        FROM unnest(public.locacao_docs_grupo(_l.organization_id, p.grupo)) WITH ORDINALITY i(x, n)))
    ORDER BY p.ordem), '[]'::jsonb)
    FROM public.locacao_partes(_l) p
$$;

-- Ficha: lista fechada de campos e tipos (o resto do formulário da locação). null = em branco.
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
    ELSIF _e.key = 'proprietario' THEN
      IF jsonb_typeof(_e.value) <> 'object' THEN RETURN false; END IF;
      FOR _x IN SELECT key, value FROM jsonb_each(_e.value) LOOP
        IF _x.key NOT IN ('nome', 'telefone', 'email') OR jsonb_typeof(_x.value) NOT IN ('string', 'null')
           OR length(coalesce(_x.value #>> '{}', '')) > 200 THEN
          RETURN false;
        END IF;
      END LOOP;
    ELSE
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;

-- Pessoa ativa da imobiliária (não só fotógrafo): quem pode ser captador.
CREATE OR REPLACE FUNCTION public.locacao_membro_ativo(_uid uuid, _org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(_uid IS NOT NULL AND _org IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.organization_members m JOIN public.profiles p ON p.id = m.user_id
                 WHERE m.user_id = _uid AND m.organization_id = _org AND m.ativo AND p.ativo)
    AND NOT coalesce(public.eh_so_fotografo(_uid), false), false)
$$;

-- Data em que a documentação ficou completa = entrega do último documento obrigatório (null se ainda falta).
-- Calculada do que está anexado: continua certa mesmo se a lista da imobiliária mudar depois.
CREATE OR REPLACE FUNCTION public.locacao_docs_completos_em(_l public.locacoes) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE WHEN cardinality(public.locacao_docs_faltando(_l)) = 0 THEN coalesce(
    (SELECT max(d.enviado_em) FROM public.locacao_documentos d
      WHERE d.locacao_id = _l.id AND d.removido_em IS NULL AND NOT public.locacao_doc_opcional(d.item)
        AND d.item = ANY (public.locacao_checklist_l(_l))),
    _l.docs_completos_em, _l.criado_em) END
$$;

-- Grava a data da documentação completa (e registra no histórico quando completa ou volta a faltar).
CREATE OR REPLACE FUNCTION public.locacao_docs_situacao(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes; _nova timestamptz; _antes timestamptz;
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id;
  IF _l.id IS NULL THEN RETURN; END IF;
  _antes := _l.docs_completos_em;
  _nova := public.locacao_docs_completos_em(_l);
  IF _nova IS NOT DISTINCT FROM _antes THEN RETURN; END IF;
  UPDATE public.locacoes SET docs_completos_em = _nova WHERE id = _id RETURNING * INTO _l;
  IF _antes IS NULL THEN
    PERFORM public.locacao_evento(_l, 'corretor', 'Documentação completa: todos os documentos obrigatórios entregues');
  ELSIF _nova IS NULL THEN
    PERFORM public.locacao_evento(_l, 'corretor', 'Documentação voltou a ficar incompleta (falta '
      || cardinality(public.locacao_docs_faltando(_l)) || ')');
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.locacao_doc_opcional(text), public.locacao_docs_grupo(uuid, text),
  public.locacao_partes(public.locacoes), public.locacao_checklist_l(public.locacoes),
  public.locacao_partes_json(public.locacoes), public.locacao_ficha_ok(jsonb), public.locacao_membro_ativo(uuid, uuid),
  public.locacao_docs_completos_em(public.locacoes), public.locacao_docs_situacao(uuid) FROM PUBLIC, anon, authenticated;

-- 4) Para a tela: pessoas da imobiliária que podem ser o corretor captador -----------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_corretores() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx();
BEGIN
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome) ORDER BY p.nome), '[]')
    FROM public.profiles p JOIN public.organization_members m ON m.user_id = p.id AND m.organization_id = _org AND m.ativo
   WHERE p.ativo AND NOT coalesce(public.eh_so_fotografo(p.id), false));
END $$;
REVOKE ALL ON FUNCTION public.locacao_corretores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_corretores() TO authenticated;

-- 5) Ficha de abertura (etapa 1, pelo corretor) ---------------------------------------------------------------------
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
     WHERE e.key NOT IN ('cpf', 'nome', 'nascimento', 'telefone', 'email') OR jsonb_typeof(e.value) NOT IN ('string', 'null')
        OR length(coalesce(e.value #>> '{}', '')) > 200) THEN
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

-- Envio: o que já se pedia + o obrigatório da ficha cadastral (espelho de faltasPreAnalise/faltasFicha).
CREATE OR REPLACE FUNCTION public.locacao_enviar_pre(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _f text[] := ARRAY[]::text[];
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pre_analise'], 'corretor');
  IF coalesce(_l.candidato->>'cpf', '') !~ '^[0-9]{3}[.]?[0-9]{3}[.]?[0-9]{3}-?[0-9]{2}$' THEN _f := array_append(_f, 'CPF'); END IF;
  IF length(btrim(coalesce(_l.candidato->>'nome', ''))) < 5 THEN _f := array_append(_f, 'nome completo'); END IF;
  IF coalesce(_l.candidato->>'nascimento', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN _f := array_append(_f, 'data de nascimento'); END IF;
  IF length(regexp_replace(coalesce(_l.candidato->>'telefone', ''), '[^0-9]', '', 'g')) < 10 THEN _f := array_append(_f, 'telefone'); END IF;
  IF coalesce(_l.candidato->>'email', '') !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' THEN _f := array_append(_f, 'e-mail'); END IF;
  IF length(coalesce(_l.endereco, '')) < 8 THEN _f := array_append(_f, 'endereço do imóvel'); END IF;
  IF _l.aluguel IS NULL THEN _f := array_append(_f, 'aluguel'); END IF;
  IF btrim(coalesce(_l.ficha->>'imovel_id', '')) = '' THEN _f := array_append(_f, 'ID do imóvel'); END IF;
  IF coalesce(_l.ficha->>'mobilia', '') = '' THEN _f := array_append(_f, 'mobília'); END IF;
  IF coalesce((_l.ficha->>'metragem')::numeric, 0) <= 0 THEN _f := array_append(_f, 'metragem'); END IF;
  IF length(btrim(coalesce(_l.ficha->>'locatario_endereco', ''))) < 8 THEN _f := array_append(_f, 'endereço atual do locatário'); END IF;
  IF length(btrim(coalesce(_l.ficha->'proprietario'->>'nome', ''))) < 3 THEN _f := array_append(_f, 'nome do proprietário'); END IF;
  IF btrim(coalesce(_l.ficha->'proprietario'->>'telefone', '')) = '' AND btrim(coalesce(_l.ficha->'proprietario'->>'email', '')) = '' THEN
    _f := array_append(_f, 'telefone ou e-mail do proprietário');
  END IF;
  IF _l.captador_id IS NULL THEN _f := array_append(_f, 'corretor captador'); END IF;
  IF cardinality(_f) > 0 THEN
    RAISE EXCEPTION 'Preencha: %', array_to_string(_f, ', ') USING ERRCODE = '22023';
  END IF;
  _l := public.locacao_mover(_id, 'aprovacao', false, NULL);
  PERFORM public.locacao_evento(_l, 'corretor', 'Pré-análise enviada à gestora');
  RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
END $$;

-- 6) Documentos: checklist por parte (PF/PJ) e item opcional ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_docs_faltando(_l public.locacoes) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(array_agg(i ORDER BY n), ARRAY[]::text[])
    FROM unnest(public.locacao_checklist_l(_l)) WITH ORDINALITY AS t(i, n)
   WHERE NOT public.locacao_doc_opcional(t.i)
     AND NOT EXISTS (SELECT 1 FROM public.locacao_documentos d WHERE d.locacao_id = _l.id AND d.item = t.i
                        AND d.removido_em IS NULL)
$$;

CREATE OR REPLACE FUNCTION public.locacao_grupo_do_item(_l public.locacoes, _item text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT p.parte FROM public.locacao_partes(_l) p
                    WHERE _item = ANY (public.locacao_docs_grupo(_l.organization_id, p.grupo))
                    ORDER BY p.ordem LIMIT 1), 'outro')
$$;

CREATE OR REPLACE FUNCTION public.locacao_documento_preparar(_id uuid, _item text, _ext text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id);
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao', 'minuta'], 'corretor');
  IF _item IS NULL OR NOT (_item = ANY (public.locacao_checklist_l(_l))) THEN
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
  PERFORM public.locacao_exige(_l, ARRAY['documentacao', 'minuta'], 'corretor');
  IF _item IS NULL OR NOT (_item = ANY (public.locacao_checklist_l(_l))) THEN
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
  PERFORM public.locacao_exige(_l, ARRAY['documentacao'], 'corretor');
  UPDATE public.locacao_documentos SET removido_em = now() WHERE id = _doc;
  PERFORM public.locacao_evento(_l, 'corretor', 'Documento removido: ' || _d.item);
  PERFORM public.locacao_docs_situacao(_l.id);
  RETURN true;
END $$;

-- 7) Detalhe: checklist por parte, data da documentação completa e captador --------------------------------------------
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

-- 8) Regras: as listas PJ também são editáveis pela administração da imobiliária ---------------------------------------
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
       WHERE e.key NOT IN ('locatario', 'fiador', 'caucao', 'seguro_fianca', 'proprietario',
                           'locatario_pj', 'fiador_pj', 'proprietario_pj') OR jsonb_typeof(e.value) <> 'array'
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
  RETURN to_jsonb(_c) - 'organization_id' - 'atualizado_por';
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation THEN
  RAISE EXCEPTION 'Valor inválido nas regras' USING ERRCODE = '22023';
END $$;

-- 9) Trava "Montar contrato": sem documento obrigatório faltando para enviar a minuta ou preparar a assinatura ------
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
        CASE _l.garantia WHEN 'fiador' THEN 'Fiador' WHEN 'caucao' THEN 'Caução' ELSE 'Seguro-fiança' END);
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

COMMIT;
