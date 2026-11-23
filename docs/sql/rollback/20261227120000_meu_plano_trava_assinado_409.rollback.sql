-- Rollback de 20261227120000_meu_plano_trava_assinado_409 (cartão t_359e9e2a).
-- Volta o SQLSTATE da trava do plano assinado para 55000 (HTTP 500 no PostgREST). Corpo idêntico ao da
-- migration 20261209140000. A trava continua valendo; nenhum dado é alterado. ACL mantida (CREATE OR REPLACE).
BEGIN;

CREATE OR REPLACE FUNCTION public.carreira_plano_trava_assinado()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
BEGIN
  -- Em preenchimento, assinando agora ou sendo reaberto: segue normal.
  IF OLD.assinado_corretor_em IS NULL OR NEW.assinado_corretor_em IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.assinado_corretor_em IS DISTINCT FROM OLD.assinado_corretor_em
     OR NEW.trilha IS DISTINCT FROM OLD.trilha
     OR NEW.ativacao_inicio IS DISTINCT FROM OLD.ativacao_inicio
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.ano IS DISTINCT FROM OLD.ano
     OR public.carreira_plano_parte_travada(NEW.respostas)
        IS DISTINCT FROM public.carreira_plano_parte_travada(OLD.respostas) THEN
    RAISE EXCEPTION 'Plano assinado. Para mudar, peça ao seu gestor para reabrir.' USING ERRCODE = '55000';
  END IF;
  -- shortcut: a meta da assinatura é gravada numa 2ª chamada (o app chama carreira_plano_usar_meta logo depois de
  -- assinar), então vale 1 gravação nos 15 min seguintes; o servidor não confere se a meta bate com as respostas.
  IF (NEW.meta_oficial IS DISTINCT FROM OLD.meta_oficial OR NEW.meta_oficial_em IS DISTINCT FROM OLD.meta_oficial_em)
     AND NOT ((OLD.meta_oficial_em IS NULL OR OLD.meta_oficial_em < OLD.assinado_corretor_em)
              AND now() <= OLD.assinado_corretor_em + interval '15 minutes') THEN
    RAISE EXCEPTION 'Plano assinado. Para mudar, peça ao seu gestor para reabrir.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $function$;

COMMIT;
