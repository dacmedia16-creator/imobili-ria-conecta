-- Venda: salvar Resumo + comissões extras numa ÚNICA transação (t_8ab6c348; boletim t_9c02ccf5 item 8,
-- autorizado por Denis em 22/11/2026, tópico 6238).
--
-- Antes: a tela da venda gravava pelo navegador em sequência (UPDATE sales -> DELETE/INSERT/UPDATE de cada
-- linha de sale_commission_extras). Se uma etapa falhasse no meio, as anteriores ficavam gravadas e a comissão
-- ficava pela metade. Agora a tela chama esta RPC uma vez: ou grava tudo, ou não grava nada.
--
-- Mesmo resultado de hoje: mesma ordem (venda -> remoções -> inclusões/alterações na ordem da tela), só as
-- colunas que a tela mandou entram no SET (os gatilhos "UPDATE OF ..." disparam igual) e as regras de acesso
-- (RLS) das duas tabelas continuam valendo, porque a função roda com o papel de quem chama.
--
-- Por que SECURITY INVOKER e não DEFINER: o dono das funções (postgres) tem BYPASSRLS. Como DEFINER, a função
-- pularia as 22 políticas de sales/sale_commission_extras (dono do rascunho, gestor da equipe, co-líder, trava
-- financeira, isolamento por imobiliária, fotógrafo/locação fora) e precisaria copiá-las à mão, com risco de
-- mudar quem pode salvar. Como INVOKER, a atomicidade é a mesma (uma chamada = uma transação) e o acesso é
-- exatamente o de hoje. A função ainda confere explicitamente login, venda visível e imobiliária do usuário.
--
-- Igual a hoje também no caso em que a regra de acesso esconde a linha: o UPDATE passa com 0 linhas, sem erro
-- (antes o navegador fazia o mesmo). A função só devolve as contagens (venda_linhas, extras_sem_alteracao),
-- para um ajuste futuro avisar a pessoa, sem mudar quem consegue avançar a venda agora.
BEGIN;

CREATE OR REPLACE FUNCTION public.venda_salvar_resumo(
  _sale_id uuid,
  _patch jsonb DEFAULT '{}'::jsonb,
  _extras jsonb DEFAULT NULL,
  _extras_remover uuid[] DEFAULT '{}'::uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid;
  _cols text;
  _bad text;
  _n bigint;
  _venda_linhas bigint := 0;
  _sem_alteracao integer := 0;
  _x jsonb;
  _id uuid;
  _ids jsonb := '[]'::jsonb;
  _r public.sale_commission_extras;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sua sessão expirou. Entre de novo para salvar a venda.' USING ERRCODE = '42501';
  END IF;
  IF _sale_id IS NULL THEN
    RAISE EXCEPTION 'Venda não informada.' USING ERRCODE = '22023';
  END IF;
  IF _patch IS NULL THEN _patch := '{}'::jsonb; END IF;
  IF jsonb_typeof(_patch) <> 'object' THEN
    RAISE EXCEPTION 'Dados da venda em formato inválido.' USING ERRCODE = '22023';
  END IF;
  IF _extras IS NOT NULL AND jsonb_typeof(_extras) <> 'array' THEN
    RAISE EXCEPTION 'Participações extras em formato inválido.' USING ERRCODE = '22023';
  END IF;

  -- Venda visível para quem chama (RLS) e da imobiliária em que a pessoa está agora.
  SELECT s.organization_id INTO _org FROM public.sales s WHERE s.id = _sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venda não encontrada ou sem acesso. Atualize a página.' USING ERRCODE = '42501';
  END IF;
  IF _org IS DISTINCT FROM public.current_org_id() THEN
    RAISE EXCEPTION 'Esta venda é de outra imobiliária.' USING ERRCODE = '42501';
  END IF;

  -- 1) Resumo: só as colunas enviadas. Identidade, imobiliária, dono e etapa não mudam por aqui.
  IF _patch <> '{}'::jsonb THEN
    SELECT string_agg(k, ', ') INTO _bad
      FROM jsonb_object_keys(_patch) k
     WHERE k IN ('id', 'organization_id', 'corretor_id', 'status', 'created_at', 'updated_at')
        OR NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = 'public.sales'::pg_catalog.regclass
             AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped);
    IF _bad IS NOT NULL THEN
      RAISE EXCEPTION 'Campo da venda não pode ser salvo por aqui (%).', _bad USING ERRCODE = '22023';
    END IF;
    SELECT string_agg(pg_catalog.format('%I = r.%I', k, k), ', ' ORDER BY k) INTO _cols
      FROM jsonb_object_keys(_patch) k;
    EXECUTE pg_catalog.format(
      'UPDATE public.sales s SET %s FROM jsonb_populate_record(NULL::public.sales, $1) r WHERE s.id = $2',
      _cols) USING _patch, _sale_id;
    GET DIAGNOSTICS _venda_linhas = ROW_COUNT;
  END IF;

  -- 2) Comissões extras (só quando a tela mandou a lista).
  IF _extras IS NOT NULL THEN
    -- Remoções: as linhas que a tela tirou. Linha que já não existe não trava (igual a hoje).
    IF coalesce(cardinality(_extras_remover), 0) > 0 THEN
      DELETE FROM public.sale_commission_extras e
       WHERE e.sale_id = _sale_id AND e.id = ANY (_extras_remover);
    END IF;

    -- Inclusões/alterações na ordem da tela; devolve os ids na mesma ordem.
    FOR _x IN SELECT v FROM jsonb_array_elements(_extras) WITH ORDINALITY t(v, i) ORDER BY i LOOP
      IF jsonb_typeof(_x) <> 'object' THEN
        RAISE EXCEPTION 'Participação extra em formato inválido.' USING ERRCODE = '22023';
      END IF;
      _r := jsonb_populate_record(NULL::public.sale_commission_extras, _x);
      _id := NULLIF(_x ->> 'id', '')::uuid;
      IF _id IS NULL THEN
        INSERT INTO public.sale_commission_extras
          (sale_id, nome, origem, papel, percentual, valor, user_id, lado, creci_tipo, creci)
        VALUES
          (_sale_id, _r.nome,
           CASE WHEN _x ? 'origem' THEN _r.origem ELSE 'imobiliaria' END,
           _r.papel, _r.percentual, _r.valor, _r.user_id, _r.lado, _r.creci_tipo, _r.creci)
        RETURNING id INTO _id;
      ELSE
        UPDATE public.sale_commission_extras e SET
          nome = _r.nome,
          origem = CASE WHEN _x ? 'origem' THEN _r.origem ELSE e.origem END,
          papel = _r.papel,
          percentual = _r.percentual,
          valor = _r.valor,
          user_id = _r.user_id,
          lado = _r.lado,
          creci_tipo = _r.creci_tipo,
          creci = _r.creci
        WHERE e.id = _id AND e.sale_id = _sale_id;
        GET DIAGNOSTICS _n = ROW_COUNT;
        IF _n = 0 THEN _sem_alteracao := _sem_alteracao + 1; END IF;
      END IF;
      _ids := _ids || to_jsonb(_id::text);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('extras', _ids, 'venda_linhas', _venda_linhas,
                            'extras_sem_alteracao', _sem_alteracao);
END;
$$;

COMMENT ON FUNCTION public.venda_salvar_resumo(uuid, jsonb, jsonb, uuid[]) IS
  'Salva o Resumo da venda + comissões extras numa única transação (t_8ab6c348). SECURITY INVOKER: valem as políticas de sales/sale_commission_extras de quem chama.';

REVOKE ALL ON FUNCTION public.venda_salvar_resumo(uuid, jsonb, jsonb, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.venda_salvar_resumo(uuid, jsonb, jsonb, uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.venda_salvar_resumo(uuid, jsonb, jsonb, uuid[]) TO authenticated;

COMMIT;
