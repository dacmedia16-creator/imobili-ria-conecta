-- t_b3a9ed4f — Captação: remover o proprietário N (N ≥ 2) mesmo com documentos anexados.
-- Aditiva: só cria a função exclusive_remove_owner; nenhuma tabela, policy ou dado alterado.
--
-- Os documentos ficam ligados ao proprietário pelo número (owner_index). Para tirar um do meio sem
-- trocar documento de pessoa, tudo acontece numa transação só, com a captação travada (FOR UPDATE):
--  1. confere quem pode: mesma regra de editar/remover documento (exclusive_is_editor: rascunho ou
--     devolvida, não arquivada, mesma imobiliária). Nenhum status novo é liberado;
--  2. confere que a tela está vendo a mesma quantidade de proprietários que está gravada (_total);
--  3. tira o N do form_data (proprietario_2 / proprietarios_extras, mesmo formato da tela);
--  4. apaga os documentos do N e desce N+1→N, N+2→N+1… em ordem crescente (o UNIQUE
--     capture_id+kind+owner_index não é adiável; subir em ordem nunca colide);
--  5. apaga o PDF 'gerado' (igual ao exclusive_save: o contrato antigo não vale mais) e grava o
--     histórico 'proprietario_removido'.
-- Devolve os storage_path apagados; a server function removerProprietarioCaptacao apaga os arquivos
-- (service_role), igual ao exclusive_remove_document.
-- Rollback: supabase/rollback/20261230120000_captacao_remover_proprietario_com_documentos.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.exclusive_remove_owner(_id uuid, _n integer, _total integer)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _form jsonb; _owners jsonb; _rest jsonb; _len integer; _paths text[]; _i integer;
BEGIN
  SELECT form_data INTO _form FROM public.exclusive_captures WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR NOT public.exclusive_can_view(_id, auth.uid()) THEN RAISE EXCEPTION 'Captação não disponível'; END IF;
  IF NOT public.exclusive_is_editor(_id, auth.uid()) THEN RAISE EXCEPTION 'Remoção não autorizada'; END IF;
  _owners := public.exclusive_owner_list(_form);
  _len := jsonb_array_length(_owners);
  IF _total IS DISTINCT FROM _len THEN
    RAISE EXCEPTION 'A lista de proprietários mudou. Recarregue a página e tente de novo.';
  END IF;
  IF _n IS NULL OR _n < 2 OR _n > _len THEN RAISE EXCEPTION 'O 1º proprietário é obrigatório.'; END IF;

  -- Lista sem o N (posição 1 = proprietario_1), devolvida ao formato salvo.
  SELECT coalesce(jsonb_agg(x.e ORDER BY x.k), '[]'::jsonb) INTO _rest
    FROM jsonb_array_elements(_owners) WITH ORDINALITY x(e, k) WHERE x.k <> _n;
  _form := (_form - 'proprietario_2' - 'proprietarios_extras')
    || jsonb_build_object('proprietario_1', _rest->0);
  IF jsonb_array_length(_rest) >= 2 THEN
    _form := _form || jsonb_build_object('proprietario_2', _rest->1);
  END IF;
  IF jsonb_array_length(_rest) > 2 THEN
    _form := _form || jsonb_build_object('proprietarios_extras',
      (SELECT jsonb_agg(x.e ORDER BY x.k) FROM jsonb_array_elements(_rest) WITH ORDINALITY x(e, k) WHERE x.k > 2));
  END IF;

  WITH d AS (
    DELETE FROM public.exclusive_documents
     WHERE capture_id = _id AND owner_index = _n
    RETURNING storage_path
  ) SELECT coalesce(array_agg(storage_path), '{}') INTO _paths FROM d;
  FOR _i IN SELECT DISTINCT owner_index FROM public.exclusive_documents
             WHERE capture_id = _id AND owner_index > _n ORDER BY 1 LOOP
    UPDATE public.exclusive_documents SET owner_index = _i - 1
     WHERE capture_id = _id AND owner_index = _i;
  END LOOP;

  UPDATE public.exclusive_captures SET form_data = _form, updated_at = now() WHERE id = _id;
  -- Mesmo do exclusive_save: o PDF gerado com a lista antiga não pode ser submetido.
  WITH g AS (
    DELETE FROM public.exclusive_documents WHERE capture_id = _id AND kind = 'gerado'
    RETURNING storage_path
  ) SELECT _paths || coalesce(array_agg(storage_path), '{}') INTO _paths FROM g;
  INSERT INTO public.exclusive_history(capture_id,actor_id,action,detail)
    VALUES (_id, auth.uid(), 'proprietario_removido',
            'proprietario:' || _n::text || ' de ' || _len::text);
  RETURN _paths;
END $function$;
REVOKE ALL ON FUNCTION public.exclusive_remove_owner(uuid,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exclusive_remove_owner(uuid,integer,integer) TO authenticated;

COMMIT;
