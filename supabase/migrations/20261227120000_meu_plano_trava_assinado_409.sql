-- Meu Plano 2027: a recusa da trava do plano assinado passa a responder HTTP 409 em vez de 500
-- (cartão t_359e9e2a, Denis 23/11 no tópico 6238: "2 sim"; diagnóstico t_c62ae99e).
--
-- O QUE MUDA: só o SQLSTATE do RAISE em public.carreira_plano_trava_assinado(): 55000 -> 'PT409'.
-- O PostgREST traduz SQLSTATE 'PTxyz' no HTTP xyz (docs PostgREST, "RAISE errors with HTTP Status Codes");
-- o 55000 (object_not_in_prerequisite_state) saía como HTTP 500 e o alerta diário contava como erro do servidor
-- (949 de 960 "rest 500" em 22/11 foram esta recusa).
-- O QUE NÃO MUDA: a regra da trava (mesmo corpo, mesmas condições, mesma mensagem), o gatilho, as políticas, os
-- donos e os grants (CREATE OR REPLACE mantém a ACL). Nenhum dado é alterado.
-- O app reconhece a recusa pelo código PT409 OU pela mensagem (src/lib/meu-plano-2027/trava-assinado.ts), então
-- funciona antes e depois desta migration.
-- Rollback: docs/sql/rollback/20261227120000_meu_plano_trava_assinado_409.rollback.sql (volta o 55000).
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
    RAISE EXCEPTION 'Plano assinado. Para mudar, peça ao seu gestor para reabrir.' USING ERRCODE = 'PT409';
  END IF;
  -- shortcut: a meta da assinatura é gravada numa 2ª chamada (o app chama carreira_plano_usar_meta logo depois de
  -- assinar), então vale 1 gravação nos 15 min seguintes; o servidor não confere se a meta bate com as respostas.
  IF (NEW.meta_oficial IS DISTINCT FROM OLD.meta_oficial OR NEW.meta_oficial_em IS DISTINCT FROM OLD.meta_oficial_em)
     AND NOT ((OLD.meta_oficial_em IS NULL OR OLD.meta_oficial_em < OLD.assinado_corretor_em)
              AND now() <= OLD.assinado_corretor_em + interval '15 minutes') THEN
    RAISE EXCEPTION 'Plano assinado. Para mudar, peça ao seu gestor para reabrir.' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END $function$;

COMMIT;
