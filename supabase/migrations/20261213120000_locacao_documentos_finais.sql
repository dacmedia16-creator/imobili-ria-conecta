-- Locação — DOCUMENTOS FINAIS: contrato e laudo de vistoria assinados guardados no sistema + envio ao locatário e ao
-- proprietário pelo WhatsApp (t_dfc8daf2; pedido de Denis 20/11/2026, tópico 6238).
-- CONSTRUÇÃO EM TESTE: aplicar em produção só junto com o lote da Locação, depois da revisão e do "pode publicar".
--
-- Rollback: supabase/rollback/20261213120000_locacao_documentos_finais.sql
-- Teste:    supabase/tests/run-locacao-docs-finais.sh (homologação, transação desfeita; nunca produção).
--
-- O que muda:
--  * Tabela nova locacao_docs_finais: PDF do contrato de locação assinado, do contrato de administração assinado
--    (opcional) e do laudo de vistoria assinado. Pasta <org>/<locação>/finais/ do bucket PRIVADO locacao-documentos.
--    Cada arquivo guarda o SHA-256 do conteúdo: anexar de novo o MESMO arquivo não cria versão nem envio novo.
--  * Quem anexa: setor de contratos (contratos) e vistoria (laudo; contratos também quando a vistoria foi junto).
--    Quem vê/baixa: SÓ o corretor daquela locação, a gestora, contratos, vistoria e a gerência (admin/staff).
--    Outros corretores, líderes e o financeiro não veem esses arquivos. Nada disso entra em "Consultar imóvel".
--  * Travas: \"marcar assinado\" do contrato de locação exige o PDF do contrato anexado; do laudo (vistoria junto) e
--    \"laudo registrado\" no pós-assinatura exigem o PDF do laudo. O contrato de administração não trava (opcional).
--  * Tabela nova locacao_docs_finais_envios: registro de cada envio pelo WhatsApp (quem pediu, quando, para quem —
--    só os 4 últimos dígitos do telefone —, status). Envio automático tem chave única por locação + tipo + conteúdo +
--    destinatário: o mesmo arquivo nunca é enviado duas vezes automaticamente. Quem envia é o servidor do site, que
--    só manda com a trava própria LOCACAO_DOCS_FINAIS_WHATSAPP=on (desligada por padrão).
--  * Nada é apagado; nenhuma locação existente muda.
-- Funções redefinidas (o rollback devolve o texto exato anterior): locacao_contratos_acao (20261130120000),
--   locacao_pos_acao e locacao_detalhe (20261201120000).
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- 1) Tabelas --------------------------------------------------------------------------------------------------------
CREATE TABLE public.locacao_docs_finais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  locacao_id uuid NOT NULL REFERENCES public.locacoes(id) ON DELETE CASCADE,
  tipo text NOT NULL CONSTRAINT locacao_docs_finais_tipo_check CHECK (tipo IN ('contrato_locacao', 'contrato_adm', 'laudo')),
  storage_path text NOT NULL CONSTRAINT locacao_docs_finais_path_unico UNIQUE,
  nome_arquivo text NOT NULL CONSTRAINT locacao_docs_finais_nome_check CHECK (length(nome_arquivo) BETWEEN 1 AND 200),
  sha256 text NOT NULL CONSTRAINT locacao_docs_finais_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  enviado_por uuid,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locacao_docs_finais_conteudo_unico UNIQUE (locacao_id, tipo, sha256)
);
CREATE INDEX locacao_docs_finais_loc_idx ON public.locacao_docs_finais (locacao_id, tipo, enviado_em);

CREATE TABLE public.locacao_docs_finais_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  locacao_id uuid NOT NULL REFERENCES public.locacoes(id) ON DELETE CASCADE,
  doc_final_id uuid NOT NULL REFERENCES public.locacao_docs_finais(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  sha256 text NOT NULL,
  destinatario text NOT NULL CONSTRAINT locacao_docs_finais_envios_dest_check CHECK (destinatario IN ('locatario', 'proprietario')),
  origem text NOT NULL CONSTRAINT locacao_docs_finais_envios_origem_check CHECK (origem IN ('auto', 'reenvio')),
  telefone_final text CONSTRAINT locacao_docs_finais_envios_tel_check CHECK (telefone_final IS NULL OR telefone_final ~ '^[0-9]{4}$'),
  status text NOT NULL CONSTRAINT locacao_docs_finais_envios_status_check
    CHECK (status IN ('enviando', 'enviado', 'falhou', 'incerto', 'sem_telefone')),
  erro text CONSTRAINT locacao_docs_finais_envios_erro_check CHECK (erro IS NULL OR length(erro) <= 300),
  solicitado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  concluido_em timestamptz
);
-- Idempotência do envio automático: mesmo conteúdo + mesmo destinatário = no máximo 1 envio automático, qualquer status.
CREATE UNIQUE INDEX locacao_docs_finais_envios_auto_uniq
  ON public.locacao_docs_finais_envios (locacao_id, tipo, sha256, destinatario) WHERE origem = 'auto';
CREATE INDEX locacao_docs_finais_envios_doc_idx ON public.locacao_docs_finais_envios (doc_final_id, criado_em);

ALTER TABLE public.locacao_docs_finais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_docs_finais_envios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locacao_docs_finais, public.locacao_docs_finais_envios FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.locacao_docs_finais, public.locacao_docs_finais_envios TO service_role;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'locacao-documentos' AND public = false
                   AND 'application/pdf' = ANY (allowed_mime_types))
  THEN RAISE EXCEPTION 'Bucket locacao-documentos deve existir, ser privado e aceitar PDF'; END IF;
END $$;

-- 2) Funções internas -----------------------------------------------------------------------------------------------
-- Quem vê e baixa os documentos finais (decisão de Denis 20/11): o corretor DAQUELA locação, gestora, contratos,
-- vistoria e a gerência da MESMA imobiliária. Mais estreito que locacao_pode_ver (sem financeiro e sem líder).
CREATE FUNCTION public.locacao_finais_pode_ver(_l public.locacoes) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(_l.organization_id = public.current_org_id() AND auth.uid() IS NOT NULL AND (
    _l.corretor_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.locacao_papeis p WHERE p.organization_id = _l.organization_id AND p.user_id = auth.uid()
                AND p.papel IN ('gestora', 'contratos', 'vistoria'))
    OR public.locacao_eh_gerencia(auth.uid())), false)
$$;
REVOKE ALL ON FUNCTION public.locacao_finais_pode_ver(public.locacoes) FROM PUBLIC, anon, authenticated;

-- Quem anexa cada tipo e em que etapas (a partir da assinatura; também depois, para guardar o que faltou).
CREATE FUNCTION public.locacao_final_exige(_l public.locacoes, _tipo text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF _tipo IS NULL OR _tipo NOT IN ('contrato_locacao', 'contrato_adm', 'laudo') THEN
    RAISE EXCEPTION 'Tipo de documento inválido.' USING ERRCODE = '22023';
  END IF;
  IF _l.etapa NOT IN ('assinatura', 'pos_assinatura', 'chaves', 'comissao') THEN
    RAISE EXCEPTION 'Os documentos assinados são anexados a partir da etapa de assinatura.' USING ERRCODE = '22023';
  END IF;
  IF _tipo IN ('contrato_locacao', 'contrato_adm') THEN
    IF public.locacao_tem_papel(auth.uid(), 'contratos') THEN RETURN 'contratos'; END IF;
    RAISE EXCEPTION 'Só o setor de contratos anexa o contrato assinado.' USING ERRCODE = '42501';
  END IF;
  IF public.locacao_tem_papel(auth.uid(), 'vistoria') THEN RETURN 'vistoria'; END IF;
  IF public.locacao_tem_papel(auth.uid(), 'contratos') AND coalesce((_l.assinatura->>'vist_junto')::boolean, false) THEN
    RETURN 'contratos';
  END IF;
  RAISE EXCEPTION 'Só a vistoria anexa o laudo assinado.' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.locacao_final_exige(public.locacoes, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.locacao_final_tem(_loc uuid, _tipo text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.locacao_docs_finais f WHERE f.locacao_id = _loc AND f.tipo = _tipo)
$$;
REVOKE ALL ON FUNCTION public.locacao_final_tem(uuid, text) FROM PUBLIC, anon, authenticated;

-- Telefone já cadastrado na locação: dados do contrato (que já trazem o telefone da pré-análise) ou a ficha.
CREATE FUNCTION public.locacao_final_telefone(_l public.locacoes, _dest text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE _dest
    WHEN 'locatario' THEN nullif(btrim(coalesce(public.locacao_contrato_valores(_l)->>'loc_telefone', '')), '')
    WHEN 'proprietario' THEN coalesce(nullif(btrim(coalesce(public.locacao_contrato_valores(_l)->>'prop_telefone', '')), ''),
                                      nullif(btrim(coalesce(_l.ficha#>>'{proprietario,telefone}', '')), ''))
  END
$$;
REVOKE ALL ON FUNCTION public.locacao_final_telefone(public.locacoes, text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.locacao_final_tel_ok(_tel text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT regexp_replace(coalesce(_tel, ''), '[^0-9]', '', 'g') ~ '^(55)?[1-9][0-9]{9,10}$'
$$;
REVOKE ALL ON FUNCTION public.locacao_final_tel_ok(text) FROM PUBLIC, anon, authenticated;

-- Para quem vai cada tipo: o contrato de administração é do proprietário com a imobiliária (o locatário não recebe).
CREATE FUNCTION public.locacao_final_destinos(_tipo text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE _tipo WHEN 'contrato_adm' THEN ARRAY['proprietario'] ELSE ARRAY['locatario', 'proprietario'] END
$$;
REVOKE ALL ON FUNCTION public.locacao_final_destinos(text) FROM PUBLIC, anon, authenticated;

-- 3) Anexar (preparar → upload por URL assinada no servidor → registrar), ver/baixar ---------------------------------
CREATE FUNCTION public.locacao_final_preparar(_id uuid, _tipo text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id);
BEGIN
  PERFORM public.locacao_final_exige(_l, _tipo);
  RETURN jsonb_build_object('path', _l.organization_id::text || '/' || _l.id::text || '/finais/'
    || gen_random_uuid()::text || '.pdf');
END $$;
REVOKE ALL ON FUNCTION public.locacao_final_preparar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_final_preparar(uuid, text) TO authenticated;

-- _sha256: calculado pelo servidor do site a partir do arquivo já gravado no bucket (o navegador não informa).
-- shortcut: a RPC é chamável com login; quem já tem o papel poderia informar um hash falso — o efeito fica limitado à
-- deduplicação do envio automático da própria locação (o arquivo, o caminho e o tipo continuam conferidos aqui).
CREATE FUNCTION public.locacao_final_registrar(_id uuid, _tipo text, _path text, _nome text, _sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _papel text; _ex uuid; _novo uuid; _nm text;
BEGIN
  _papel := public.locacao_final_exige(_l, _tipo);
  IF _path IS NULL OR _path !~ ('^' || _l.organization_id::text || '/' || _l.id::text || '/finais/[0-9a-f-]{36}[.]pdf$')
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'locacao-documentos' AND o.name = _path) THEN
    RAISE EXCEPTION 'Arquivo não encontrado.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT o.metadata->>'mimetype' FROM storage.objects o WHERE o.bucket_id = 'locacao-documentos' AND o.name = _path)
     IS DISTINCT FROM 'application/pdf' THEN
    RAISE EXCEPTION 'Envie o documento assinado em PDF.' USING ERRCODE = '22023';
  END IF;
  IF _sha256 IS NULL OR _sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Conferência do arquivo inválida.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.locacao_docs_finais WHERE storage_path = _path) THEN
    RAISE EXCEPTION 'Arquivo já registrado.' USING ERRCODE = '22023';
  END IF;
  -- Mesmo conteúdo já guardado para este tipo: não cria versão (e o envio automático não repete).
  SELECT f.id INTO _ex FROM public.locacao_docs_finais f WHERE f.locacao_id = _l.id AND f.tipo = _tipo AND f.sha256 = _sha256;
  IF _ex IS NOT NULL THEN
    RETURN jsonb_build_object('id', _ex, 'repetido', true);
  END IF;
  _nm := left(coalesce(nullif(btrim(_nome), ''), 'documento.pdf'), 200);
  INSERT INTO public.locacao_docs_finais (organization_id, locacao_id, tipo, storage_path, nome_arquivo, sha256, enviado_por)
  VALUES (_l.organization_id, _l.id, _tipo, _path, _nm, _sha256, auth.uid()) RETURNING id INTO _novo;
  PERFORM public.locacao_evento(_l, _papel, CASE _tipo WHEN 'contrato_locacao' THEN 'Contrato de locação assinado anexado'
    WHEN 'contrato_adm' THEN 'Contrato de administração assinado anexado' ELSE 'Laudo de vistoria assinado anexado' END
    || ' (' || _nm || ')');
  UPDATE public.locacoes SET atualizado_em = now() WHERE id = _l.id;
  RETURN jsonb_build_object('id', _novo, 'repetido', false);
END $$;
REVOKE ALL ON FUNCTION public.locacao_final_registrar(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_final_registrar(uuid, text, text, text, text) TO authenticated;

-- Ver/baixar e "pode reenviar": devolve o caminho só para quem pode ver os documentos finais (o servidor assina a URL).
CREATE FUNCTION public.locacao_final_ver(_doc uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _f public.locacao_docs_finais; _l public.locacoes;
BEGIN
  SELECT * INTO _f FROM public.locacao_docs_finais WHERE id = _doc AND organization_id = _org;
  SELECT * INTO _l FROM public.locacoes WHERE id = _f.locacao_id AND organization_id = _org;
  IF _f.id IS NULL OR _l.id IS NULL OR NOT public.locacao_finais_pode_ver(_l) THEN
    RAISE EXCEPTION 'Sem acesso a este documento.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('path', _f.storage_path, 'nome', _f.nome_arquivo, 'tipo', _f.tipo,
    'codigo', 'LOC-' || lpad(_l.numero::text, 4, '0'), 'ativa', _l.situacao = 'ativa');
END $$;
REVOKE ALL ON FUNCTION public.locacao_final_ver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_final_ver(uuid) TO authenticated;

-- 4) Envio pelo WhatsApp: só o servidor (service_role) reserva e conclui -----------------------------------------
-- Reserva os envios de um documento. 'auto': no máximo 1 por conteúdo + destinatário (índice único). 'reenvio': pedido
-- do corretor/equipe; recusa se o mesmo destinatário já tem envio deste documento em andamento ou enviado há < 2 min
-- (duplo clique). Sem telefone válido: registra 'sem_telefone' e não devolve para envio.
CREATE FUNCTION public.locacao_final_reservar(_doc uuid, _origem text, _destinatario text, _ator uuid)
RETURNS TABLE (envio_id uuid, destinatario text, telefone text, storage_path text, tipo text, codigo text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
DECLARE _f public.locacao_docs_finais; _l public.locacoes; _d text; _tel text; _id uuid; _dig text;
BEGIN
  IF _origem IS NULL OR _origem NOT IN ('auto', 'reenvio') THEN RAISE EXCEPTION 'Origem inválida' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _f FROM public.locacao_docs_finais WHERE id = _doc FOR UPDATE;
  IF _f.id IS NULL THEN RETURN; END IF;
  SELECT * INTO _l FROM public.locacoes WHERE id = _f.locacao_id AND organization_id = _f.organization_id;
  IF _l.id IS NULL OR _l.situacao <> 'ativa' THEN RETURN; END IF;
  IF _destinatario IS NOT NULL AND NOT (_destinatario = ANY (public.locacao_final_destinos(_f.tipo))) THEN
    RAISE EXCEPTION 'Destinatário inválido para este documento.' USING ERRCODE = '22023';
  END IF;
  FOREACH _d IN ARRAY public.locacao_final_destinos(_f.tipo) LOOP
    CONTINUE WHEN _destinatario IS NOT NULL AND _d <> _destinatario;
    _tel := public.locacao_final_telefone(_l, _d);
    _dig := regexp_replace(coalesce(_tel, ''), '[^0-9]', '', 'g');
    IF _origem = 'reenvio' AND EXISTS (SELECT 1 FROM public.locacao_docs_finais_envios e WHERE e.doc_final_id = _f.id
         AND e.destinatario = _d AND ((e.status = 'enviando' AND e.criado_em > now() - interval '10 minutes')
           OR (e.status = 'enviado' AND e.criado_em > now() - interval '2 minutes'))) THEN
      CONTINUE;
    END IF;
    _id := NULL;
    INSERT INTO public.locacao_docs_finais_envios AS e (organization_id, locacao_id, doc_final_id, tipo, sha256, destinatario,
      origem, telefone_final, status, erro, solicitado_por, concluido_em)
    VALUES (_f.organization_id, _f.locacao_id, _f.id, _f.tipo, _f.sha256, _d, _origem,
      CASE WHEN public.locacao_final_tel_ok(_tel) THEN right(_dig, 4) END,
      CASE WHEN public.locacao_final_tel_ok(_tel) THEN 'enviando' ELSE 'sem_telefone' END,
      CASE WHEN public.locacao_final_tel_ok(_tel) THEN NULL ELSE 'telefone não cadastrado na locação' END,
      _ator, CASE WHEN public.locacao_final_tel_ok(_tel) THEN NULL ELSE clock_timestamp() END)
    ON CONFLICT (locacao_id, tipo, sha256, destinatario) WHERE origem = 'auto' DO NOTHING
    RETURNING e.id INTO _id;
    IF _id IS NOT NULL AND public.locacao_final_tel_ok(_tel) THEN
      envio_id := _id; destinatario := _d; telefone := _tel; storage_path := _f.storage_path; tipo := _f.tipo;
      codigo := 'LOC-' || lpad(_l.numero::text, 4, '0');
      RETURN NEXT;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.locacao_final_concluir(_envio uuid, _status text, _erro text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF _status IS NULL OR _status NOT IN ('enviado', 'falhou', 'incerto') THEN
    RAISE EXCEPTION 'Status inválido' USING ERRCODE = '22023';
  END IF;
  UPDATE public.locacao_docs_finais_envios SET status = _status, erro = left(_erro, 300), concluido_em = clock_timestamp()
   WHERE id = _envio AND status = 'enviando';
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.locacao_final_reservar(uuid, text, text, uuid), public.locacao_final_concluir(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.locacao_final_reservar(uuid, text, text, uuid), public.locacao_final_concluir(uuid, text, text)
  TO service_role;

-- 5) Travas: igual a 20261130120000 + "marcar assinado" do contrato de locação/laudo exige o PDF anexado -------------
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
    -- Documentos finais (t_dfc8daf2): o contrato de locação e o laudo só contam como assinados com o PDF guardado.
    IF _doc = 'loc' AND NOT public.locacao_final_tem(_l.id, 'contrato_locacao') THEN
      RAISE EXCEPTION 'Anexe o PDF do contrato de locação assinado (Documentos finais) antes de marcar como assinado.'
        USING ERRCODE = '22023';
    END IF;
    IF _doc = 'vist' AND NOT public.locacao_final_tem(_l.id, 'laudo') THEN
      RAISE EXCEPTION 'Anexe o PDF do laudo de vistoria assinado (Documentos finais) antes de marcar como assinado.'
        USING ERRCODE = '22023';
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

-- Pós-assinatura: igual a 20261201120000 + "laudo registrado" exige o PDF do laudo anexado.
CREATE OR REPLACE FUNCTION public.locacao_pos_acao(_id uuid, _acao text, _dados jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _p jsonb; _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _c public.locacao_config; _data date; _alerta text; _desc text; _s text;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['pos_assinatura', 'chaves'], 'vistoria');
  _p := _l.pos; _dados := coalesce(_dados, '{}'::jsonb);
  IF _acao = 'vistoria_pedida' THEN _p := _p || jsonb_build_object('vistoria_pedida', _hoje); _desc := 'Vistoria pedida';
  ELSIF _acao = 'laudo_assinado' THEN
    IF _p->>'vistoria_pedida' IS NULL AND NOT coalesce((_p->>'vist_junto')::boolean, false) THEN
      RAISE EXCEPTION 'Registre antes o pedido de vistoria.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.locacao_final_tem(_l.id, 'laudo') THEN
      RAISE EXCEPTION 'Anexe o PDF do laudo de vistoria assinado (Documentos finais) antes de registrar.' USING ERRCODE = '22023';
    END IF;
    _p := _p || jsonb_build_object('laudo_em', _hoje); _desc := 'Laudo de vistoria assinado';
  ELSIF _acao = 'contestacao' THEN _p := _p || jsonb_build_object('contestacao_em', _hoje); _desc := 'Contestação de vistoria registrada';
  ELSIF _acao = 'seguro' THEN
    _p := _p || jsonb_build_object('seguro_em', _hoje, 'apolice', left(nullif(btrim(coalesce(_dados->>'apolice', '')), ''), 60));
    _desc := 'Seguro contratado' || coalesce(' — apólice ' || nullif(btrim(coalesce(_dados->>'apolice', '')), ''), '');
  ELSIF _acao = 'condominio_aviso' THEN _p := _p || jsonb_build_object('condominio_aviso', _hoje); _desc := 'Condomínio avisado';
  ELSIF _acao = 'sem_condominio' THEN _p := _p || jsonb_build_object('sem_condominio', true); _desc := 'Imóvel sem condomínio';
  ELSIF _acao = 'mudanca' THEN
    _data := (_dados->>'data')::date;
    IF _data IS NULL THEN RAISE EXCEPTION 'Informe a data da mudança.' USING ERRCODE = '22023'; END IF;
    _p := _p || jsonb_build_object('mudanca', _data); _desc := 'Mudança agendada para ' || to_char(_data, 'DD/MM/YYYY');
  ELSIF _acao = 'titularidade_aplica' THEN
    _s := _dados->>'servico';
    IF _s IS NULL OR _s NOT IN ('cpfl', 'saae', 'gas') THEN RAISE EXCEPTION 'Serviço inválido' USING ERRCODE = '22023'; END IF;
    _p := jsonb_set(_p, ARRAY['tit', _s, 'aplica'], to_jsonb(coalesce((_dados->>'aplica')::boolean, true)), true);
    _desc := upper(_s) || CASE WHEN coalesce((_dados->>'aplica')::boolean, true) THEN ' se aplica' ELSE ' não se aplica' END;
  ELSIF _acao = 'pronto_para_chaves' THEN
    _c := public.locacao_cfg(_l.organization_id);
    IF _l.etapa <> 'pos_assinatura' THEN RAISE EXCEPTION 'Ação não disponível nesta etapa.' USING ERRCODE = '22023'; END IF;
    IF _c.seguro_incendio_obrigatorio AND _p->>'seguro_em' IS NULL THEN
      RAISE EXCEPTION 'Seguro incêndio obrigatório nesta imobiliária: registre o seguro antes.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.locacoes SET pos = _p WHERE id = _id;
    _l := public.locacao_mover(_id, 'chaves', false, NULL);
    PERFORM public.locacao_evento(_l, 'vistoria', 'Pós-assinatura concluída — aguardando entrega das chaves');
    RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
  ELSIF _acao = 'entregar_chaves' THEN
    _c := public.locacao_cfg(_l.organization_id);
    IF _l.garantia = 'seguro_fianca' AND NOT public.locacao_tem_apolice(_l.id) THEN
      RAISE EXCEPTION 'Apólice pendente — anexe para liberar a entrega de chaves.' USING ERRCODE = '22023';
    END IF;
    _data := coalesce((_dados->>'data')::date, _hoje);
    IF _data > _hoje + 1 OR _data < _hoje - 120 THEN RAISE EXCEPTION 'Data de entrega inválida.' USING ERRCODE = '22023'; END IF;
    IF _c.seguro_incendio_obrigatorio AND _p->>'seguro_em' IS NULL THEN
      RAISE EXCEPTION 'Seguro incêndio obrigatório nesta imobiliária: registre o seguro antes.' USING ERRCODE = '22023';
    END IF;
    IF _p->>'laudo_em' IS NULL THEN
      IF NOT _c.chave_antes_do_laudo THEN
        RAISE EXCEPTION 'Laudo de vistoria ainda não assinado: entrega da chave bloqueada nesta imobiliária.' USING ERRCODE = '22023';
      END IF;
      _alerta := ' (ALERTA: laudo de vistoria ainda não assinado)';
    END IF;
    UPDATE public.locacoes SET pos = _p, chave_em = _data WHERE id = _id;
    _l := public.locacao_mover(_id, 'comissao', false, NULL);
    UPDATE public.locacoes SET etapa_desde = _data::timestamp AT TIME ZONE 'America/Sao_Paulo' WHERE id = _id RETURNING * INTO _l;
    PERFORM public.locacao_evento(_l, 'vistoria', 'Chaves entregues em ' || to_char(_data, 'DD/MM/YYYY') || coalesce(_alerta, ''));
    RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa, 'alerta', _alerta IS NOT NULL);
  ELSE
    RAISE EXCEPTION 'Ação inválida' USING ERRCODE = '22023';
  END IF;
  UPDATE public.locacoes SET pos = _p, atualizado_em = now() WHERE id = _id RETURNING * INTO _l;
  PERFORM public.locacao_evento(_l, 'vistoria', _desc);
  RETURN jsonb_build_object('ok', true, 'etapa', _l.etapa);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Valor inválido' USING ERRCODE = '22023';
END $$;

-- 6) Detalhe: igual a 20261201120000 + documentos finais (só para quem pode ver) --------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_detalhe(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _l public.locacoes; _f text[]; _pf boolean;
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id AND organization_id = _org;
  IF _l.id IS NULL OR NOT public.locacao_pode_ver(_l) THEN
    RAISE EXCEPTION 'Sem acesso a esta locação.' USING ERRCODE = '42501';
  END IF;
  _f := public.locacao_docs_faltando(_l);
  _pf := public.locacao_finais_pode_ver(_l);
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
        'nome_arquivo', v.nome_arquivo, 'enviado_em', v.enviado_em, 'enviado_por_nome', pr.nome,
        'modelo_chave', v.modelo_chave, 'modelo_versao', v.modelo_versao)
        ORDER BY v.versao DESC), '[]')
        FROM public.locacao_minutas v LEFT JOIN public.profiles pr ON pr.id = v.enviado_por WHERE v.locacao_id = _l.id),
    'anexos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'tipo', x.tipo, 'nome_arquivo', x.nome_arquivo,
        'numero', x.numero, 'enviado_em', x.enviado_em, 'enviado_por_nome', pr.nome) ORDER BY x.enviado_em DESC), '[]')
        FROM public.locacao_anexos x LEFT JOIN public.profiles pr ON pr.id = x.enviado_por WHERE x.locacao_id = _l.id),
    'apolice_pendente', _l.garantia = 'seguro_fianca' AND NOT public.locacao_tem_apolice(_l.id),
    -- Documentos finais (t_dfc8daf2): a existência de cada tipo vai para todos (trava na tela); arquivos, envios e
    -- telefones só para quem pode ver (corretor da locação, gestora, contratos, vistoria, gerência).
    'finais_tem', CASE WHEN _pf THEN jsonb_build_object('contrato_locacao', public.locacao_final_tem(_l.id, 'contrato_locacao'),
      'contrato_adm', public.locacao_final_tem(_l.id, 'contrato_adm'), 'laudo', public.locacao_final_tem(_l.id, 'laudo')) END,
    'finais_pode', _pf,
    'finais_tel', CASE WHEN _pf THEN jsonb_build_object(
      'locatario', public.locacao_final_tel_ok(public.locacao_final_telefone(_l, 'locatario')),
      'proprietario', public.locacao_final_tel_ok(public.locacao_final_telefone(_l, 'proprietario'))) END,
    'finais', CASE WHEN _pf THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'tipo', f.tipo,
        'nome_arquivo', f.nome_arquivo, 'enviado_em', f.enviado_em, 'enviado_por_nome', pr.nome,
        'envios', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'destinatario', e.destinatario,
            'origem', e.origem, 'status', e.status, 'erro', e.erro, 'telefone_final', e.telefone_final,
            'criado_em', e.criado_em, 'solicitado_por_nome', ps.nome) ORDER BY e.criado_em DESC), '[]')
            FROM public.locacao_docs_finais_envios e LEFT JOIN public.profiles ps ON ps.id = e.solicitado_por
           WHERE e.doc_final_id = f.id)) ORDER BY f.enviado_em DESC), '[]')
        FROM public.locacao_docs_finais f LEFT JOIN public.profiles pr ON pr.id = f.enviado_por WHERE f.locacao_id = _l.id)
      ELSE '[]'::jsonb END,
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
