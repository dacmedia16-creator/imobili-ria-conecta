-- Feedback ao Proprietário: quando o ID RE/MAX de um perfil é salvo, corrigido ou apagado,
-- os anúncios dos portais (todas as semanas) passam na hora para o dono certo.
-- Só mexe em broker_id; números e coletas não mudam.

CREATE OR REPLACE FUNCTION public.portal_relink_broker()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.remax_id IS NOT DISTINCT FROM OLD.remax_id
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id THEN
    RETURN NEW;
  END IF;

  -- Desliga anúncios que não batem mais com o ID/empresa deste perfil.
  IF TG_OP = 'UPDATE' THEN
    UPDATE public.portal_listing_snapshots s
       SET broker_id = NULL
     WHERE s.broker_id = NEW.id
       AND (NEW.remax_id IS NULL
            OR s.remax_id IS DISTINCT FROM NEW.remax_id
            OR s.organization_id IS DISTINCT FROM NEW.organization_id);
  END IF;

  -- Liga os anúncios com o ID dele na mesma empresa (ID é único por empresa).
  IF NEW.remax_id IS NOT NULL AND NEW.organization_id IS NOT NULL THEN
    UPDATE public.portal_listing_snapshots s
       SET broker_id = NEW.id
     WHERE s.organization_id = NEW.organization_id
       AND s.remax_id = NEW.remax_id
       AND s.broker_id IS DISTINCT FROM NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.portal_relink_broker() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zz_portal_relink ON public.profiles;
CREATE TRIGGER trg_zz_portal_relink
  AFTER INSERT OR UPDATE OF remax_id, organization_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.portal_relink_broker();

-- Excluir um perfil não pode ficar travado pelos anúncios: o anúncio volta a ficar sem dono.
ALTER TABLE public.portal_listing_snapshots
  DROP CONSTRAINT IF EXISTS portal_listing_snapshots_broker_id_fkey,
  ADD CONSTRAINT portal_listing_snapshots_broker_id_fkey
    FOREIGN KEY (broker_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Acerto único do que já foi gravado (ex.: ID preenchido depois da coleta).
UPDATE public.portal_listing_snapshots s
   SET broker_id = p.id
  FROM public.profiles p
 WHERE p.organization_id = s.organization_id
   AND p.remax_id = s.remax_id
   AND s.broker_id IS DISTINCT FROM p.id;
