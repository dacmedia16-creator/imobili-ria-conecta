-- Rollback de 20261008220000_ficha_imovel.sql
-- Volta exclusive_virar_venda ao corpo de 20261008190000 e vendas_por_regiao_todos ao de 20261008200000
-- (copiados literalmente), remove as travas/funções da ficha e APAGA as colunas da ficha em sales
-- (os dados digitados nelas se perdem: exporte antes se já houver uso real).
-- O front publicado antes desta versão funciona com este banco. O front novo também abre, mas a
-- gravação da ficha falha (colunas inexistentes): reverter o front junto.
-- Depois de rodar, remover a linha 20261008220000 de supabase_migrations.schema_migrations.
BEGIN;

DROP TRIGGER IF EXISTS trg_bloquear_avanco_sem_ficha_imovel ON public.sales;
DROP TRIGGER IF EXISTS trg_sales_ficha_confirmacao ON public.sales;
DROP FUNCTION IF EXISTS public.bloquear_avanco_sem_ficha_imovel();
DROP FUNCTION IF EXISTS public.sales_ficha_confirmacao();
DROP FUNCTION IF EXISTS public.ficha_imovel_faltando(public.sales);

CREATE OR REPLACE FUNCTION public.exclusive_virar_venda(_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE _c public.exclusive_captures%ROWTYPE; _actor uuid := auth.uid(); _sale uuid;
        _im jsonb; _p1 jsonb; _p2 jsonb; _v text; _valor numeric; _uf text;
        _lider uuid; _lider_nome text; _captador_nome text; _existente jsonb;
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
    corretor_vendedor_id, corretor_vendedor)
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
    _actor, (SELECT nullif(btrim(nome), '') FROM public.profiles WHERE id = _actor))
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

DROP FUNCTION IF EXISTS public.ficha_area_do_texto(text);
DROP FUNCTION IF EXISTS public.ficha_int_do_texto(text, int, int);
DROP FUNCTION IF EXISTS public.ficha_tipo_do_texto(text);

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
  geo_lon double precision
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
           coalesce(public.can_view_sale(auth.uid(), c.sale_id), false) AS det
    FROM public.vendas_comerciais_canonicas() c
    JOIN public.sales s ON s.id = c.sale_id AND s.organization_id = _org
    LEFT JOIN public.sale_geo g ON g.sale_id = s.id AND g.organization_id = _org
    WHERE (_de IS NULL OR c.data_fechamento >= _de)
      AND (_ate IS NULL OR c.data_fechamento <= _ate)
  )
  SELECT 'venda'::text, v.sale_id, v.data_fechamento, v.modalidade, v.codigo, 1, v.valor,
         v.imovel_endereco, v.imovel_bairro, v.imovel_cidade, v.imovel_uf, v.geo_key, v.geo_lat, v.geo_lon
    FROM v WHERE v.det
  UNION ALL
  SELECT 'grupo'::text, NULL::uuid, NULL::date, NULL::text, NULL::text, count(*)::integer, sum(v.valor),
         NULL::text, v.imovel_bairro, v.imovel_cidade, v.imovel_uf, NULL::text, NULL::double precision,
         NULL::double precision
    FROM v WHERE NOT v.det
    GROUP BY v.imovel_bairro, v.imovel_cidade, v.imovel_uf
  UNION ALL
  SELECT 'pino'::text, NULL::uuid, NULL::date, v.modalidade, NULL::text, 1, v.valor,
         NULL::text, v.imovel_bairro, v.imovel_cidade, v.imovel_uf, NULL::text,
         round(v.geo_lat::numeric, 3)::double precision, round(v.geo_lon::numeric, 3)::double precision
    FROM v WHERE NOT v.det AND v.geo_lat IS NOT NULL AND v.geo_lon IS NOT NULL;
END $function$;

GRANT CREATE ON SCHEMA public TO mt_1b_definer;
ALTER FUNCTION public.exclusive_virar_venda(uuid) OWNER TO mt_1b_definer;
ALTER FUNCTION public.vendas_por_regiao_todos(date, date) OWNER TO mt_1b_definer;
REVOKE CREATE ON SCHEMA public FROM mt_1b_definer;
REVOKE ALL ON FUNCTION public.exclusive_virar_venda(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_virar_venda(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.vendas_por_regiao_todos(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendas_por_regiao_todos(date, date) TO authenticated, service_role;

ALTER TABLE public.sales
  DROP CONSTRAINT IF EXISTS sales_tipo_imovel_check,
  DROP CONSTRAINT IF EXISTS sales_ficha_areas_check,
  DROP CONSTRAINT IF EXISTS sales_ficha_contagens_check,
  DROP CONSTRAINT IF EXISTS sales_ano_construcao_check,
  DROP CONSTRAINT IF EXISTS sales_area_origem_check,
  DROP COLUMN IF EXISTS tipo_imovel,
  DROP COLUMN IF EXISTS area_util_m2,
  DROP COLUMN IF EXISTS area_construida_m2,
  DROP COLUMN IF EXISTS area_terreno_m2,
  DROP COLUMN IF EXISTS ano_construcao,
  DROP COLUMN IF EXISTS quartos,
  DROP COLUMN IF EXISTS suites,
  DROP COLUMN IF EXISTS banheiros,
  DROP COLUMN IF EXISTS vagas,
  DROP COLUMN IF EXISTS area_origem,
  DROP COLUMN IF EXISTS area_confirmada_por,
  DROP COLUMN IF EXISTS area_confirmada_em;

COMMIT;
