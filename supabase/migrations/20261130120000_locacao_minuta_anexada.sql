-- Locação — minuta anexada e versionada + trava do envio + registro de andamento + pagamento 8/23
-- (t_f8f83f9f, Pacote 1 do plano t_55cd3848; decisão de Denis 16/11, tópico 6238: opção A).
--
-- Rollback: supabase/rollback/20261130120000_locacao_minuta_anexada.sql
-- Teste:    supabase/tests/run-locacao-minuta.sh (homologação, transação desfeita; nunca produção).
--
-- O que muda:
--  * Tabela nova locacao_minutas: cada arquivo de minuta anexado (PDF ou Word) ou gerado pelo modelo ("Gerar e
--    guardar") vira uma versão (v1, v2…) com data e responsável. O arquivo fica no bucket privado locacao-documentos,
--    na pasta <org>/<locação>/minutas/. Só o setor de contratos (ou administrador) anexa; quem vê a locação
--    (corretor dono, papéis da locação, gerência, financeiro, líder do corretor) baixa por URL assinada curta.
--  * Trava: "Enviar minuta ao corretor" (locacao_contratos_acao/enviar_minuta) e "Preparar assinatura" (inclusive com o
--    atalho "minuta pronta de outra RE/MAX") recusam sem arquivo de minuta. Anexar uma versão nova depois do envio
--    volta a minuta para "elaborando" (o corretor confere a versão nova).
--  * Tabela nova locacao_andamentos: nota livre do setor de contratos com "aguardando quem" (proprietário, locatário,
--    corretor ou seguradora), sem mudar a situação da minuta. Fica aberta até alguém resolver; o corretor vê a lista e
--    resolve as que aguardam o corretor. "Cobrar pendência" e "Marcar em ajuste" continuam iguais.
--  * Comissão: o padrão do dia de pagamento para chaves de 16 a 31 passa de 6 para 23 (o de 1 a 15 continua 8).
--    Nenhuma linha de locacao_config é gravada; imobiliária que salvou valor próprio continua com o dela.
--  * O bucket passa a aceitar também Word (.doc/.docx). O upload do corretor continua restrito a PDF/imagem pela RPC.
--  * Nada é apagado; nenhuma locação existente é alterada.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- 1) Tabelas --------------------------------------------------------------------------------------------------------
CREATE TABLE public.locacao_minutas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  locacao_id uuid NOT NULL REFERENCES public.locacoes(id) ON DELETE CASCADE,
  versao integer NOT NULL CONSTRAINT locacao_minutas_versao_check CHECK (versao >= 1),
  origem text NOT NULL CONSTRAINT locacao_minutas_origem_check CHECK (origem IN ('anexo', 'gerada', 'externa')),
  storage_path text NOT NULL CONSTRAINT locacao_minutas_path_unico UNIQUE,
  nome_arquivo text NOT NULL CONSTRAINT locacao_minutas_nome_check CHECK (length(nome_arquivo) BETWEEN 1 AND 200),
  enviado_por uuid,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locacao_minutas_versao_unica UNIQUE (locacao_id, versao)
);

CREATE TABLE public.locacao_andamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  locacao_id uuid NOT NULL REFERENCES public.locacoes(id) ON DELETE CASCADE,
  etapa text NOT NULL,
  texto text NOT NULL CONSTRAINT locacao_andamentos_texto_check CHECK (length(texto) BETWEEN 5 AND 500),
  aguardando text CONSTRAINT locacao_andamentos_aguardando_check
    CHECK (aguardando IS NULL OR aguardando IN ('proprietario', 'locatario', 'corretor', 'seguradora')),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz,
  resolvido_por uuid,
  resolucao text CONSTRAINT locacao_andamentos_resolucao_check CHECK (resolucao IS NULL OR length(resolucao) <= 500),
  CONSTRAINT locacao_andamentos_resolvido_check CHECK (resolvido_em IS NULL OR aguardando IS NOT NULL)
);
CREATE INDEX locacao_andamentos_loc_idx ON public.locacao_andamentos (locacao_id, criado_em);

ALTER TABLE public.locacao_minutas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_andamentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locacao_minutas, public.locacao_andamentos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.locacao_minutas, public.locacao_andamentos TO service_role;

-- Word além de PDF/imagem (a minuta feita fora do sistema costuma vir em .docx). Bucket continua privado.
UPDATE storage.buckets SET allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
 WHERE id = 'locacao-documentos';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'locacao-documentos' AND public = false)
  THEN RAISE EXCEPTION 'Bucket locacao-documentos deve existir e ser privado'; END IF;
END $$;

-- Pagamento da comissão: chaves de 16 a 31 → dia 23 (padrão; não grava em locacao_config).
ALTER TABLE public.locacao_config ALTER COLUMN dia_pagamento_16a31 SET DEFAULT 23;

-- 2) Funções internas -----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_minuta_atual(_loc uuid) RETURNS public.locacao_minutas
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT m FROM public.locacao_minutas m WHERE m.locacao_id = _loc ORDER BY m.versao DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.locacao_minuta_atual(uuid) FROM PUBLIC, anon, authenticated;

-- Regras da imobiliária: igual a 20261113120000, só o padrão do dia de 16 a 31 passa de 6 para 23.
CREATE OR REPLACE FUNCTION public.locacao_cfg(_org uuid) RETURNS public.locacao_config
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _c public.locacao_config;
BEGIN
  SELECT * INTO _c FROM public.locacao_config WHERE organization_id = _org;
  IF _c.organization_id IS NULL THEN
    -- Sem linha: padrão (mesmos valores dos DEFAULT da tabela).
    _c.organization_id := _org; _c.pct_coordenador := 10; _c.coordenador_sai_do_corretor := true;
    _c.parceria_divide_por_dois := true; _c.coordenador_na_parceria := true; _c.dia_pagamento_1a15 := 8;
    _c.dia_pagamento_16a31 := 23; _c.reprovada_volta_ao_corretor := true; _c.chave_antes_do_laudo := true;
    _c.seguro_incendio_obrigatorio := false; _c.tabela_taxa := '{"10":50,"9":45,"8":40,"7":35,"6":30}'::jsonb;
    _c.documentos := public.locacao_docs_padrao();
  ELSE
    _c.documentos := (SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                        FROM jsonb_each(public.locacao_docs_padrao()) e WHERE right(e.key, 3) = '_pj') || _c.documentos;
  END IF;
  RETURN _c;
END $$;

-- 3) Minuta: anexar (preparar → upload por URL assinada no servidor → registrar) e baixar ----------------------------
CREATE OR REPLACE FUNCTION public.locacao_minuta_preparar(_id uuid, _ext text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id);
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['minuta'], 'contratos');
  IF _ext IS NULL OR _ext NOT IN ('pdf', 'doc', 'docx') THEN
    RAISE EXCEPTION 'A minuta deve ser PDF ou Word (.doc/.docx).' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('path', _l.organization_id::text || '/' || _l.id::text || '/minutas/'
    || gen_random_uuid()::text || '.' || _ext);
END $$;
REVOKE ALL ON FUNCTION public.locacao_minuta_preparar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_minuta_preparar(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_minuta_registrar(_id uuid, _path text, _nome text, _origem text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _m jsonb; _v integer; _o text; _nm text; _novo uuid;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['minuta'], 'contratos');
  IF _origem IS NULL OR _origem NOT IN ('anexo', 'gerada') THEN
    RAISE EXCEPTION 'Origem inválida.' USING ERRCODE = '22023';
  END IF;
  IF _path IS NULL OR _path !~ ('^' || _l.organization_id::text || '/' || _l.id::text || '/minutas/[0-9a-f-]{36}[.](pdf|doc|docx)$')
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'locacao-documentos' AND o.name = _path) THEN
    RAISE EXCEPTION 'Arquivo da minuta não encontrado.' USING ERRCODE = '22023';
  END IF;
  IF _origem = 'gerada' AND _path !~ '[.]pdf$' THEN
    RAISE EXCEPTION 'A minuta gerada pelo modelo é PDF.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.locacao_minutas WHERE storage_path = _path) THEN
    RAISE EXCEPTION 'Arquivo já registrado.' USING ERRCODE = '22023';
  END IF;
  _m := _l.minuta;
  _o := CASE WHEN coalesce((_m->>'externa')::boolean, false) AND _origem = 'anexo' THEN 'externa' ELSE _origem END;
  _nm := left(coalesce(nullif(btrim(_nome), ''), 'minuta'), 200);
  -- A locação está travada (FOR UPDATE em locacao_pega): duas gravações seguidas não pegam o mesmo número.
  SELECT coalesce(max(versao), 0) + 1 INTO _v FROM public.locacao_minutas WHERE locacao_id = _l.id;
  INSERT INTO public.locacao_minutas (organization_id, locacao_id, versao, origem, storage_path, nome_arquivo, enviado_por)
  VALUES (_l.organization_id, _l.id, _v, _o, _path, _nm, auth.uid()) RETURNING id INTO _novo;
  PERFORM public.locacao_evento(_l, 'contratos', 'Minuta v' || _v || ' '
    || CASE _o WHEN 'gerada' THEN 'gerada pelo modelo e guardada' WHEN 'externa' THEN 'de outra RE/MAX anexada'
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
REVOKE ALL ON FUNCTION public.locacao_minuta_registrar(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_minuta_registrar(uuid, text, text, text) TO authenticated;

-- Baixar: devolve o caminho só para quem vê a locação (o servidor gera a URL assinada curta).
CREATE OR REPLACE FUNCTION public.locacao_minuta_ver(_minuta uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _v public.locacao_minutas; _l public.locacoes;
BEGIN
  SELECT * INTO _v FROM public.locacao_minutas WHERE id = _minuta AND organization_id = _org;
  SELECT * INTO _l FROM public.locacoes WHERE id = _v.locacao_id;
  IF _v.id IS NULL OR _l.id IS NULL OR NOT public.locacao_pode_ver(_l) THEN
    RAISE EXCEPTION 'Sem acesso a esta minuta.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('path', _v.storage_path, 'nome', _v.nome_arquivo, 'versao', _v.versao);
END $$;
REVOKE ALL ON FUNCTION public.locacao_minuta_ver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_minuta_ver(uuid) TO authenticated;

-- 4) Registro de andamento (não muda a situação da minuta) ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_andamento_registrar(_id uuid, _texto text, _aguardando text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _t text := nullif(btrim(coalesce(_texto, '')), '');
  _a text := nullif(btrim(coalesce(_aguardando, '')), ''); _novo uuid;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['minuta', 'assinatura'], 'contratos');
  IF _t IS NULL OR length(_t) < 5 THEN RAISE EXCEPTION 'Descreva o andamento.' USING ERRCODE = '22023'; END IF;
  IF _a IS NOT NULL AND _a NOT IN ('proprietario', 'locatario', 'corretor', 'seguradora') THEN
    RAISE EXCEPTION 'Aguardando quem? Escolha proprietário, locatário, corretor ou seguradora.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.locacao_andamentos (organization_id, locacao_id, etapa, texto, aguardando, criado_por)
  VALUES (_l.organization_id, _l.id, _l.etapa, left(_t, 500), _a, auth.uid()) RETURNING id INTO _novo;
  PERFORM public.locacao_evento(_l, 'contratos', 'Andamento: ' || _t || coalesce(' — aguardando ' || CASE _a
    WHEN 'proprietario' THEN 'proprietário' WHEN 'locatario' THEN 'locatário' ELSE _a END, ''));
  RETURN jsonb_build_object('id', _novo);
END $$;
REVOKE ALL ON FUNCTION public.locacao_andamento_registrar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_andamento_registrar(uuid, text, text) TO authenticated;

-- Resolver: setor de contratos resolve qualquer uma; o corretor da locação, as que aguardam o corretor.
CREATE OR REPLACE FUNCTION public.locacao_andamento_resolver(_andamento uuid, _texto text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _n public.locacao_andamentos; _l public.locacoes;
  _t text := nullif(btrim(coalesce(_texto, '')), ''); _papel text;
BEGIN
  SELECT * INTO _n FROM public.locacao_andamentos WHERE id = _andamento AND organization_id = _org;
  IF _n.id IS NULL THEN RAISE EXCEPTION 'Sem acesso a este andamento.' USING ERRCODE = '42501'; END IF;
  _l := public.locacao_pega(_n.locacao_id);
  IF _n.aguardando IS NULL OR _n.resolvido_em IS NOT NULL THEN
    RAISE EXCEPTION 'Este andamento não está aberto.' USING ERRCODE = '22023';
  END IF;
  IF _l.etapa NOT IN ('minuta', 'assinatura') THEN
    RAISE EXCEPTION 'Ação não disponível nesta etapa.' USING ERRCODE = '22023';
  END IF;
  IF public.locacao_tem_papel(auth.uid(), 'contratos') THEN
    _papel := 'contratos';
  ELSIF _n.aguardando = 'corretor' AND _l.corretor_id = auth.uid() THEN
    _papel := 'corretor';
  ELSE
    RAISE EXCEPTION 'Só o setor de contratos (ou o corretor, quando aguarda o corretor) resolve.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.locacao_andamentos SET resolvido_em = now(), resolvido_por = auth.uid(), resolucao = left(_t, 500)
   WHERE id = _n.id;
  PERFORM public.locacao_evento(_l, _papel, 'Andamento resolvido: ' || left(_n.texto, 200) || coalesce(' — ' || _t, ''));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.locacao_andamento_resolver(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_andamento_resolver(uuid, text) TO authenticated;

-- 5) Ações do setor de contratos: igual a 20261124130000 + trava "sem arquivo não envia / não prepara assinatura" ---
CREATE OR REPLACE FUNCTION public.locacao_contratos_acao(_id uuid, _acao text, _dados jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _m jsonb; _a jsonb; _t text; _doc text; _f text[];
  _mv public.locacao_minutas;
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
    -- Sem arquivo de minuta guardado no sistema, o corretor não teria o que conferir nem a assinatura o que enviar.
    _mv := public.locacao_minuta_atual(_l.id);
    IF _mv.id IS NULL THEN
      RAISE EXCEPTION '%', CASE WHEN _acao = 'enviar_minuta'
        THEN 'Envio travado: anexe a minuta (PDF ou Word) ou use "Gerar e guardar" antes de enviar ao corretor.'
        ELSE 'Assinatura travada: anexe o arquivo da minuta antes de preparar a assinatura'
          || CASE WHEN coalesce((_m->>'externa')::boolean, false) THEN ' (vale também para a minuta pronta de outra RE/MAX).'
             ELSE '.' END END USING ERRCODE = '22023';
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
    _m := _m || jsonb_build_object('estado', 'com_corretor', 'versao_enviada', _mv.versao,
      'modelo', CASE WHEN _l.tipo = 'comercial' THEN 'Comercial' ELSE 'Residencial' END || ' — ' ||
        public.locacao_garantia_rotulo(_l.garantia));
    PERFORM public.locacao_evento(_l, 'contratos', 'Minuta v' || _mv.versao || ' enviada ao corretor ('
      || _mv.nome_arquivo || CASE WHEN coalesce((_m->>'externa')::boolean, false) THEN ', de outra RE/MAX' ELSE '' END || ')');
  ELSIF _acao = 'marcar_ajuste' THEN
    _m := _m || jsonb_build_object('estado', 'ajuste', 'ajuste_data', (now() AT TIME ZONE 'America/Sao_Paulo')::date,
      'ajuste_motivo', coalesce(left(_t, 500), 'Pedido do proprietário'));
    PERFORM public.locacao_evento(_l, 'contratos', 'Minuta EM AJUSTE: ' || coalesce(_t, 'pedido do proprietário'));
  ELSIF _acao = 'preparar_assinatura' THEN
    IF coalesce(_m->>'estado', '') <> 'aprovada' AND NOT coalesce((_m->>'externa')::boolean, false) THEN
      RAISE EXCEPTION 'A minuta ainda não foi aprovada pelo corretor/proprietário.' USING ERRCODE = '22023';
    END IF;
    _m := _m || jsonb_build_object('estado', 'aprovada', 'versao_assinatura', _mv.versao);
    UPDATE public.locacoes SET minuta = _m, assinatura = jsonb_build_object('adm', 'nao', 'loc', 'nao', 'vist', 'nao',
      'vist_junto', false, 'modo', 'manual') WHERE id = _id;
    _l := public.locacao_mover(_id, 'assinatura', false, NULL);
    PERFORM public.locacao_evento(_l, 'contratos', 'Minuta v' || _mv.versao || ' aprovada — preparando assinatura');
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

-- 6) Detalhe: igual a 20261124120000 + versões da minuta e andamentos ----------------------------------------------
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
        'nome_arquivo', v.nome_arquivo, 'enviado_em', v.enviado_em, 'enviado_por_nome', pr.nome)
        ORDER BY v.versao DESC), '[]')
        FROM public.locacao_minutas v LEFT JOIN public.profiles pr ON pr.id = v.enviado_por WHERE v.locacao_id = _l.id),
    'andamentos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'etapa', a.etapa, 'texto', a.texto,
        'aguardando', a.aguardando, 'criado_em', a.criado_em, 'criado_por_nome', pc.nome, 'resolvido_em', a.resolvido_em,
        'resolvido_por_nome', pr.nome, 'resolucao', a.resolucao) ORDER BY a.criado_em DESC), '[]')
        FROM public.locacao_andamentos a LEFT JOIN public.profiles pc ON pc.id = a.criado_por
        LEFT JOIN public.profiles pr ON pr.id = a.resolvido_por WHERE a.locacao_id = _l.id),
    'eventos', (SELECT coalesce(jsonb_agg(jsonb_build_object('em', e.em, 'etapa', e.etapa, 'papel', e.papel,
        'descricao', e.descricao, 'ator_nome', pr.nome) ORDER BY e.em, e.id), '[]')
        FROM public.locacao_eventos e LEFT JOIN public.profiles pr ON pr.id = e.ator_id WHERE e.locacao_id = _l.id));
END $$;
COMMIT;
