-- Passo 3, etapa 0 do ecossistema UniHub: chave liga/desliga por imobiliária para Visita, Estudo e 60 Dias
-- (cartão t_1969ae17; decisões de Denis em 05/11/2026, levantamento t_a37fda31).
--
-- ADITIVA e SEM EFEITO para quem usa: nada lê estas chaves para bloquear nesta etapa.
-- Rollback: docs/sql/rollback/20261105150000_chave_sistemas_etapa0.rollback.sql
-- Sem BEGIN/COMMIT próprios: o ensaio roda o arquivo numa transação desfeita.
--
-- O que faz:
-- 1) Módulos novos 'visita', 'estudo' e 'sessenta' em organization_modules (CHECK + lista aceita em
--    platform_set_organization_module). Só o super-admin da plataforma liga/desliga (a RPC confere
--    is_platform_super_admin; authenticated só tem SELECT na tabela). O admin da imobiliária não mexe.
-- 2) Valor inicial = estado de hoje do sync_org_map (visita_enabled, estudo_enabled, sessenta_enabled).
--    Imobiliária sem linha no mapa: Visita e Estudo ligados, 60 Dias desligado. ON CONFLICT DO NOTHING.
--    Ninguém é desligado.
-- 3) Imobiliária nova nasce com Visita e Estudo ligados e 60 Dias desligado (gatilho AFTER INSERT em
--    organizations; cobre a criação pela plataforma e pelo convite).
-- 4) Trocar um desses 3 módulos reenfileira as pessoas da imobiliária (sync_enfileirar_org), para o robô
--    sync-satelites levar a cópia (adm_sync_orgs.acesso_ligado) a cada satélite. O gatilho é criado DEPOIS
--    do preenchimento inicial, então esta migration não reenfileira ninguém.
-- O sync_org_map NÃO muda de papel: continua decidindo para onde vai o cadastro. Desligar a chave não
-- apaga nada e não para o envio do cadastro (religar volta sem perda).

-- 1) Chave dos módulos -------------------------------------------------------------------------------
ALTER TABLE public.organization_modules DROP CONSTRAINT organization_modules_module_check;
ALTER TABLE public.organization_modules ADD CONSTRAINT organization_modules_module_check
  CHECK (module IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                    'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                    'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta'));

CREATE OR REPLACE FUNCTION public.platform_set_organization_module(_org uuid, _module text, _enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid := auth.uid(); _current boolean;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_super_admin(_actor) THEN
    RAISE EXCEPTION 'Apenas o super-admin da plataforma liga ou desliga modulos.' USING ERRCODE = '42501';
  END IF;
  IF _module IS NULL OR _module NOT IN ('captacao_exclusiva', 'reserva_salas', 'feedback_proprietario', 'oportunidades',
                                        'mural_conquistas', 'ranking_valores', 'leads', 'crm', 'especialistas_publico',
                                        'academia', 'vouchers_fotos', 'visita', 'estudo', 'sessenta')
     OR _enabled IS NULL THEN
    RAISE EXCEPTION 'Modulo invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN
    RAISE EXCEPTION 'Imobiliaria nao encontrada' USING ERRCODE = 'P0002';
  END IF;
  SELECT enabled INTO _current FROM public.organization_modules
    WHERE organization_id = _org AND module = _module FOR UPDATE;
  IF _current IS NOT DISTINCT FROM _enabled THEN RETURN _enabled; END IF;
  INSERT INTO public.organization_modules (organization_id, module, enabled, updated_at, updated_by)
  VALUES (_org, _module, _enabled, now(), _actor)
  ON CONFLICT (organization_id, module)
  DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by = _actor;
  INSERT INTO public.organization_module_history (organization_id, module, enabled, actor_id)
  VALUES (_org, _module, _enabled, _actor);
  RETURN _enabled;
END $$;

-- 2) Valor inicial = estado de hoje (ninguém é desligado) ------------------------------------------
INSERT INTO public.organization_modules (organization_id, module, enabled)
SELECT o.id, v.module,
       CASE v.module
         WHEN 'visita'   THEN coalesce(m.visita_enabled, true)
         WHEN 'estudo'   THEN coalesce(m.estudo_enabled, true)
         WHEN 'sessenta' THEN coalesce(m.sessenta_enabled, false)
       END
  FROM public.organizations o
  CROSS JOIN (VALUES ('visita'), ('estudo'), ('sessenta')) AS v(module)
  LEFT JOIN public.sync_org_map m ON m.adm_org_id = o.id
ON CONFLICT (organization_id, module) DO NOTHING;

-- 3) Imobiliária nova: Visita e Estudo ligados, 60 Dias desligado (decisão 6) ----------------------
CREATE OR REPLACE FUNCTION public.org_sistemas_padrao_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  INSERT INTO public.organization_modules (organization_id, module, enabled, updated_at, updated_by)
  VALUES (NEW.id, 'visita', true, now(), NEW.created_by),
         (NEW.id, 'estudo', true, now(), NEW.created_by),
         (NEW.id, 'sessenta', false, now(), NEW.created_by)
  ON CONFLICT (organization_id, module) DO NOTHING;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.org_sistemas_padrao_trg() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_zz_org_sistemas_padrao ON public.organizations;
CREATE TRIGGER trg_zz_org_sistemas_padrao AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.org_sistemas_padrao_trg();

-- 4) Mudou a chave de um sistema: reenfileira a imobiliária para a cópia chegar ao satélite ---------
-- Nunca faz a gravação do módulo falhar: erro vira aviso (a próxima mudança ou rodada leva a cópia).
CREATE OR REPLACE FUNCTION public.org_sistema_chave_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NEW.module IN ('visita', 'estudo', 'sessenta')
     AND (TG_OP = 'INSERT' OR OLD.enabled IS DISTINCT FROM NEW.enabled) THEN
    BEGIN
      PERFORM public.sync_enfileirar_org(NEW.organization_id, 'acesso_' || NEW.module);
    EXCEPTION WHEN others THEN
      RAISE WARNING 'org_sistema_chave_trg: %', sqlerrm;
    END;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.org_sistema_chave_trg() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_zz_org_sistema_chave ON public.organization_modules;
CREATE TRIGGER trg_zz_org_sistema_chave AFTER INSERT OR UPDATE OF enabled ON public.organization_modules
  FOR EACH ROW EXECUTE FUNCTION public.org_sistema_chave_trg();
