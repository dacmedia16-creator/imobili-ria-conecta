-- Ficha do imóvel na venda (pedido de Denis em 08/10/2026, tópico 6238, t_8be054a9): os MESMOS campos
-- do Estudo de Mercado (repo estudodemercadomax, src/routes/app.novo-estudo.tsx), com a mesma lista de
-- tipos, para a integração ser direta. O estudo usa a ÁREA ÚTIL para o preço por m².
--
--  1. Colunas novas em public.sales (todas opcionais no banco; vendas antigas ficam em branco):
--     tipo_imovel (lista do estudo), area_util_m2, area_construida_m2, area_terreno_m2, ano_construcao,
--     quartos, suites, banheiros, vagas, area_origem ('documento' | 'corretor' | 'captacao'),
--     area_confirmada_por / area_confirmada_em (quem e quando confirmou a área).
--  2. Confirmação: só o próprio usuário se registra como quem confirmou (o banco grava auth.uid()), e
--     mudar a área ou o tipo depois de confirmar desfaz a confirmação.
--  3. Trava (mesmo molde de bloquear_avanco_sem_endereco, sem Lançamento): a venda só sai do corretor
--     para o gestor com tipo + área útil confirmada (Terreno: área do terreno confirmada) e, nos tipos
--     residenciais, quartos, banheiros e vagas. Suítes e ano de construção são opcionais.
--  4. "Virou venda": exclusive_virar_venda passa a levar a ficha da captação (form_data.ficha e o tipo
--     de form_data.imovel.tipo_imovel) como SUGESTÃO, sem confirmar (area_origem = 'captacao').
--  5. Vendas por região: vendas_por_regiao_todos devolve tipo_imovel e area_util_m2 em todas as linhas
--     'venda' e 'pino' (privacidade do pino mantida: sem código, endereço, data, corretor e cliente;
--     coordenada arredondada). O preço por m² é calculado na tela (valor / área útil).
-- Rollback: supabase/rollback/20261008220000_ficha_imovel.sql
BEGIN;

-- 1) Colunas ------------------------------------------------------------------------------------
ALTER TABLE public.sales
  ADD COLUMN tipo_imovel text,
  ADD COLUMN area_util_m2 numeric(12,2),
  ADD COLUMN area_construida_m2 numeric(12,2),
  ADD COLUMN area_terreno_m2 numeric(12,2),
  ADD COLUMN ano_construcao smallint,
  ADD COLUMN quartos smallint,
  ADD COLUMN suites smallint,
  ADD COLUMN banheiros smallint,
  ADD COLUMN vagas smallint,
  ADD COLUMN area_origem text,
  ADD COLUMN area_confirmada_por uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN area_confirmada_em timestamptz;
ALTER TABLE public.sales
  ADD CONSTRAINT sales_tipo_imovel_check
    CHECK (tipo_imovel IS NULL OR tipo_imovel IN ('Apartamento', 'Casa', 'Terreno', 'Comercial', 'Cobertura', 'Studio')),
  ADD CONSTRAINT sales_ficha_areas_check
    CHECK ((area_util_m2 IS NULL OR area_util_m2 > 0)
       AND (area_construida_m2 IS NULL OR area_construida_m2 > 0)
       AND (area_terreno_m2 IS NULL OR area_terreno_m2 > 0)),
  ADD CONSTRAINT sales_ficha_contagens_check
    CHECK ((quartos IS NULL OR quartos BETWEEN 0 AND 99) AND (suites IS NULL OR suites BETWEEN 0 AND 99)
       AND (banheiros IS NULL OR banheiros BETWEEN 0 AND 99) AND (vagas IS NULL OR vagas BETWEEN 0 AND 99)),
  ADD CONSTRAINT sales_ano_construcao_check
    CHECK (ano_construcao IS NULL OR ano_construcao BETWEEN 1800 AND 2100),
  ADD CONSTRAINT sales_area_origem_check
    CHECK (area_origem IS NULL OR area_origem IN ('documento', 'corretor', 'captacao'));
COMMENT ON COLUMN public.sales.tipo_imovel IS 'Tipo do imóvel, mesma lista do Estudo de Mercado.';
COMMENT ON COLUMN public.sales.area_util_m2 IS
  'Área útil (m²) do Estudo de Mercado. Apartamento: área privativa da matrícula. Base do preço por m².';
COMMENT ON COLUMN public.sales.area_origem IS
  'De onde veio a área: documento (leitura da matrícula/IPTU), corretor (digitada) ou captacao (Virou venda).';
COMMENT ON COLUMN public.sales.area_confirmada_em IS
  'Quando o corretor confirmou a área útil (Terreno: área do terreno). Mudar área/tipo desfaz.';

-- 2) Confirmação da área -------------------------------------------------------------------------
CREATE FUNCTION public.sales_ficha_confirmacao()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.area_confirmada_em IS NOT DISTINCT FROM OLD.area_confirmada_em
     AND (NEW.area_util_m2 IS DISTINCT FROM OLD.area_util_m2
       OR NEW.area_terreno_m2 IS DISTINCT FROM OLD.area_terreno_m2
       OR NEW.tipo_imovel IS DISTINCT FROM OLD.tipo_imovel) THEN
    -- área ou tipo mudou sem nova confirmação: a confirmação anterior não vale mais
    NEW.area_confirmada_em := NULL;
    NEW.area_confirmada_por := NULL;
  ELSIF NEW.area_confirmada_em IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.area_confirmada_em IS DISTINCT FROM OLD.area_confirmada_em) THEN
    -- nova confirmação: quem confirmou é sempre quem fez a gravação, na hora do banco
    NEW.area_confirmada_em := now();
    NEW.area_confirmada_por := coalesce(auth.uid(), NEW.area_confirmada_por);
  ELSIF NEW.area_confirmada_em IS NULL THEN
    NEW.area_confirmada_por := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    -- confirmação mantida: ninguém troca o "quem confirmou" por fora
    NEW.area_confirmada_por := OLD.area_confirmada_por;
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_sales_ficha_confirmacao
  BEFORE INSERT OR UPDATE OF area_util_m2, area_terreno_m2, tipo_imovel, area_confirmada_em, area_confirmada_por
  ON public.sales FOR EACH ROW EXECUTE FUNCTION public.sales_ficha_confirmacao();

-- 3) Trava para enviar ao gestor -----------------------------------------------------------------
CREATE FUNCTION public.ficha_imovel_faltando(_s public.sales)
 RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path TO ''
AS $function$
DECLARE f text[] := ARRAY[]::text[];
BEGIN
  IF _s.tipo_imovel IS NULL THEN RETURN ARRAY['Tipo do imóvel']; END IF;
  IF _s.tipo_imovel = 'Terreno' THEN
    IF coalesce(_s.area_terreno_m2, 0) <= 0 THEN f := f || 'Área do terreno'::text; END IF;
  ELSIF coalesce(_s.area_util_m2, 0) <= 0 THEN f := f || 'Área útil'::text;
  END IF;
  IF _s.tipo_imovel IN ('Apartamento', 'Casa', 'Cobertura', 'Studio') THEN
    IF _s.quartos IS NULL THEN f := f || 'Quartos'::text; END IF;
    IF _s.banheiros IS NULL THEN f := f || 'Banheiros'::text; END IF;
    IF _s.vagas IS NULL THEN f := f || 'Vagas'::text; END IF;
  END IF;
  IF cardinality(f) = 0 AND _s.area_confirmada_em IS NULL THEN
    f := f || CASE WHEN _s.tipo_imovel = 'Terreno' THEN 'Confirmar a área do terreno'
                   ELSE 'Confirmar a área útil' END;
  END IF;
  RETURN f;
END $function$;

CREATE FUNCTION public.bloquear_avanco_sem_ficha_imovel()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$
DECLARE faltando text[];
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF coalesce(NEW.modalidade::text, '') = 'lancamento' THEN RETURN NEW; END IF;
  IF OLD.status::text NOT IN ('rascunho', 'devolvida_ajuste') THEN RETURN NEW; END IF;
  IF NEW.status::text NOT IN ('enviada_revisao', 'aprovada_gestor', 'em_elaboracao_contrato') THEN RETURN NEW; END IF;
  faltando := public.ficha_imovel_faltando(NEW);
  IF cardinality(faltando) > 0 THEN
    RAISE EXCEPTION 'Complete a ficha do imóvel (falta: %). Sem ela a venda não segue para o gestor.',
      array_to_string(faltando, ', ') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER trg_bloquear_avanco_sem_ficha_imovel
  BEFORE UPDATE OF status ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_avanco_sem_ficha_imovel();

-- 4) "Virou venda" leva a ficha da captação como sugestão ---------------------------------------
-- Texto livre da captação -> número: "52,23" | "1.250" | "198.784 m2" (mesma regra de areaM2DoTexto).
CREATE FUNCTION public.ficha_area_do_texto(_t text)
 RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO ''
AS $function$
DECLARE s text := substring(coalesce(_t, '') FROM '[0-9][0-9.,]*'); n numeric;
BEGIN
  IF s IS NULL THEN RETURN NULL; END IF;
  s := regexp_replace(s, '[.,]+$', '');
  IF s LIKE '%.%' AND s LIKE '%,%' THEN
    IF strpos(reverse(s), ',') < strpos(reverse(s), '.') THEN s := replace(replace(s, '.', ''), ',', '.');
    ELSE s := replace(s, ',', ''); END IF;
  ELSIF s LIKE '%,%' THEN
    s := CASE WHEN s ~ ',.*,' THEN replace(s, ',', '') ELSE replace(s, ',', '.') END;
  ELSIF s ~ '\.[0-9]{3}$' OR s ~ '\..*\.' THEN
    s := replace(s, '.', '');
  END IF;
  IF s !~ '^[0-9]{1,9}([.][0-9]+)?$' THEN RETURN NULL; END IF;
  n := round(s::numeric, 2);
  RETURN CASE WHEN n > 0 AND n < 10000000 THEN n END;
END $function$;

CREATE FUNCTION public.ficha_int_do_texto(_t text, _min int, _max int)
 RETURNS smallint LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  SELECT CASE WHEN m IS NOT NULL AND m::int BETWEEN _min AND _max THEN m::smallint END
  FROM (SELECT substring(btrim(coalesce(_t, '')) FROM '^[0-9]{1,4}') AS m) x
$function$;

-- Tipo da captação (texto livre) -> lista do estudo (mesma regra de tipoImovelDoTexto).
CREATE FUNCTION public.ficha_tipo_do_texto(_t text)
 RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO ''
AS $function$
DECLARE t text := lower(translate(coalesce(_t, ''),
  'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'));
BEGIN
  IF btrim(t) = '' THEN RETURN NULL; END IF;
  IF t IN ('apartamento', 'casa', 'terreno', 'comercial', 'cobertura', 'studio') THEN RETURN initcap(t); END IF;
  IF t ~ '\mcobertura\M' THEN RETURN 'Cobertura'; END IF;
  IF t ~ '\m(studio|estudio|kitnet|kitinete|kitchenette|quitinete|kit)\M' THEN RETURN 'Studio'; END IF;
  IF t ~ '\m(apartamento|apto|ap)\M' THEN RETURN 'Apartamento'; END IF;
  IF t ~ '\m(sala|loja|escritorio|comercial|galpao|barracao|consultorio)\M' THEN RETURN 'Comercial'; END IF;
  IF t ~ '\m(casa|sobrado|residencia|chacara|edicula)\M' THEN RETURN 'Casa'; END IF;
  IF t ~ '\m(terreno|lote|gleba)\M' THEN RETURN 'Terreno'; END IF;
  RETURN NULL;
END $function$;

-- Corpo idêntico a 20261008190000, mais a ficha no INSERT (marcada "captacao", sem confirmar).
CREATE OR REPLACE FUNCTION public.exclusive_virar_venda(_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE _c public.exclusive_captures%ROWTYPE; _actor uuid := auth.uid(); _sale uuid;
        _im jsonb; _p1 jsonb; _p2 jsonb; _v text; _valor numeric; _uf text;
        _lider uuid; _lider_nome text; _captador_nome text; _existente jsonb;
        _fi jsonb; _tipo text; _util numeric; _terreno numeric;
BEGIN
  -- Trava a captação: chamadas simultâneas esperam aqui e enxergam a venda já criada.
  SELECT * INTO _c FROM public.exclusive_captures
    WHERE id = _id AND organization_id = public.current_org_id() FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_pode_virar_venda(_id, _actor) THEN
    RAISE EXCEPTION 'Só o captador, corretores e o gestor da mesma equipe podem transformar esta captação em venda.'
      USING ERRCODE = '42501';
  END IF;
  _existente := public.exclusive_venda_ativa(_id);
  IF _existente IS NOT NULL THEN
    RETURN jsonb_build_object('criada', false, 'venda', _existente);
  END IF;

  _im := coalesce(_c.form_data->'imovel', '{}'::jsonb);
  _p1 := _c.form_data->'proprietario_1';
  _p2 := _c.form_data->'proprietario_2';
  _fi := CASE WHEN jsonb_typeof(_c.form_data->'ficha') = 'object' THEN _c.form_data->'ficha' ELSE '{}'::jsonb END;
  _tipo := public.ficha_tipo_do_texto(_im->>'tipo_imovel');
  _util := CASE WHEN _tipo IS DISTINCT FROM 'Terreno' THEN public.ficha_area_do_texto(_fi->>'area_util_m2') END;
  -- Unidade em condomínio: "terreno" seria fração ideal; não leva.
  _terreno := CASE WHEN _tipo IN ('Apartamento', 'Cobertura', 'Studio') THEN NULL
                   ELSE public.ficha_area_do_texto(_fi->>'area_terreno_m2') END;
  -- "R$ 870.000,00" -> 870000.00 (texto livre da captação; inválido fica em branco)
  _v := regexp_replace(coalesce(_im->>'valor_imovel', ''), '[^0-9,.]', '', 'g');
  _v := CASE WHEN _v LIKE '%,%' THEN replace(replace(_v, '.', ''), ',', '.') ELSE replace(_v, '.', '') END;
  _valor := CASE WHEN _v ~ '^[0-9]{1,13}([.][0-9]{1,2})?$' THEN _v::numeric END;
  _uf := upper(btrim(coalesce(_im->>'estado', '')));
  IF _uf !~ '^[A-Z]{2}$' THEN _uf := NULL; END IF;
  SELECT coalesce(nullif(btrim(p.nome), ''), nullif(btrim(_c.broker_name), '')) INTO _captador_nome
    FROM public.profiles p WHERE p.id = _c.captor_id;
  SELECT t.lider_id, nullif(btrim(lp.nome), '') INTO _lider, _lider_nome
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id AND t.organization_id = _c.organization_id
    LEFT JOIN public.profiles lp ON lp.id = t.lider_id
    WHERE tm.membro_id = _c.captor_id AND t.lider_id IS DISTINCT FROM _c.captor_id
    LIMIT 1;

  PERFORM set_config('app.virou_venda', 'on', true);
  INSERT INTO public.sales (
    corretor_id, status, modalidade, exclusive_capture_id,
    imovel_endereco, imovel_logradouro, imovel_complemento, imovel_bairro, imovel_cidade, imovel_uf,
    matricula, iptu, valor_anunciado,
    corretor_captador_id, corretor_captador, lider_captador_id, lider_captador_nome,
    corretor_vendedor_id, corretor_vendedor,
    tipo_imovel, area_util_m2, area_construida_m2, area_terreno_m2, ano_construcao,
    quartos, suites, banheiros, vagas, area_origem)
  VALUES (
    _actor, 'rascunho', 'padrao', _c.id,
    nullif(concat_ws(' - ', nullif(btrim(_im->>'endereco'), ''), nullif(btrim(_im->>'complemento'), '')), ''),
    -- endereço da captação é texto livre: número e CEP ficam para o corretor (decisão 08/10)
    nullif(btrim(_im->>'endereco'), ''),
    nullif(btrim(_im->>'complemento'), ''),
    nullif(btrim(_im->>'bairro'), ''),
    nullif(btrim(_im->>'municipio'), ''),
    _uf,
    nullif(concat_ws(' — ', nullif(btrim(_im->>'numero_matricula'), ''), nullif(btrim(_im->>'cartorio_registro'), '')), ''),
    nullif(btrim(_im->>'classificacao_fiscal_iptu'), ''),
    _valor,
    _c.captor_id, _captador_nome, _lider, CASE WHEN _lider IS NOT NULL THEN _lider_nome END,
    _actor, (SELECT nullif(btrim(nome), '') FROM public.profiles WHERE id = _actor),
    _tipo, _util,
    CASE WHEN _tipo IS DISTINCT FROM 'Terreno' THEN public.ficha_area_do_texto(_fi->>'area_construida_m2') END,
    _terreno,
    CASE WHEN _tipo IS DISTINCT FROM 'Terreno' THEN
      public.ficha_int_do_texto(_fi->>'ano_construcao', 1800, extract(year FROM now())::int + 1) END,
    CASE WHEN _tipo IS DISTINCT FROM 'Terreno' THEN public.ficha_int_do_texto(_fi->>'quartos', 0, 99) END,
    CASE WHEN _tipo IS DISTINCT FROM 'Terreno' THEN public.ficha_int_do_texto(_fi->>'suites', 0, 99) END,
    CASE WHEN _tipo IS DISTINCT FROM 'Terreno' THEN public.ficha_int_do_texto(_fi->>'banheiros', 0, 99) END,
    CASE WHEN _tipo IS DISTINCT FROM 'Terreno' THEN public.ficha_int_do_texto(_fi->>'vagas', 0, 99) END,
    CASE WHEN _util IS NOT NULL OR _terreno IS NOT NULL THEN 'captacao' END)
  RETURNING id INTO _sale;
  PERFORM set_config('app.virou_venda', 'off', true);

  INSERT INTO public.sale_parties (sale_id, papel, tipo_pessoa, nome, rg, cpf_cnpj, email, telefone,
    endereco, nacionalidade, estado_civil)
  SELECT _sale, x.papel, 'fisica', nullif(btrim(x.o->>'nome_completo'), ''), nullif(btrim(x.o->>'rg'), ''),
    nullif(btrim(x.o->>'cpf'), ''), nullif(btrim(x.o->>'email'), ''), nullif(btrim(x.o->>'telefone_1'), ''),
    nullif(btrim(x.o->>'endereco_completo'), ''), nullif(btrim(x.o->>'nacionalidade'), ''),
    nullif(btrim(x.o->>'estado_civil'), '')
  FROM (VALUES ('vendedor_1', _p1), ('vendedor_2', _p2)) x(papel, o)
  WHERE x.papel = 'vendedor_1' OR nullif(btrim(coalesce(x.o->>'nome_completo', '')), '') IS NOT NULL;
  INSERT INTO public.sale_parties (sale_id, papel, tipo_pessoa) VALUES (_sale, 'comprador_1', 'fisica');

  INSERT INTO public.exclusive_history (capture_id, actor_id, action, detail)
    VALUES (_c.id, _actor, 'virou_venda', _sale::text);
  RETURN jsonb_build_object('criada', true, 'venda', public.exclusive_venda_ativa(_id));
END $function$;

-- 5) Vendas por região com tipo e área útil (pino continua anônimo) ------------------------------
-- Colunas novas no fim do RETURNS TABLE: o frontend publicado só ignora as colunas a mais.
DROP FUNCTION public.vendas_por_regiao_todos(date, date);
CREATE FUNCTION public.vendas_por_regiao_todos(_de date DEFAULT NULL, _ate date DEFAULT NULL)
 RETURNS TABLE (
  tipo text,
  sale_id uuid,
  data_fechamento date,
  modalidade text,
  codigo text,
  qtd integer,
  valor numeric,
  imovel_endereco text,
  imovel_bairro text,
  imovel_cidade text,
  imovel_uf text,
  geo_key text,
  geo_lat double precision,
  geo_lon double precision,
  tipo_imovel text,
  area_util_m2 numeric
 )
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE _org uuid := public.current_org_id();
BEGIN
  IF NOT public.relatorio_regiao_permitido() THEN
    RAISE EXCEPTION 'Ação não permitida' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH v AS (
    SELECT c.sale_id, c.data_fechamento, c.modalidade, coalesce(c.valor_negociado, 0) AS valor,
           coalesce(nullif(c.codigo_interno, ''), c.imovel_id) AS codigo,
           s.imovel_endereco, s.imovel_bairro, s.imovel_cidade, s.imovel_uf,
           g.geo_key, g.geo_lat, g.geo_lon,
           s.tipo_imovel,
           -- Terreno: área do terreno (como no estudo). Demais: área útil.
           CASE WHEN s.tipo_imovel = 'Terreno' THEN s.area_terreno_m2 ELSE s.area_util_m2 END AS area,
           coalesce(public.can_view_sale(auth.uid(), c.sale_id), false) AS det
    FROM public.vendas_comerciais_canonicas() c
    JOIN public.sales s ON s.id = c.sale_id AND s.organization_id = _org
    LEFT JOIN public.sale_geo g ON g.sale_id = s.id AND g.organization_id = _org
    WHERE (_de IS NULL OR c.data_fechamento >= _de)
      AND (_ate IS NULL OR c.data_fechamento <= _ate)
  )
  SELECT 'venda'::text, v.sale_id, v.data_fechamento, v.modalidade, v.codigo, 1, v.valor,
         v.imovel_endereco, v.imovel_bairro, v.imovel_cidade, v.imovel_uf, v.geo_key, v.geo_lat, v.geo_lon,
         v.tipo_imovel, v.area
    FROM v WHERE v.det
  UNION ALL
  SELECT 'grupo'::text, NULL::uuid, NULL::date, NULL::text, NULL::text, count(*)::integer, sum(v.valor),
         NULL::text, v.imovel_bairro, v.imovel_cidade, v.imovel_uf, NULL::text, NULL::double precision,
         NULL::double precision, NULL::text, NULL::numeric
    FROM v WHERE NOT v.det
    GROUP BY v.imovel_bairro, v.imovel_cidade, v.imovel_uf
  UNION ALL
  SELECT 'pino'::text, NULL::uuid, NULL::date, v.modalidade, NULL::text, 1, v.valor,
         NULL::text, v.imovel_bairro, v.imovel_cidade, v.imovel_uf, NULL::text,
         round(v.geo_lat::numeric, 3)::double precision, round(v.geo_lon::numeric, 3)::double precision,
         v.tipo_imovel, v.area
    FROM v WHERE NOT v.det AND v.geo_lat IS NOT NULL AND v.geo_lon IS NOT NULL;
END $function$;

-- Dono e permissões -----------------------------------------------------------------------------
GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.exclusive_virar_venda(uuid) OWNER TO mt_1b_definer;
ALTER FUNCTION public.vendas_por_regiao_todos(date, date) OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;

REVOKE ALL ON FUNCTION public.sales_ficha_confirmacao() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bloquear_avanco_sem_ficha_imovel() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ficha_imovel_faltando(public.sales) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ficha_area_do_texto(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ficha_int_do_texto(text, int, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ficha_tipo_do_texto(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ficha_imovel_faltando(public.sales) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ficha_area_do_texto(text) TO authenticated, service_role, mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.ficha_int_do_texto(text, int, int) TO authenticated, service_role, mt_1b_definer;
GRANT EXECUTE ON FUNCTION public.ficha_tipo_do_texto(text) TO authenticated, service_role, mt_1b_definer;
REVOKE ALL ON FUNCTION public.exclusive_virar_venda(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_virar_venda(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.vendas_por_regiao_todos(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendas_por_regiao_todos(date, date) TO authenticated, service_role;

COMMIT;
