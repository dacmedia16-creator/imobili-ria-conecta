-- Locação — ficha de cada morador (RG obrigatório para maiores de 18) + "Pacote para a administradora" do condomínio.
-- Cartão t_40cff7e4 (pedido de Denis 20/11/2026, tópico 6238). CONSTRUÇÃO EM TESTE: produção só com aprovação de Denis.
-- Versão posterior a 20261214140000 (lote 2, já em produção) e a 20261215120000/20261215130000 (PR #370, rascunho).
-- Nenhuma função em comum com o #370.
--
-- Rollback: supabase/rollback/20261216120000_locacao_moradores_pacote.sql
-- Teste:    supabase/tests/run-locacao-moradores-pacote.sh (homologação, transação desfeita; nunca produção).
--
-- O que muda:
--  1) Ficha por morador (nome, CPF, nascimento, e-mail, telefone) em locacao_moradores — tabela SEM acesso direto do
--     navegador; lê/grava só por RPC. Lê: corretor da locação, gerência (admin) e gestora da locação. Grava: o corretor
--     (ou admin) na etapa Documentação, como os demais dados do contrato.
--  2) Morador com 18 anos ou mais gera o item obrigatório "Cópia do RG — <nome>" no checklist do locatário. A idade é
--     contada no dia de hoje (São Paulo) enquanto a locação está na Documentação; ao sair dela, a data de referência
--     fica CONGELADA (locacao_moradores.referencia, gatilho locacao_zz_moradores_ref) — um aniversário de 18 anos depois
--     disso não cria pendência nova nem trava a minuta. Se a locação voltar à Documentação, a contagem volta a ser hoje.
--     Envio, bucket privado, registro e link assinado são os mesmos dos outros documentos. Menor de 18 não gera item.
--  3) A cópia do RG dos moradores só aparece para quem vê a ficha (corretor da locação, gerência e gestora): checklist,
--     lista de documentos, histórico e "abrir documento" escondem esses itens de contratos, vistoria, financeiro e
--     líderes. Por isso locacao_detalhe e locacao_documento_ver são redefinidas.
--  4) O contrato continua recebendo o campo "moradores" com o mesmo texto de hoje ("Nome — CPF 000.000.000-00", um por
--     linha): o banco gera esse texto a partir da ficha a cada gravação, com o CPF sempre com máscara.
--  5) Locações antigas: coluna nova locacoes.moradores_ficha nasce FALSE para as linhas existentes (valor padrão, sem
--     UPDATE — nenhum gatilho dispara) e TRUE para as novas. Antigas seguem com o texto livre até alguém salvar a ficha;
--     depois disso (ou em locação nova) "moradores" só muda pela ficha.
--  6) Pacote para a administradora (imóvel de condomínio): locacao_pacote_preparar confere acesso, ficha preenchida e
--     RGs obrigatórios entregues e devolve os dados + caminhos dos RGs SÓ para o servidor do site, que monta o PDF.
--     locacao_pacote_registrar grava quem baixou e quando (locacao_pacote_downloads) e um evento no histórico.
--     O sistema não envia nada por e-mail.
--  7) Com a cópia do RG anexada, trocar o nome ou o CPF do morador (ou tirá-lo da ficha) exige remover o RG antes.
-- Funções redefinidas (o rollback devolve o texto exato de produção, conferido por md5 em 20/11 — locacao_detalhe já
--   na versão do lote 2, 20261214130000): locacao_checklist_l, locacao_partes_json, locacao_contrato_salvar,
--   locacao_detalhe, locacao_documento_ver. Nenhuma locação existente é alterada.
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
  -- Data em que a idade foi congelada (a locação saiu da Documentação). NULL = conta a partir de hoje.
  referencia date,
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
-- Hoje em São Paulo.
CREATE FUNCTION public.locacao_hoje_sp() RETURNS date
LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date
$$;
-- 18 anos completos na data de referência. Espelho de moradorAdulto() (src/lib/locacao-moradores.ts).
CREATE FUNCTION public.locacao_morador_adulto(_nascimento text, _ref date) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE WHEN coalesce(_nascimento, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND _ref IS NOT NULL
    THEN _nascimento::date <= (_ref - interval '18 years')::date
    ELSE false END
$$;
-- Nome do item no checklist. Espelho de itemRgMorador().
CREATE FUNCTION public.locacao_morador_item(_nome text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT 'Cópia do RG — ' || btrim(_nome)
$$;
-- O item é a cópia do RG de um morador? Espelho de ehItemRgMorador().
CREATE FUNCTION public.locacao_eh_rg_morador(_item text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT coalesce(starts_with(_item, 'Cópia do RG — '), false)
$$;
-- CPF sempre com máscara 000.000.000-00. Espelho de mascaraCpf().
CREATE FUNCTION public.locacao_cpf_mascara(_v text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE WHEN length(d) = 11
    THEN substr(d, 1, 3) || '.' || substr(d, 4, 3) || '.' || substr(d, 7, 3) || '-' || substr(d, 10, 2)
    ELSE btrim(coalesce(_v, '')) END
    FROM (SELECT regexp_replace(coalesce(_v, ''), '[^0-9]', '', 'g') AS d) x
$$;
-- Texto do contrato (mesmo formato de hoje). Espelho de textoMoradores().
CREATE FUNCTION public.locacao_moradores_texto(_pessoas jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT coalesce(string_agg(btrim(p->>'nome') || ' — CPF ' || public.locacao_cpf_mascara(p->>'cpf'), chr(10) ORDER BY n), '')
    FROM jsonb_array_elements(coalesce(_pessoas, '[]'::jsonb)) WITH ORDINALITY x(p, n)
$$;
-- Data de referência da idade nesta locação (congelada ao sair da Documentação; senão hoje).
CREATE FUNCTION public.locacao_morador_ref(_l public.locacoes) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce((SELECT m.referencia FROM public.locacao_moradores m WHERE m.locacao_id = _l.id), public.locacao_hoje_sp())
$$;
-- Itens "Cópia do RG — <nome>" dos moradores adultos desta locação (vazio se não há ficha).
CREATE FUNCTION public.locacao_morador_itens(_l public.locacoes) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(array_agg(public.locacao_morador_item(p->>'nome') ORDER BY n), ARRAY[]::text[])
    FROM public.locacao_moradores m, jsonb_array_elements(m.pessoas) WITH ORDINALITY x(p, n)
   WHERE m.locacao_id = _l.id AND m.organization_id = _l.organization_id
     AND public.locacao_morador_adulto(p->>'nascimento', coalesce(m.referencia, public.locacao_hoje_sp()))
$$;
-- Quem vê a ficha completa, a cópia do RG dos moradores e baixa o pacote: corretor da locação, gerência
-- (admin/administrador principal/staff) ou gestora da locação — sempre dentro da imobiliária atual.
CREATE FUNCTION public.locacao_morador_pode(_l public.locacoes) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(auth.uid() IS NOT NULL AND _l.organization_id = public.current_org_id() AND (
    _l.corretor_id = auth.uid() OR public.locacao_eh_gerencia(auth.uid())
    OR EXISTS (SELECT 1 FROM public.locacao_papeis p WHERE p.organization_id = _l.organization_id
                AND p.user_id = auth.uid() AND p.papel = 'gestora')), false)
$$;
-- Lista "partes" do checklist sem os itens de RG dos moradores (para quem não vê a ficha).
CREATE FUNCTION public.locacao_partes_sem_rg(_p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT coalesce(jsonb_agg(p || jsonb_build_object('itens', (SELECT coalesce(jsonb_agg(i ORDER BY n), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) WITH ORDINALITY x(i, n)
     WHERE NOT public.locacao_eh_rg_morador(i->>'item'))) ORDER BY o), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(_p, '[]'::jsonb)) WITH ORDINALITY y(p, o)
$$;
REVOKE ALL ON FUNCTION public.locacao_hoje_sp(), public.locacao_morador_adulto(text, date), public.locacao_morador_item(text),
  public.locacao_eh_rg_morador(text), public.locacao_cpf_mascara(text), public.locacao_moradores_texto(jsonb),
  public.locacao_morador_ref(public.locacoes), public.locacao_morador_itens(public.locacoes),
  public.locacao_morador_pode(public.locacoes), public.locacao_partes_sem_rg(jsonb) FROM PUBLIC, anon, authenticated;

-- 3) Idade congelada ao sair da Documentação (gatilho só na mudança de etapa; não toca a linha da locação) -----------
CREATE FUNCTION public.locacao_trg_moradores_ref() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NEW.etapa = 'documentacao' THEN
    UPDATE public.locacao_moradores SET referencia = NULL WHERE locacao_id = NEW.id AND referencia IS NOT NULL;
  ELSIF OLD.etapa = 'documentacao' THEN
    UPDATE public.locacao_moradores SET referencia = public.locacao_hoje_sp() WHERE locacao_id = NEW.id AND referencia IS NULL;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.locacao_trg_moradores_ref() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER locacao_zz_moradores_ref AFTER UPDATE OF etapa ON public.locacoes
  FOR EACH ROW WHEN (OLD.etapa IS DISTINCT FROM NEW.etapa) EXECUTE FUNCTION public.locacao_trg_moradores_ref();

-- 4) Checklist: RG dos moradores adultos entra na parte do locatário ---------------------------------------------------
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

-- 5) Dados do contrato: com ficha (ou locação nova), "moradores" só muda pela ficha ------------------------------------
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

-- 6) Ficha de moradores: ler e salvar --------------------------------------------------------------------------------
CREATE FUNCTION public.locacao_moradores_ler(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes; _m public.locacao_moradores;
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id AND organization_id = public.locacao_ctx();
  IF _l.id IS NULL OR NOT public.locacao_morador_pode(_l) THEN
    RAISE EXCEPTION 'Sem acesso à ficha de moradores.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _m FROM public.locacao_moradores WHERE locacao_id = _l.id AND organization_id = _l.organization_id;
  RETURN jsonb_build_object('ficha', _m.locacao_id IS NOT NULL, 'obrigatoria', _l.moradores_ficha,
    'pessoas', coalesce(_m.pessoas, '[]'::jsonb),
    'referencia', coalesce(_m.referencia, public.locacao_hoje_sp()), 'congelada', _m.referencia IS NOT NULL,
    'downloads', (SELECT coalesce(jsonb_agg(jsonb_build_object('em', x.baixado_em, 'por', pr.nome) ORDER BY x.baixado_em DESC), '[]'::jsonb)
      FROM (SELECT * FROM public.locacao_pacote_downloads d WHERE d.locacao_id = _l.id ORDER BY d.baixado_em DESC LIMIT 5) x
      LEFT JOIN public.profiles pr ON pr.id = x.baixado_por));
END $$;
REVOKE ALL ON FUNCTION public.locacao_moradores_ler(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.locacao_moradores_ler(uuid) TO authenticated;

CREATE FUNCTION public.locacao_moradores_salvar(_id uuid, _pessoas jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _l public.locacoes := public.locacao_pega(_id); _p jsonb; _ant jsonb; _d date; _adulto boolean; _txt text;
  _hoje date := public.locacao_hoje_sp();
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
    _adulto := public.locacao_morador_adulto(_p->>'nascimento', _hoje);
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
  -- O RG anexado fica preso ao morador (nome + CPF): trocar o nome ou o CPF, ou tirar o morador, exige remover o RG antes.
  SELECT pessoas INTO _ant FROM public.locacao_moradores WHERE locacao_id = _l.id FOR UPDATE;
  FOR _p IN SELECT value FROM jsonb_array_elements(coalesce(_ant, '[]'::jsonb)) LOOP
    IF EXISTS (SELECT 1 FROM public.locacao_documentos d WHERE d.locacao_id = _l.id AND d.removido_em IS NULL
                 AND d.item = public.locacao_morador_item(_p->>'nome'))
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_pessoas) q WHERE btrim(q->>'nome') = btrim(_p->>'nome')
                         AND regexp_replace(q->>'cpf', '[^0-9]', '', 'g') = regexp_replace(_p->>'cpf', '[^0-9]', '', 'g')) THEN
      RAISE EXCEPTION 'Remova a cópia do RG de % antes de trocar o nome ou o CPF, ou de tirar o morador.', btrim(_p->>'nome')
        USING ERRCODE = '22023';
    END IF;
  END LOOP;
  -- Guarda os textos já aparados e o CPF com máscara (sem espaço sobrando no contrato nem no item do RG).
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p->>'id', 'nome', btrim(p->>'nome'), 'cpf', public.locacao_cpf_mascara(p->>'cpf'),
      'nascimento', p->>'nascimento', 'email', btrim(p->>'email'), 'telefone', btrim(p->>'telefone')) ORDER BY n), '[]'::jsonb)
    INTO _pessoas FROM jsonb_array_elements(_pessoas) WITH ORDINALITY x(p, n);
  _txt := public.locacao_moradores_texto(_pessoas);
  IF length(_txt) > 2000 THEN RAISE EXCEPTION 'Lista de moradores grande demais para o contrato.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.locacao_moradores (locacao_id, organization_id, pessoas, atualizado_por)
  VALUES (_l.id, _l.organization_id, _pessoas, auth.uid())
  ON CONFLICT (locacao_id) DO UPDATE SET pessoas = EXCLUDED.pessoas, referencia = NULL, atualizado_em = now(),
    atualizado_por = EXCLUDED.atualizado_por;
  -- Contrato: mesmo campo e mesmo formato de hoje ("Nome — CPF 000.000.000-00", um por linha).
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

-- 7) Cópia do RG dos moradores só para quem vê a ficha --------------------------------------------------------------
-- Detalhe: igual a 20261214130000 (produção) + RG dos moradores escondido de quem não vê a ficha (checklist, o que falta,
-- partes, documentos e histórico) + "moradores_com_ficha" (só o sim/não, para travar o campo de texto do contrato).
CREATE OR REPLACE FUNCTION public.locacao_detalhe(_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _l public.locacoes; _f text[]; _pf boolean; _rg boolean;
BEGIN
  SELECT * INTO _l FROM public.locacoes WHERE id = _id AND organization_id = _org;
  IF _l.id IS NULL OR NOT public.locacao_pode_ver(_l) THEN
    RAISE EXCEPTION 'Sem acesso a esta locação.' USING ERRCODE = '42501';
  END IF;
  _f := public.locacao_docs_faltando(_l);
  _pf := public.locacao_finais_pode_ver(_l);
  _rg := public.locacao_morador_pode(_l);
  RETURN public.locacao_json(_l) || jsonb_build_object(
    'checklist', (SELECT coalesce(jsonb_agg(x ORDER BY n), '[]'::jsonb) FROM unnest(public.locacao_checklist_l(_l)) WITH ORDINALITY c(x, n)
                   WHERE _rg OR NOT public.locacao_eh_rg_morador(x)),
    'faltando', (SELECT coalesce(jsonb_agg(x ORDER BY n), '[]'::jsonb) FROM unnest(_f) WITH ORDINALITY c(x, n)
                  WHERE _rg OR NOT public.locacao_eh_rg_morador(x)),
    'partes', CASE WHEN _rg THEN public.locacao_partes_json(_l) ELSE public.locacao_partes_sem_rg(public.locacao_partes_json(_l)) END,
    'docs_completa', public.locacao_docs_completos_em(_l) IS NOT NULL,
    'docs_completos_em', public.locacao_docs_completos_em(_l),
    'moradores_com_ficha', EXISTS (SELECT 1 FROM public.locacao_moradores m WHERE m.locacao_id = _l.id),
    'captador_nome', (SELECT p.nome FROM public.profiles p WHERE p.id = _l.captador_id),
    'documentos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'item', d.item, 'nome_arquivo', d.nome_arquivo,
        'enviado_em', d.enviado_em, 'leitura', lr.status, 'leitura_erro', lr.erro, 'leitura_em', lr.atualizado_em,
        'preenchidos', lr.preenchidos) ORDER BY d.enviado_em), '[]')
        FROM public.locacao_documentos d LEFT JOIN public.locacao_doc_leituras lr ON lr.documento_id = d.id
       WHERE d.locacao_id = _l.id AND d.removido_em IS NULL AND (_rg OR NOT public.locacao_eh_rg_morador(d.item))),
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
        FROM public.locacao_eventos e LEFT JOIN public.profiles pr ON pr.id = e.ator_id
       WHERE e.locacao_id = _l.id AND (_rg OR position('Cópia do RG — ' IN e.descricao) = 0)));
END $$;

-- Abrir documento: a cópia do RG de morador só para quem vê a ficha; o resto igual a produção.
CREATE OR REPLACE FUNCTION public.locacao_documento_ver(_doc uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _org uuid := public.locacao_ctx(); _d public.locacao_documentos; _l public.locacoes;
BEGIN
  SELECT * INTO _d FROM public.locacao_documentos WHERE id = _doc AND organization_id = _org AND removido_em IS NULL;
  SELECT * INTO _l FROM public.locacoes WHERE id = _d.locacao_id;
  IF _d.id IS NULL OR _l.id IS NULL OR NOT public.locacao_pode_ver(_l)
     OR (public.locacao_eh_rg_morador(_d.item) AND NOT public.locacao_morador_pode(_l)) THEN
    RAISE EXCEPTION 'Sem acesso a este documento.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('path', _d.storage_path, 'nome', _d.nome_arquivo);
END $$;

-- 8) Pacote para a administradora ------------------------------------------------------------------------------------
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
    'referencia', public.locacao_morador_ref(_l),
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
