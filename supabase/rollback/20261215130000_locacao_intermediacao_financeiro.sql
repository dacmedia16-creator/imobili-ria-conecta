-- Voltar o Financeiro ao estado anterior à parte 2, depois de voltar o site.
-- Interrompe se houver registros de intermediação: primeiro concilie a receita com o Financeiro;
-- nunca descarte recebíveis/baixas silenciosamente.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.locacao_intermediacoes) THEN
   RAISE EXCEPTION 'Há intermediações: concilie os lançamentos antes de reverter.';
 END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.locacao_modelos WHERE organization_id IS NOT NULL AND chave LIKE '%_intermediacao')
    OR EXISTS (SELECT 1 FROM public.locacao_minutas WHERE modelo_chave LIKE '%_intermediacao') THEN
   RAISE EXCEPTION 'Modelos editados ou minutas geradas: concilie antes de reverter.';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.locacao_fin_criar_contrato(_l public.locacoes) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cfg public.locacao_fin_config := public.locacao_fin_cfg(_l.organization_id); _id uuid;
BEGIN
  IF _l.chave_em IS NULL OR _l.aluguel IS NULL THEN RETURN NULL; END IF;
  -- t_ec2962bd: sem administração não gera contrato mensal; o recebível de intermediação é registrado na entrega da chave.
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

CREATE OR REPLACE FUNCTION public.locacao_fin_painel(_competencia date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_fin_ctx(); _comp date := date_trunc('month', coalesce(_competencia, public.locacao_fin_hoje()))::date;
BEGIN
  RETURN jsonb_build_object(
    'competencia', _comp, 'hoje', public.locacao_fin_hoje(),
    'config', to_jsonb(public.locacao_fin_cfg(_org)) - 'organization_id' - 'atualizado_por',
    'pode_regras', public.locacao_fin_pode_regras(auth.uid(), _org),
    'contratos', (SELECT coalesce(jsonb_agg(public.locacao_fin_ct_json(ct) ORDER BY ct.numero), '[]')
                    FROM public.locacao_contratos ct WHERE ct.organization_id = _org),
    'cobrancas', (SELECT coalesce(jsonb_agg(public.locacao_fin_cob_json(c) ORDER BY c.vencimento, c.id), '[]')
                    FROM public.locacao_cobrancas c WHERE c.organization_id = _org AND c.competencia = _comp),
    'atrasadas_antes', (SELECT coalesce(jsonb_agg(public.locacao_fin_cob_json(c) ORDER BY c.vencimento), '[]')
                    FROM public.locacao_cobrancas c WHERE c.organization_id = _org AND c.competencia < _comp
                     AND c.status = 'aberta' AND c.vencimento < public.locacao_fin_hoje()),
    'faltam_gerar', (SELECT count(*) FROM public.locacao_contratos ct WHERE ct.organization_id = _org AND ct.situacao = 'ativo'
                      AND date_trunc('month', ct.inicio) <= _comp
                      AND NOT EXISTS (SELECT 1 FROM public.locacao_cobrancas c WHERE c.contrato_id = ct.id AND c.competencia = _comp)));
END $$;

CREATE OR REPLACE FUNCTION public.locacao_modelo_garantia_ok(_garantia text, _chave text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT coalesce(CASE _garantia
    WHEN 'fiador' THEN _chave = 'fiador'
    WHEN 'caucao' THEN _chave IN ('caucao_dinheiro', 'caucao_imovel')
    WHEN 'outras' THEN _chave = 'caucao_imovel'
    WHEN 'seguro_fianca' THEN _chave IN ('seguro_porto', 'seguro_pottencial', 'seguro_tokio', 'seguro_almada')
    WHEN 'loft' THEN _chave = 'loft'
    ELSE false END, false)
$$;
CREATE OR REPLACE FUNCTION public.locacao_modelos_listar() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_modelo_exige();
BEGIN
  RETURN (SELECT coalesce(jsonb_agg(public.locacao_modelo_json(public.locacao_modelo_atual(_org, p.chave)) - 'paragrafos'
      || jsonb_build_object('versoes', (SELECT count(*) FROM public.locacao_modelos o WHERE o.organization_id = _org
                                          AND o.chave = p.chave))
      ORDER BY array_position(ARRAY['fiador', 'caucao_dinheiro', 'caucao_imovel', 'seguro_porto', 'seguro_pottencial',
        'seguro_tokio', 'seguro_almada', 'loft'], p.chave)), '[]'::jsonb)
    FROM (SELECT DISTINCT chave FROM public.locacao_modelos WHERE organization_id IS NULL) p);
END $$;
CREATE OR REPLACE FUNCTION public.locacao_montagem_ler(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_montagem_pega(_id); _o public.organizations; _c jsonb;
BEGIN
  SELECT * INTO _o FROM public.organizations WHERE id = _l.organization_id;
  SELECT campos INTO _c FROM public.locacao_montagem WHERE locacao_id = _id AND organization_id = _l.organization_id;
  RETURN jsonb_build_object('campos', coalesce(_c, '{}'::jsonb),
    'contrato', public.locacao_contrato_valores(_l),
    'administradora', jsonb_build_object('nome', coalesce(_o.razao_social, _o.nome),
      'cnpj', _o.cnpj, 'creci', _o.creci, 'cidade', _o.cidade, 'uf', _o.uf),
    'modelos', (SELECT coalesce(jsonb_object_agg(k, public.locacao_modelo_json(public.locacao_modelo_atual(_l.organization_id, k))), '{}'::jsonb)
                  FROM unnest(ARRAY['fiador', 'caucao_dinheiro', 'caucao_imovel', 'seguro_porto', 'seguro_pottencial',
                    'seguro_tokio', 'seguro_almada', 'loft']) k WHERE public.locacao_modelo_garantia_ok(_l.garantia, k)),
    'apolice', (SELECT a.numero FROM public.locacao_anexos a WHERE a.locacao_id = _l.id AND a.tipo = 'apolice'
                 ORDER BY a.enviado_em DESC LIMIT 1));
END $$;
CREATE OR REPLACE FUNCTION public.locacao_minuta_registrar(_id uuid, _path text, _nome text, _origem text,
  _modelo_chave text DEFAULT NULL, _modelo_versao integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _m jsonb; _v integer; _o text; _nm text; _novo uuid;
  _mod public.locacao_modelos;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['minuta'], 'contratos');
  IF _origem IS NULL OR _origem NOT IN ('anexo', 'gerada') THEN
    RAISE EXCEPTION 'Origem inválida.' USING ERRCODE = '22023';
  END IF;
  IF _path IS NULL OR _path !~ ('^' || _l.organization_id::text || '/' || _l.id::text || '/minutas/[0-9a-f-]{36}[.](pdf|doc|docx)$')
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'locacao-documentos' AND o.name = _path) THEN
    RAISE EXCEPTION 'Arquivo da minuta não encontrado.' USING ERRCODE = '22023';
  END IF;
  IF _origem = 'gerada' THEN
    IF _path !~ '[.]pdf$' OR NOT public.locacao_modelo_garantia_ok(_l.garantia, _modelo_chave) THEN
      RAISE EXCEPTION 'Esta garantia não tem modelo para gerar a minuta (PDF): anexe a minuta feita por fora.' USING ERRCODE = '22023';
    END IF;
    _mod := public.locacao_modelo_atual(_l.organization_id, _modelo_chave);
    IF _modelo_versao IS DISTINCT FROM (CASE WHEN _mod.organization_id IS NULL THEN 0 ELSE _mod.versao END) THEN
      RAISE EXCEPTION 'O modelo de contrato mudou enquanto você montava: recarregue e gere de novo.' USING ERRCODE = '22023';
    END IF;
  ELSIF _modelo_chave IS NOT NULL OR _modelo_versao IS NOT NULL THEN
    RAISE EXCEPTION 'Origem inválida.' USING ERRCODE = '22023';
  END IF;
  -- Tipo real gravado no storage tem de bater com a extensão (o navegador declara o tipo no upload).
  IF (SELECT o.metadata->>'mimetype' FROM storage.objects o WHERE o.bucket_id = 'locacao-documentos' AND o.name = _path)
     IS DISTINCT FROM (CASE WHEN _path LIKE '%.pdf' THEN 'application/pdf'
       WHEN _path LIKE '%.doc' THEN 'application/msword'
       ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' END) THEN
    RAISE EXCEPTION 'O tipo do arquivo não confere com a extensão (envie PDF ou Word).' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.locacao_minutas WHERE storage_path = _path) THEN
    RAISE EXCEPTION 'Arquivo já registrado.' USING ERRCODE = '22023';
  END IF;
  _m := _l.minuta;
  _o := CASE WHEN coalesce((_m->>'externa')::boolean, false) AND _origem = 'anexo' THEN 'externa' ELSE _origem END;
  _nm := left(coalesce(nullif(btrim(_nome), ''), 'minuta'), 200);
  -- A locação está travada (FOR UPDATE em locacao_pega): duas gravações seguidas não pegam o mesmo número.
  SELECT coalesce(max(versao), 0) + 1 INTO _v FROM public.locacao_minutas WHERE locacao_id = _l.id;
  INSERT INTO public.locacao_minutas (organization_id, locacao_id, versao, origem, storage_path, nome_arquivo, enviado_por,
    modelo_chave, modelo_versao)
  VALUES (_l.organization_id, _l.id, _v, _o, _path, _nm, auth.uid(), CASE WHEN _o = 'gerada' THEN _modelo_chave END,
    CASE WHEN _o = 'gerada' THEN _modelo_versao END) RETURNING id INTO _novo;
  PERFORM public.locacao_evento(_l, 'contratos', 'Minuta v' || _v || ' '
    || CASE _o WHEN 'gerada' THEN 'gerada pelo modelo "' || _mod.titulo || '" (texto '
         || CASE WHEN _modelo_versao = 0 THEN 'padrão' ELSE 'v' || _modelo_versao END || ') e guardada' WHEN 'externa' THEN 'de outra RE/MAX anexada'
       ELSE 'anexada' END || ' (' || _nm || ')');
  -- Versão nova depois do envio: volta a "elaborando" para o corretor conferir a versão nova.
  IF coalesce(_m->>'estado', '') IN ('', 'com_corretor', 'aprovada') THEN
    IF _m->>'estado' IN ('com_corretor', 'aprovada') THEN
      PERFORM public.locacao_evento(_l, 'contratos', 'Minuta volta a "elaborando": a versão v' || _v
        || ' ainda não foi enviada ao corretor');
    END IF;
    _m := _m || jsonb_build_object('estado', 'elaborando');
    UPDATE public.locacoes SET minuta = _m, atualizado_em = now() WHERE id = _l.id;
  ELSE
    UPDATE public.locacoes SET atualizado_em = now() WHERE id = _l.id;
  END IF;
  RETURN jsonb_build_object('id', _novo, 'versao', _v);
END $$;
CREATE OR REPLACE FUNCTION public.locacao_modelo_validar(_chave text, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE _e jsonb; _t text; _out jsonb := '[]'::jsonb; _ids text[] := ARRAY[]::text[]; _x text; _bl text[] := ARRAY[]::text[];
BEGIN
  IF _p IS NULL OR jsonb_typeof(_p) <> 'array' OR jsonb_array_length(_p) < 5 OR jsonb_array_length(_p) > 400 THEN
    RAISE EXCEPTION 'Modelo inválido: lista de cláusulas vazia ou grande demais.' USING ERRCODE = '22023';
  END IF;
  FOR _e IN SELECT value FROM jsonb_array_elements(_p) LOOP
    IF jsonb_typeof(_e) <> 'object' OR jsonb_typeof(_e->'t') IS DISTINCT FROM 'string' OR jsonb_typeof(_e->'id') IS DISTINCT FROM 'string'
       OR (_e ? 'trava' AND jsonb_typeof(_e->'trava') <> 'boolean')
       OR (_e ? 'dest' AND (_e->>'dest') NOT IN ('residencial', 'comercial'))
       OR (_e ? 'cond' AND (_e->>'cond') NOT IN ('isencao_multa'))
       OR (_e ? 'adaptado' AND jsonb_typeof(_e->'adaptado') <> 'boolean')
       OR (_e->>'id') !~ '^[a-z0-9_-]{1,24}$' THEN
      RAISE EXCEPTION 'Modelo inválido: cláusula mal formada.' USING ERRCODE = '22023';
    END IF;
    _t := btrim(_e->>'t');
    IF length(_t) < 1 OR length(_t) > 8000 THEN
      RAISE EXCEPTION 'Cláusula vazia ou longa demais (máx. 8.000 caracteres).' USING ERRCODE = '22023';
    END IF;
    IF (_e->>'id') = ANY (_ids) THEN RAISE EXCEPTION 'Modelo inválido: cláusula repetida.' USING ERRCODE = '22023'; END IF;
    _ids := _ids || (_e->>'id');
    -- Bloco automático: parágrafo que é só [[NOME]].
    IF _t ~ '^\[\[[A-Z_]+\]\]$' THEN
      _x := substring(_t FROM 3 FOR length(_t) - 4);
      IF NOT (_x = ANY (public.locacao_modelo_blocos())) THEN
        RAISE EXCEPTION 'Bloco automático desconhecido: [[%]]', _x USING ERRCODE = '22023';
      END IF;
      IF _x = ANY (_bl) THEN RAISE EXCEPTION 'Bloco automático repetido: [[%]]', _x USING ERRCODE = '22023'; END IF;
      _bl := _bl || _x;
    ELSIF _t ~ '\[\[' THEN
      RAISE EXCEPTION 'Bloco automático [[...]] tem de ficar sozinho no parágrafo.' USING ERRCODE = '22023';
    ELSE
      FOR _x IN SELECT (regexp_matches(_t, '\[([A-Z_]+)\]', 'g'))[1] LOOP
        IF NOT (_x = ANY (public.locacao_modelo_campos())) THEN
          RAISE EXCEPTION 'Campo que não existe: [%]. Use um dos campos da lista.', _x USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
    _out := _out || jsonb_strip_nulls(jsonb_build_object('id', _e->>'id', 't', _t,
      'trava', CASE WHEN coalesce((_e->>'trava')::boolean, false) THEN true END, 'dest', _e->>'dest', 'cond', _e->>'cond',
      'adaptado', CASE WHEN coalesce((_e->>'adaptado')::boolean, false) THEN true END));
  END LOOP;
  FOREACH _x IN ARRAY ARRAY['LOCADOR', 'LOCATARIO', 'OBJETO', 'PRAZO', 'ASSINATURAS']
                 || CASE WHEN _chave = 'fiador' THEN ARRAY['FIADOR'] ELSE ARRAY[]::text[] END LOOP
    IF NOT (_x = ANY (_bl)) THEN
      RAISE EXCEPTION 'Falta o bloco automático [[%]] (dados que o sistema preenche).', _x USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN _out;
END $$;
DELETE FROM public.locacao_modelos WHERE organization_id IS NULL AND chave LIKE '%_intermediacao';
ALTER TABLE public.locacao_modelos DROP CONSTRAINT locacao_modelos_chave_check;
ALTER TABLE public.locacao_modelos ADD CONSTRAINT locacao_modelos_chave_check CHECK (chave IN ('fiador','caucao_dinheiro','caucao_imovel','seguro_porto','seguro_pottencial','seguro_tokio','seguro_almada','loft'));
DROP FUNCTION public.locacao_fin_intermediacao_receber(uuid, date);
DROP TABLE public.locacao_intermediacoes;
COMMIT;
