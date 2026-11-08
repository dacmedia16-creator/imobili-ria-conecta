-- Rollback da migration 20261108160000_meta_atividades_diario.sql (Meta x atividades, t_09c29e96).
-- Volta as funções do diário à versão da 20261016190000 e remove carreira_diario_equipe_semana.
-- NÃO apaga nem converte registros. Se já houver registros v1/v2/visita_comprador, a lista de tipos
-- aceitos continua ampliada (para não perder dados) e um aviso é mostrado; o resto volta ao original.
-- As cópias de metas "ms.*" gravadas em carreira_plano.respostas ficam (são inofensivas para o plano).
BEGIN;

DROP FUNCTION IF EXISTS public.carreira_diario_equipe_semana(integer);

CREATE OR REPLACE FUNCTION public.carreira_diario_validar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT coalesce(public.is_active_user(auth.uid()), false) THEN
    RAISE EXCEPTION 'Usuário inativo' USING ERRCODE = '42501';
  END IF;
  IF NEW.dia > _hoje OR NEW.dia < _hoje - 31 THEN
    RAISE EXCEPTION 'Registre atividades de hoje até 31 dias atrás.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.carreira_diario_validar() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.meu_diario_contagens()
RETURNS TABLE(tipo text, hoje integer, semana integer, mes integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
#variable_conflict use_column
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id();
  _d date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _seg date := date_trunc('week', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
  _mes date := date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo'))::date;
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false) THEN
    RAISE EXCEPTION 'Login necessário' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.tipo,
         coalesce(sum(d.quantidade) FILTER (WHERE d.dia = _d), 0)::integer,
         coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _seg), 0)::integer,
         coalesce(sum(d.quantidade) FILTER (WHERE d.dia >= _mes), 0)::integer
    FROM (VALUES ('ligacao', 1), ('visita', 2), ('acm', 3)) AS t(tipo, ordem)
    LEFT JOIN public.carreira_diario d
      ON d.tipo = t.tipo AND d.organization_id = _org AND d.user_id = _me
     AND d.dia >= least(_seg, _mes) AND d.dia <= _d
   GROUP BY t.tipo, t.ordem
   ORDER BY t.ordem;
END $function$;
REVOKE ALL ON FUNCTION public.meu_diario_contagens() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meu_diario_contagens() TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.carreira_diario WHERE tipo IN ('v1', 'v2', 'visita_comprador')) THEN
    RAISE NOTICE 'Há registros v1/v2/visita_comprador: a lista de tipos continua ampliada para não perder dados.';
  ELSE
    ALTER TABLE public.carreira_diario DROP CONSTRAINT carreira_diario_tipo_check;
    ALTER TABLE public.carreira_diario ADD CONSTRAINT carreira_diario_tipo_check
      CHECK (tipo IN ('ligacao', 'visita', 'acm'));
  END IF;
END $$;

COMMIT;
