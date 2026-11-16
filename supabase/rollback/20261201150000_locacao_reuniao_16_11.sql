-- Rollback da 20261201150000_locacao_reuniao_16_11 (t_8f09d406).
-- Devolve o texto exato (tirado da produção em 16/11) das 7 funções redefinidas e apaga o que a migration criou.
-- Dados criados depois (lançamentos, avisos, vínculos de clientes) são apagados com as tabelas; os cadastros
-- em public.clientes criados pela locação FICAM (são clientes reais da imobiliária).
BEGIN;
SELECT set_config('lock_timeout', '5s', true);
DROP TRIGGER IF EXISTS locacao_zz_clientes ON public.locacao_contrato_dados;
DROP TRIGGER IF EXISTS locacao_zz_clientes ON public.locacoes;
DROP TRIGGER IF EXISTS locacao_zz_avisos ON public.locacao_andamentos;
DROP TRIGGER IF EXISTS locacao_zz_avisos ON public.locacoes;
DROP TRIGGER IF EXISTS locacao_00_abertura ON public.locacoes;
DROP FUNCTION IF EXISTS public.locacao_trg_clientes();
DROP FUNCTION IF EXISTS public.locacao_clientes_sincronizar(uuid);
DROP FUNCTION IF EXISTS public.locacao_avisos_concluir(uuid, text, text);
DROP FUNCTION IF EXISTS public.locacao_avisos_reservar(uuid, integer);
DROP FUNCTION IF EXISTS public.locacao_avisos_pode(uuid);
DROP FUNCTION IF EXISTS public.locacao_trg_avisos_andamento();
DROP FUNCTION IF EXISTS public.locacao_trg_avisos();
DROP FUNCTION IF EXISTS public.locacao_aviso_novo(public.locacoes, text, text, text);
DROP FUNCTION IF EXISTS public.locacao_lancamento_salvar(uuid, jsonb);
DROP FUNCTION IF EXISTS public.locacao_lancamento_ler(uuid);
DROP FUNCTION IF EXISTS public.locacao_imovel_tipo_definir(uuid, text);
DROP FUNCTION IF EXISTS public.locacao_criar(text);
DROP FUNCTION IF EXISTS public.locacao_trg_abertura();
DROP FUNCTION IF EXISTS public.locacao_equipe_do_corretor(uuid, uuid);
DROP TABLE IF EXISTS public.locacao_clientes;
DROP TABLE IF EXISTS public.locacao_avisos;
DROP TABLE IF EXISTS public.locacao_lancamentos;

CREATE OR REPLACE FUNCTION public.locacao_contrato_faltando(_l locacoes)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$;
REVOKE ALL ON FUNCTION public.locacao_contrato_faltando(locacoes) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.locacao_criar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.locacao_ctx(); _l public.locacoes;
BEGIN
  IF NOT (public.has_any_role(auth.uid(), ARRAY['corretor', 'gestor', 'team_leader', 'admin', 'super_admin']::public.app_role[])
          OR public.so_locacao_ativo(auth.uid())) THEN
    RAISE EXCEPTION 'Só corretores criam locações.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.locacoes (organization_id, corretor_id) VALUES (_org, auth.uid()) RETURNING * INTO _l;
  PERFORM public.locacao_evento(_l, 'corretor', 'Pré-análise iniciada');
  RETURN jsonb_build_object('id', _l.id);
END $function$;
REVOKE ALL ON FUNCTION public.locacao_criar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.locacao_criar() TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_docs_grupo(_org uuid, _grupo text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _j jsonb := (public.locacao_cfg(_org)).documentos; _v jsonb;
BEGIN
  _v := _j->_grupo;
  IF right(_grupo, 3) = '_pj' AND (_v IS NULL OR jsonb_typeof(_v) <> 'array' OR jsonb_array_length(_v) = 0) THEN
    _v := _j->left(_grupo, -3);
  END IF;
  IF _v IS NULL OR jsonb_typeof(_v) <> 'array' THEN RETURN ARRAY[]::text[]; END IF;
  RETURN coalesce((SELECT array_agg(x ORDER BY n) FROM jsonb_array_elements_text(_v) WITH ORDINALITY t(x, n)), ARRAY[]::text[]);
END $function$;
REVOKE ALL ON FUNCTION public.locacao_docs_grupo(uuid,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.locacao_ficha_ok(_f jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
END $function$;
REVOKE ALL ON FUNCTION public.locacao_ficha_ok(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.locacao_lista()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _org uuid := public.locacao_ctx();
BEGIN
  RETURN (SELECT coalesce(jsonb_agg(public.locacao_json(l) - 'ficha' ORDER BY l.etapa_desde), '[]')
            FROM public.locacoes l WHERE l.organization_id = _org AND public.locacao_pode_ver(l));
END $function$;
REVOKE ALL ON FUNCTION public.locacao_lista() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.locacao_lista() TO authenticated;

CREATE OR REPLACE FUNCTION public.locacao_partes(_l locacoes)
 RETURNS TABLE(ordem integer, parte text, grupo text, rotulo text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
  -- t_d3e1c29f: seguro-fiança não pede documento na Documentação (apólice vai em "Seguro e condomínio").
  WHERE NOT (v.ordem = 2 AND v.parte = 'seguro_fianca')
$function$;
REVOKE ALL ON FUNCTION public.locacao_partes(locacoes) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.locacao_pre_faltando(_l locacoes)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
END $function$;
REVOKE ALL ON FUNCTION public.locacao_pre_faltando(locacoes) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.locacao_imovel_tipo_rotulo(text);
DROP INDEX IF EXISTS public.locacoes_equipe_idx;
ALTER TABLE public.locacoes DROP COLUMN IF EXISTS imovel_tipo, DROP COLUMN IF EXISTS equipe_id,
  DROP COLUMN IF EXISTS equipe_nome, DROP COLUMN IF EXISTS equipe_gestor_id, DROP COLUMN IF EXISTS equipe_gestor_nome,
  DROP COLUMN IF EXISTS equipe_tl_id, DROP COLUMN IF EXISTS equipe_tl_nome, DROP COLUMN IF EXISTS equipe_gravada_em;
COMMIT;
