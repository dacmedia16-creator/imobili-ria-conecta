-- Locação — ficha de cada morador (RG obrigatório para maiores de 18) + "Pacote para a administradora" do condomínio.
-- Cartão t_40cff7e4 (pedido de Denis 20/11/2026, tópico 6238). CONSTRUÇÃO EM TESTE: produção só com aprovação de Denis.
-- Versão posterior a 20261211120000 (#368/#370), 20261211130000 (#369) e 20261212120000 (#371); nenhuma função em comum.
--
-- Rollback: supabase/rollback/20261215120000_locacao_moradores_pacote.sql
-- Teste:    supabase/tests/run-locacao-moradores-pacote.sh (homologação, transação desfeita; nunca produção).
--
-- O que muda:
--  1) Ficha por morador (nome, CPF, nascimento, e-mail, telefone) em locacao_moradores — tabela SEM acesso direto do
--     navegador; lê/grava só por RPC. Lê: corretor da locação, gerência (admin) e gestora da locação. Grava: o corretor
--     (ou admin) na etapa Documentação, como os demais dados do contrato.
--  2) Morador com 18 anos ou mais (pela data de nascimento, dia de hoje em São Paulo) gera o item obrigatório
--     "Cópia do RG — <nome>" no checklist do locatário. Envio, bucket privado, registro e link assinado são os mesmos dos
--     outros documentos (locacao_documento_preparar/registrar/ver não mudam: conferem o item contra locacao_checklist_l).
--     Menor de 18 não gera item.
--  3) O contrato continua recebendo o campo "moradores" com o mesmo texto de hoje ("Nome — CPF xxx", um por linha):
--     o banco gera esse texto a partir da ficha a cada gravação. Montagem e minuta não mudam.
--  4) Locações antigas: coluna nova locacoes.moradores_ficha nasce FALSE para as linhas existentes (valor padrão, sem
--     UPDATE — nenhum gatilho dispara) e TRUE para as novas. Antigas seguem com o texto livre até alguém salvar a ficha;
--     novas só aceitam moradores pela ficha.
--  5) Pacote para a administradora (imóvel de condomínio): locacao_pacote_preparar confere acesso (corretor da locação,
--     gerência ou gestora), ficha preenchida e RGs obrigatórios entregues e devolve os dados + caminhos dos RGs SÓ para o
--     servidor do site, que monta o PDF. locacao_pacote_registrar grava quem baixou e quando (locacao_pacote_downloads)
--     e um evento no histórico. O sistema não envia nada por e-mail.
-- Funções redefinidas (o rollback devolve o texto exato de produção, conferido por md5 em 20/11): locacao_checklist_l,
--   locacao_partes_json, locacao_contrato_salvar. Nenhuma locação existente é alterada.
BEGIN;
SELECT set_config('lock_timeout', '5s', true);

-- 1) Estrutura -------------------------------------------------------------------------------------------------------
-- Valor padrão FALSE preenche as linhas existentes sem reescrever a tabela; em seguida o padrão vira TRUE (novas).
ALTER TABLE public.locacoes ADD COLUMN moradores_ficha boolean NOT NULL DEFAULT false;
ALTER TABLE public.locacoes ALTER COLUMN moradores_ficha SET DEFAULT true;

CREATE TABLE public.locacao_moradores (
  locacao_id uuid PRIMARY KEY REFERENCES public.locacoes(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- [{"id","nome","cpf","nascimento":"AAAA-MM-DD","email","telefone"}] — validado em locacao_moradores_salvar.
  pessoas jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT locacao_moradores_pessoas_check CHECK (jsonb_typeof(pessoas) = 'array'),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);
CREATE TABLE public.locacao_pacote_downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locacao_id uuid NOT NULL REFERENCES public.locacoes(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  baixado_por uuid NOT NULL,
  baixado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX locacao_pacote_downloads_loc_idx ON public.locacao_pacote_downloads (locacao_id, baixado_em DESC);
ALTER TABLE public.locacao_moradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locacao_pacote_downloads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.locacao_moradores, public.locacao_pacote_downloads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.locacao_moradores, public.locacao_pacote_downloads TO service_role;

-- 2) Regras puras ----------------------------------------------------------------------------------------------------
-- 18 anos completos na data civil de hoje em São Paulo. Espelho de moradorAdulto() (src/lib/locacao-moradores.ts).
CREATE FUNCTION public.locacao_morador_adulto(_nascimento text) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT CASE WHEN coalesce(_nascimento, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    THEN _nascimento::date <= ((now() AT TIME ZONE 'America/Sao_Paulo')::date - interval '18 years')::date
    ELSE false END
$$;
-- Nome do item no checklist. Espelho de itemRgMorador().
CREATE FUNCTION public.locacao_morador_item(_nome text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT 'Cópia do RG — ' || btrim(_nome)
$$;
-- Texto do contrato (mesmo formato de hoje). Espelho de textoMoradores().
CREATE FUNCTION public.locacao_moradores_texto(_pessoas jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT coalesce(string_agg(btrim(p->>'nome') || ' — CPF ' || btrim(p->>'cpf'), chr(10) ORDER BY n), '')
    FROM jsonb_array_elements(coalesce(_pessoas, '[]'::jsonb)) WITH ORDINALITY x(p, n)
$$;
-- Itens "Cópia do RG — <nome>" dos moradores adultos desta locação (vazio se não há ficha).
CREATE FUNCTION public.locacao_morador_itens(_l public.locacoes) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(array_agg(public.locacao_morador_item(p->>'nome') ORDER BY n), ARRAY[]::text[])
    FROM public.locacao_moradores m, jsonb_array_elements(m.pessoas) WITH ORDINALITY x(p, n)
   WHERE m.locacao_id = _l.id AND m.organization_id = _l.organization_id
     AND public.locacao_morador_adulto(p->>'nascimento')
$$;
-- Quem vê a ficha completa e baixa o pacote: corretor da locação, gerência (admin/administrador principal/staff) ou
-- gestora da locação — sempre dentro da imobiliária atual.
CREATE FUNCTION public.locacao_morador_pode(_l public.locacoes) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(auth.uid() IS NOT NULL AND _l.organization_id = public.current_org_id() AND (
    _l.corretor_id = auth.uid() OR public.locacao_eh_gerencia(auth.uid())
    OR EXISTS (SELECT 1 FROM public.locacao_papeis p WHERE p.organization_id = _l.organization_id
                AND p.user_id = auth.uid() AND p.papel = 'gestora')), false)
$$;
REVOKE ALL ON FUNCTION public.locacao_morador_adulto(text), public.locacao_morador_item(text),
  public.locacao_moradores_texto(jsonb), public.locacao_morador_itens(public.locacoes),
  public.locacao_morador_pode(public.locacoes) FROM PUBLIC, anon, authenticated;

-- 3) Checklist: RG dos moradores adultos entra na parte do locatário ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_checklist_l(_l public.locacoes) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(array_agg(x ORDER BY o), ARRAY[]::text[]) FROM (
    SELECT i.x, min(p.ordem * 1000 + i.n) AS o
      FROM public.locacao_partes(_l) p,
           LATERAL unnest(public.locacao_docs_grupo(_l.organization_id, p.grupo)
             || CASE WHEN p.parte = 'locatario' THEN public.locacao_morador_itens(_l) ELSE ARRAY[]::text[] END)
             WITH ORDINALITY i(x, n)
     GROUP BY i.x) s
$$;
CREATE OR REPLACE FUNCTION public.locacao_partes_json(_l public.locacoes) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('parte', p.parte, 'grupo', p.grupo, 'rotulo', p.rotulo,
      'itens', (SELECT coalesce(jsonb_agg(jsonb_build_object('item', i.x, 'obrigatorio', NOT public.locacao_doc_opcional(i.x),
          'entregue', EXISTS (SELECT 1 FROM public.locacao_documentos d WHERE d.locacao_id = _l.id AND d.item = i.x
                                AND d.removido_em IS NULL)) ORDER BY i.n), '[]'::jsonb)
        FROM unnest(public.locacao_docs_grupo(_l.organization_id, p.grupo)
          || CASE WHEN p.parte = 'locatario' THEN public.locacao_morador_itens(_l) ELSE ARRAY[]::text[] END)
          WITH ORDINALITY i(x, n)))
    ORDER BY p.ordem), '[]'::jsonb)
    FROM public.locacao_partes(_l) p
$$;

-- 4) Dados do contrato: com ficha (ou locação nova), "moradores" só muda pela ficha ------------------------------------
CREATE OR REPLACE FUNCTION public.locacao_contrato_salvar(_id uuid, _dados jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _e record; _val jsonb; _ori jsonb; _t text; _n integer := 0;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao'], 'corretor');
  IF _dados IS NULL OR jsonb_typeof(_dados) <> 'object' THEN RAISE EXCEPTION 'Dados inválidos' USING ERRCODE = '22023'; END IF;
  -- t_40cff7e4: locação nova ou já com ficha — moradores só pela ficha individual (o texto do contrato sai dela).
  IF _dados ? 'moradores' AND (_l.moradores_ficha OR EXISTS (SELECT 1 FROM public.locacao_moradores WHERE locacao_id = _l.id)) THEN
    RAISE EXCEPTION 'Cadastre os moradores na ficha de moradores.' USING ERRCODE = '22023';
  END IF;
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

-- 5) Ficha de moradores: ler e salvar --------------------------------------------------------------------------------
CREATE FUNCTION public.locacao_moradores_ler(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes; _p jsonb;
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id AND organization_id = public.locacao_ctx();
  IF _l.id IS NULL OR NOT public.locacao_morador_pode(_l) THEN
    RAISE EXCEPTION 'Sem acesso à ficha de moradores.' USING ERRCODE = '42501';
  END IF;
  SELECT pessoas INTO _p FROM public.locacao_moradores WHERE locacao_id = _l.id AND organization_id = _l.organization_id;
  RETURN jsonb_build_object('ficha', _p IS NOT NULL, 'obrigatoria', _l.moradores_ficha, 'pessoas', coalesce(_p, '[]'::jsonb),
    'downloads', (SELECT coalesce(jsonb_agg(jsonb_build_object('em', x.baixado_em, 'por', pr.nome) ORDER BY x.baixado_em DESC), '[]'::jsonb)
      FROM (SELECT * FROM public.locacao_pacote_downloads d WHERE d.locacao_id = _l.id ORDER BY d.baixado_em DESC LIMIT 5) x
      LEFT JOIN public.profiles pr ON pr.id = x.baixado_por));
END $$;
REVOKE ALL ON FUNCTION public.locacao_moradores_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_moradores_ler(uuid) TO authenticated;

CREATE FUNCTION public.locacao_moradores_salvar(_id uuid, _pessoas jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _p jsonb; _ant jsonb; _d date; _adulto boolean; _txt text;
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  PERFORM public.locacao_exige(_l, ARRAY['documentacao'], 'corretor');
  IF _pessoas IS NULL OR jsonb_typeof(_pessoas) <> 'array' OR jsonb_array_length(_pessoas) > 20 THEN
    RAISE EXCEPTION 'Lista de moradores inválida (até 20).' USING ERRCODE = '22023';
  END IF;
  FOR _p IN SELECT value FROM jsonb_array_elements(_pessoas) LOOP
    -- Lista fechada: id + 5 campos, todos texto.
    IF jsonb_typeof(_p) <> 'object' OR NOT (_p ?& ARRAY['id', 'nome', 'cpf', 'nascimento', 'email', 'telefone'])
       OR (SELECT count(*) FROM jsonb_object_keys(_p)) <> 6
       OR EXISTS (SELECT 1 FROM jsonb_each(_p) e WHERE jsonb_typeof(e.value) <> 'string') THEN
      RAISE EXCEPTION 'Ficha de morador inválida.' USING ERRCODE = '22023';
    END IF;
    IF _p->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Ficha de morador inválida.' USING ERRCODE = '22023';
    END IF;
    IF length(btrim(_p->>'nome')) NOT BETWEEN 3 AND 120 OR btrim(_p->>'nome') ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'Informe o nome completo de cada morador.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.locacao_cpf_ok(btrim(_p->>'cpf')) THEN
      RAISE EXCEPTION 'CPF inválido: %', btrim(_p->>'nome') USING ERRCODE = '22023';
    END IF;
    BEGIN
      _d := CASE WHEN _p->>'nascimento' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (_p->>'nascimento')::date END;
    EXCEPTION WHEN others THEN _d := NULL;
    END;
    IF _d IS NULL OR to_char(_d, 'YYYY-MM-DD') <> _p->>'nascimento' OR _d < DATE '1900-01-01' OR _d > _hoje THEN
      RAISE EXCEPTION 'Data de nascimento inválida: %', btrim(_p->>'nome') USING ERRCODE = '22023';
    END IF;
    _adulto := public.locacao_morador_adulto(_p->>'nascimento');
    -- E-mail e telefone: obrigatórios para maiores de 18 (a administradora cadastra); opcionais para menores.
    IF (_adulto OR btrim(_p->>'email') <> '') AND (length(btrim(_p->>'email')) > 200 OR btrim(_p->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') THEN
      RAISE EXCEPTION 'E-mail inválido: %', btrim(_p->>'nome') USING ERRCODE = '22023';
    END IF;
    IF (_adulto OR btrim(_p->>'telefone') <> '') AND length(regexp_replace(_p->>'telefone', '[^0-9]', '', 'g')) NOT BETWEEN 10 AND 13 THEN
      RAISE EXCEPTION 'Telefone inválido: %', btrim(_p->>'nome') USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT p->>'id') FROM jsonb_array_elements(_pessoas) p) <> jsonb_array_length(_pessoas)
     OR (SELECT count(DISTINCT regexp_replace(p->>'cpf', '[^0-9]', '', 'g')) FROM jsonb_array_elements(_pessoas) p) <> jsonb_array_length(_pessoas)
     OR (SELECT count(DISTINCT lower(btrim(p->>'nome'))) FROM jsonb_array_elements(_pessoas) p) <> jsonb_array_length(_pessoas) THEN
    RAISE EXCEPTION 'Morador repetido (mesmo nome ou CPF).' USING ERRCODE = '22023';
  END IF;
  -- O RG anexado fica preso ao nome do item: trocar o nome ou remover o morador exige remover o RG antes.
  SELECT pessoas INTO _ant FROM public.locacao_moradores WHERE locacao_id = _l.id FOR UPDATE;
  FOR _p IN SELECT value FROM jsonb_array_elements(coalesce(_ant, '[]'::jsonb)) LOOP
    IF EXISTS (SELECT 1 FROM public.locacao_documentos d WHERE d.locacao_id = _l.id AND d.removido_em IS NULL
                 AND d.item = public.locacao_morador_item(_p->>'nome'))
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_pessoas) q WHERE btrim(q->>'nome') = btrim(_p->>'nome')) THEN
      RAISE EXCEPTION 'Remova a cópia do RG de % antes de trocar o nome ou tirar o morador.', btrim(_p->>'nome')
        USING ERRCODE = '22023';
    END IF;
  END LOOP;
  -- Guarda os textos já aparados (sem espaço sobrando no contrato nem no item do RG).
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p->>'id', 'nome', btrim(p->>'nome'), 'cpf', btrim(p->>'cpf'),
      'nascimento', p->>'nascimento', 'email', btrim(p->>'email'), 'telefone', btrim(p->>'telefone')) ORDER BY n), '[]'::jsonb)
    INTO _pessoas FROM jsonb_array_elements(_pessoas) WITH ORDINALITY x(p, n);
  _txt := public.locacao_moradores_texto(_pessoas);
  IF length(_txt) > 2000 THEN RAISE EXCEPTION 'Lista de moradores grande demais para o contrato.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.locacao_moradores (locacao_id, organization_id, pessoas, atualizado_por)
  VALUES (_l.id, _l.organization_id, _pessoas, auth.uid())
  ON CONFLICT (locacao_id) DO UPDATE SET pessoas = EXCLUDED.pessoas, atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por;
  -- Contrato: mesmo campo e mesmo formato de hoje ("Nome — CPF xxx", um por linha).
  INSERT INTO public.locacao_contrato_dados (locacao_id, organization_id) VALUES (_l.id, _l.organization_id)
  ON CONFLICT (locacao_id) DO NOTHING;
  UPDATE public.locacao_contrato_dados
     SET valores = CASE WHEN _txt = '' THEN valores - 'moradores' ELSE valores || jsonb_build_object('moradores', _txt) END,
         origem = CASE WHEN _txt = '' THEN origem - 'moradores' ELSE origem || '{"moradores": {"o": "manual"}}'::jsonb END,
         atualizado_em = now(), atualizado_por = auth.uid()
   WHERE locacao_id = _l.id;
  PERFORM public.locacao_evento(_l, 'corretor', 'Ficha de moradores salva (' || jsonb_array_length(_pessoas) || ' morador(es))');
  PERFORM public.locacao_docs_situacao(_l.id);
  RETURN jsonb_build_object('ok', true, 'rgs', to_jsonb(public.locacao_morador_itens(
    (SELECT x FROM public.locacoes x WHERE x.id = _l.id))));
END $$;
REVOKE ALL ON FUNCTION public.locacao_moradores_salvar(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_moradores_salvar(uuid, jsonb) TO authenticated;

-- 6) Pacote para a administradora ------------------------------------------------------------------------------------
-- Passo 1 (login de quem clicou; o servidor do site chama): confere e devolve os dados + caminhos dos RGs.
CREATE FUNCTION public.locacao_pacote_preparar(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes; _p jsonb; _itens text[]; _falta text[]; _v jsonb;
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id AND organization_id = public.locacao_ctx();
  IF _l.id IS NULL OR NOT public.locacao_morador_pode(_l) THEN
    RAISE EXCEPTION 'Sem acesso ao pacote desta locação.' USING ERRCODE = '42501';
  END IF;
  IF _l.imovel_tipo IS DISTINCT FROM 'condominio' THEN
    RAISE EXCEPTION 'Pacote só para imóvel de condomínio.' USING ERRCODE = '22023';
  END IF;
  SELECT pessoas INTO _p FROM public.locacao_moradores WHERE locacao_id = _l.id AND organization_id = _l.organization_id;
  IF _p IS NULL OR jsonb_array_length(_p) = 0 THEN
    RAISE EXCEPTION 'Preencha a ficha de moradores antes de baixar o pacote.' USING ERRCODE = '22023';
  END IF;
  _itens := public.locacao_morador_itens(_l);
  SELECT coalesce(array_agg(i ORDER BY n), ARRAY[]::text[]) INTO _falta FROM unnest(_itens) WITH ORDINALITY t(i, n)
   WHERE NOT EXISTS (SELECT 1 FROM public.locacao_documentos d WHERE d.locacao_id = _l.id AND d.item = t.i AND d.removido_em IS NULL);
  IF cardinality(_falta) > 0 THEN
    RAISE EXCEPTION 'Falta anexar: %', array_to_string(_falta, '; ') USING ERRCODE = '22023';
  END IF;
  _v := public.locacao_contrato_valores(_l);
  RETURN jsonb_build_object(
    'codigo', 'LOC-' || lpad(_l.numero::text, 4, '0'),
    'locatario', jsonb_build_object('nome', _l.candidato->>'nome', 'cpf', _l.candidato->>'cpf',
      'nascimento', _l.candidato->>'nascimento', 'email', _l.candidato->>'email', 'telefone', _l.candidato->>'telefone'),
    'moradores', _p,
    'endereco', _l.endereco, 'unidade', nullif(btrim(coalesce(_l.ficha->>'complemento', '')), ''),
    'entrada', coalesce(nullif(btrim(coalesce(_v->>'inicio', '')), ''), _l.chave_em::text),
    'rgs', (SELECT coalesce(jsonb_agg(jsonb_build_object('item', d.item, 'path', d.storage_path) ORDER BY t.n, d.enviado_em), '[]'::jsonb)
      FROM unnest(_itens) WITH ORDINALITY t(i, n)
      JOIN public.locacao_documentos d ON d.locacao_id = _l.id AND d.item = t.i AND d.removido_em IS NULL));
END $$;
REVOKE ALL ON FUNCTION public.locacao_pacote_preparar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_pacote_preparar(uuid) TO authenticated;

-- Passo 2 (login de quem clicou, depois do PDF pronto): revalida o acesso e grava quem baixou e quando.
CREATE FUNCTION public.locacao_pacote_registrar(_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes;
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id AND organization_id = public.locacao_ctx();
  IF _l.id IS NULL OR NOT public.locacao_morador_pode(_l) OR _l.imovel_tipo IS DISTINCT FROM 'condominio' THEN
    RAISE EXCEPTION 'Sem acesso ao pacote desta locação.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.locacao_pacote_downloads (locacao_id, organization_id, baixado_por)
  VALUES (_l.id, _l.organization_id, auth.uid());
  PERFORM public.locacao_evento(_l, 'corretor', 'Pacote para a administradora baixado');
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.locacao_pacote_registrar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_pacote_registrar(uuid) TO authenticated;
COMMIT;
