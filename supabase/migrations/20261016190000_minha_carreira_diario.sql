-- Minha carreira, PR 5 (card t_2c0d5f0d): bloco "Diário de atividades" (ideia da Campolim na maquete:
-- registrar ligação, visita e ACM com 1 toque). Escopo decidido por Denis em 16/10 (opção "2"):
-- SOMENTE o diário, SEM pontos e FORA do ranking (carreira_ranking da etapa 3 não muda).
-- 1) carreira_diario: atividades registradas pelo próprio corretor. Ele lê, registra e apaga SÓ as
--    próprias, na imobiliária ativa, sendo usuário ativo. Admin/gestor da imobiliária só LÊ a equipe.
--    Tipos: ligacao, visita, acm. Só dias de hoje até 31 dias atrás (fuso de São Paulo).
-- 2) meu_diario_contagens(): quantidades de hoje, da semana (segunda a domingo) e do mês, por tipo,
--    do usuário logado.
-- 3) carreira_diario_equipe(_inicio, _fim): quantidades por corretor e tipo, só admin/gestor (leitura).
-- Anon sem acesso. Não altera vendas, captações, comissões nem ranking.
BEGIN;

CREATE TABLE IF NOT EXISTS public.carreira_diario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id() REFERENCES public.organizations(id),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  dia date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  tipo text NOT NULL CHECK (tipo IN ('ligacao', 'visita', 'acm')),
  quantidade integer NOT NULL DEFAULT 1 CHECK (quantidade BETWEEN 1 AND 200),
  observacao text CHECK (observacao IS NULL OR length(observacao) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS carreira_diario_org_user_dia ON public.carreira_diario (organization_id, user_id, dia);
CREATE INDEX IF NOT EXISTS carreira_diario_org_dia ON public.carreira_diario (organization_id, dia);

-- Valida usuário ativo e a data (de hoje até 31 dias atrás, fuso de São Paulo).
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
CREATE TRIGGER trg_carreira_diario_validar BEFORE INSERT ON public.carreira_diario
  FOR EACH ROW EXECUTE FUNCTION public.carreira_diario_validar();

ALTER TABLE public.carreira_diario ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.carreira_diario FROM PUBLIC, anon, authenticated;
-- Sem UPDATE: para corrigir, o corretor apaga e registra de novo.
GRANT SELECT, INSERT, DELETE ON public.carreira_diario TO authenticated;
GRANT ALL ON public.carreira_diario TO service_role;
CREATE POLICY org_isolation ON public.carreira_diario AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
CREATE POLICY usuario_ativo ON public.carreira_diario AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active_user((SELECT auth.uid()))))
  WITH CHECK ((SELECT public.is_active_user((SELECT auth.uid()))));
CREATE POLICY carreira_diario_proprio ON public.carreira_diario FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY carreira_diario_equipe_ler ON public.carreira_diario FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin', 'super_admin', 'gestor']::public.app_role[])));

-- 2) Contagens do próprio corretor -----------------------------------------------------------------
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

-- 3) Diário da equipe (admin/gestor, só leitura) ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.carreira_diario_equipe(_inicio date, _fim date)
RETURNS TABLE(user_id uuid, nome text, ligacoes integer, visitas integer, acms integer, ultimo_dia date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
#variable_conflict use_column
DECLARE _me uuid := auth.uid(); _org uuid := public.current_org_id();
BEGIN
  IF _me IS NULL OR _org IS NULL OR NOT coalesce(public.is_active_user(_me), false)
     OR NOT coalesce(public.has_any_role(_me, ARRAY['admin', 'super_admin', 'gestor']::public.app_role[]), false) THEN
    RAISE EXCEPTION 'Apenas gestor ou admin vê o diário da equipe' USING ERRCODE = '42501';
  END IF;
  IF _inicio IS NULL OR _fim IS NULL OR _fim < _inicio OR _fim - _inicio > 366 THEN
    RAISE EXCEPTION 'Período inválido' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT d.user_id, pr.nome,
         coalesce(sum(d.quantidade) FILTER (WHERE d.tipo = 'ligacao'), 0)::integer,
         coalesce(sum(d.quantidade) FILTER (WHERE d.tipo = 'visita'), 0)::integer,
         coalesce(sum(d.quantidade) FILTER (WHERE d.tipo = 'acm'), 0)::integer,
         max(d.dia)
    FROM public.carreira_diario d
    JOIN public.profiles pr ON pr.id = d.user_id
   WHERE d.organization_id = _org AND d.dia BETWEEN _inicio AND _fim
   GROUP BY d.user_id, pr.nome
   ORDER BY pr.nome
   LIMIT 200;
END $function$;
REVOKE ALL ON FUNCTION public.carreira_diario_equipe(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carreira_diario_equipe(date, date) TO authenticated, service_role;

COMMIT;
