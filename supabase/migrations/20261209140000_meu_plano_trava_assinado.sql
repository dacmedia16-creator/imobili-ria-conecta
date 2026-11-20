-- Meu Plano 2027: plano ASSINADO fica só leitura nos campos de meta e cálculo (cartão t_850a0d39, Denis 20/11,
-- tópico 6238: "trava sim"). Para mudar, o gestor/admin/TL reabre (carreira_plano_reabrir, migration 20261209130000).
--
-- Só ADITIVA: 2 funções novas + 1 gatilho + 1 política RESTRITIVA. Não redefine nenhuma RPC existente
-- (carreira_plano_salvar/_trilha/_assinar/_usar_meta/_reabrir ficam como estão), não altera nenhum dado,
-- assinatura ou meta oficial já gravada.
--
-- Como trava (vale para QUALQUER caminho, inclusive chamar a RPC direto):
--  1) Gatilho BEFORE UPDATE em carreira_plano. Enquanto o plano continua assinado (assinado_corretor_em antes e
--     depois não nulos), recusa mudar:
--       - respostas, exceto os prefixos de ACOMPANHAMENTO/NAVEGAÇÃO: ac.* (p44 acompanhamento semanal),
--         pm.* (p43 painel mensal: realizado), sem.* (p50 checklist das 4 primeiras semanas),
--         mc.* (p51 marcos da 1ª captação/venda) e ui.* (última tela/página aberta);
--       - trilha e ativacao_inicio (carreira_plano_trilha);
--       - meta_oficial/meta_oficial_em, a não ser a gravação ÚNICA logo depois de assinar (a do próprio fluxo de
--         assinatura: meta ainda não gravada para esta assinatura e até 15 min depois dela).
--     Ficam livres: assinatura do broker (carreira_plano_assinar_broker), a reabertura (assinado_corretor_em vira
--     NULL) e o próprio ato de assinar (antes não assinado).
--  2) Política RESTRITIVA em minhas_metas: o dono não grava/apaga direto a meta ANUAL do ano de um plano
--     assinado (a tabela tem GRANT de escrita para authenticated). A RPC carreira_plano_usar_meta é SECURITY
--     DEFINER de dono postgres (ignora RLS) e continua passando pelo gatilho acima.
-- Plano em preenchimento: nada muda.
-- Rollback: docs/sql/rollback/20261209140000_meu_plano_trava_assinado.rollback.sql
BEGIN;

-- Parte do plano que NÃO pode mudar depois de assinado (tudo menos acompanhamento/navegação).
-- Espelho de campoLivre() em src/lib/meu-plano-2027/trava-assinado.ts.
CREATE OR REPLACE FUNCTION public.carreira_plano_parte_travada(_r jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO '' AS $function$
  SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    FROM jsonb_each(CASE WHEN jsonb_typeof(_r) = 'object' THEN _r ELSE '{}'::jsonb END) e
   WHERE split_part(e.key, '.', 1) NOT IN ('ac', 'pm', 'sem', 'mc', 'ui')
$function$;
REVOKE ALL ON FUNCTION public.carreira_plano_parte_travada(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carreira_plano_parte_travada(jsonb) TO service_role;

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
  IF (NEW.meta_oficial IS DISTINCT FROM OLD.meta_oficial OR NEW.meta_oficial_em IS DISTINCT FROM OLD.meta_oficial_em)
     AND NOT ((OLD.meta_oficial_em IS NULL OR OLD.meta_oficial_em < OLD.assinado_corretor_em)
              AND now() <= OLD.assinado_corretor_em + interval '15 minutes') THEN
    RAISE EXCEPTION 'Plano assinado. Para mudar, peça ao seu gestor para reabrir.' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.carreira_plano_trava_assinado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_carreira_plano_trava_assinado ON public.carreira_plano;
CREATE TRIGGER trg_carreira_plano_trava_assinado BEFORE UPDATE ON public.carreira_plano
  FOR EACH ROW EXECUTE FUNCTION public.carreira_plano_trava_assinado();

-- O PRÓPRIO plano do ano está assinado? (uso da política abaixo; dono postgres para enxergar o plano sem depender
-- da RLS). Só responde sobre o usuário logado: sobre outra pessoa devolve false (não vaza nada).
CREATE OR REPLACE FUNCTION public.carreira_plano_assinado(_org uuid, _uid uuid, _ano integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
  SELECT _uid = auth.uid() AND EXISTS (SELECT 1 FROM public.carreira_plano cp
                  WHERE cp.organization_id = _org AND cp.user_id = _uid AND cp.ano = _ano
                    AND cp.assinado_corretor_em IS NOT NULL)
$function$;
ALTER FUNCTION public.carreira_plano_assinado(uuid, uuid, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.carreira_plano_assinado(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_plano_assinado(uuid, uuid, integer) TO authenticated, service_role;

-- Meta anual (minhas_metas, período 'ano') do ano de um plano assinado: o dono não grava nem apaga direto.
-- RESTRITIVAS (somam às políticas atuais) só de escrita; a leitura (SELECT) não muda. Metas de mês e de outros
-- anos seguem livres.
DROP POLICY IF EXISTS zz_meta_ano_assinado_ins ON public.minhas_metas;
DROP POLICY IF EXISTS zz_meta_ano_assinado_upd ON public.minhas_metas;
DROP POLICY IF EXISTS zz_meta_ano_assinado_del ON public.minhas_metas;
CREATE POLICY zz_meta_ano_assinado_ins ON public.minhas_metas AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (periodo <> 'ano'
    OR NOT public.carreira_plano_assinado(organization_id, user_id, extract(year FROM inicio)::integer));
CREATE POLICY zz_meta_ano_assinado_upd ON public.minhas_metas AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (periodo <> 'ano'
    OR NOT public.carreira_plano_assinado(organization_id, user_id, extract(year FROM inicio)::integer))
  WITH CHECK (periodo <> 'ano'
    OR NOT public.carreira_plano_assinado(organization_id, user_id, extract(year FROM inicio)::integer));
CREATE POLICY zz_meta_ano_assinado_del ON public.minhas_metas AS RESTRICTIVE FOR DELETE TO authenticated
  USING (periodo <> 'ano'
    OR NOT public.carreira_plano_assinado(organization_id, user_id, extract(year FROM inicio)::integer));

COMMIT;
