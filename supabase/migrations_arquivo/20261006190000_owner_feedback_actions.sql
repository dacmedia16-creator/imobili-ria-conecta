-- Feedback ao Proprietário: plano de marketing + checklist do corretor.
-- Lista única por imobiliária (catálogo editável só por admin); o corretor marca o que já fez em cada imóvel.
-- Tudo respeita o módulo feedback_proprietario e o isolamento por imobiliária.

CREATE TABLE IF NOT EXISTS public.owner_feedback_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  list text NOT NULL CHECK (list IN ('marketing', 'checklist')),
  category text NOT NULL,
  label text NOT NULL CHECK (length(label) BETWEEN 2 AND 200),
  weight text CHECK (weight IN ('vital', 'importante', 'complementar')),
  sort integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, list, category, label)
);
CREATE INDEX IF NOT EXISTS owner_fb_actions_org_idx ON public.owner_feedback_actions (organization_id, list, sort);

CREATE TABLE IF NOT EXISTS public.owner_feedback_action_done (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT public.current_org_id() REFERENCES public.organizations(id) ON DELETE CASCADE,
  listing_code text NOT NULL CHECK (length(listing_code) BETWEEN 3 AND 60),
  action_id uuid NOT NULL REFERENCES public.owner_feedback_actions(id) ON DELETE CASCADE,
  done_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  done_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, listing_code, action_id)
);
CREATE INDEX IF NOT EXISTS owner_fb_done_code_idx ON public.owner_feedback_action_done (organization_id, listing_code);

DROP TRIGGER IF EXISTS owner_fb_actions_updated ON public.owner_feedback_actions;
CREATE TRIGGER owner_fb_actions_updated BEFORE UPDATE ON public.owner_feedback_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Quem pode marcar ações de um imóvel: dono do anúncio, líder dele ou administração.
CREATE OR REPLACE FUNCTION public.owner_feedback_can_edit(_code text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::public.app_role[])
      OR EXISTS (
        SELECT 1 FROM public.portal_listing_snapshots s
         WHERE s.organization_id = public.current_org_id()
           AND s.listing_code = _code
           AND s.broker_id IS NOT NULL
           AND (s.broker_id = (SELECT auth.uid())
                OR (public.has_any_role((SELECT auth.uid()), ARRAY['gestor','team_leader']::public.app_role[])
                    AND public.is_lead_of((SELECT auth.uid()), s.broker_id))))
$$;
REVOKE ALL ON FUNCTION public.owner_feedback_can_edit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_feedback_can_edit(text) TO authenticated, service_role;

ALTER TABLE public.owner_feedback_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_feedback_action_done ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_feedback_actions, public.owner_feedback_action_done FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_feedback_actions, public.owner_feedback_action_done TO authenticated;

-- Isolamento por imobiliária + módulo ligado (restritivas).
DROP POLICY IF EXISTS org_isolation ON public.owner_feedback_actions;
CREATE POLICY org_isolation ON public.owner_feedback_actions AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
DROP POLICY IF EXISTS org_isolation ON public.owner_feedback_action_done;
CREATE POLICY org_isolation ON public.owner_feedback_action_done AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id = (SELECT public.current_org_id()))
  WITH CHECK (organization_id = (SELECT public.current_org_id()));
DROP POLICY IF EXISTS zz_mt_modulo_feedback ON public.owner_feedback_actions;
CREATE POLICY zz_mt_modulo_feedback ON public.owner_feedback_actions AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.owner_feedback_enabled())) WITH CHECK ((SELECT public.owner_feedback_enabled()));
DROP POLICY IF EXISTS zz_mt_modulo_feedback ON public.owner_feedback_action_done;
CREATE POLICY zz_mt_modulo_feedback ON public.owner_feedback_action_done AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.owner_feedback_enabled())) WITH CHECK ((SELECT public.owner_feedback_enabled()));

-- Catálogo: todos leem; só admin altera.
DROP POLICY IF EXISTS owner_fb_actions_read ON public.owner_feedback_actions;
CREATE POLICY owner_fb_actions_read ON public.owner_feedback_actions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS owner_fb_actions_admin ON public.owner_feedback_actions;
CREATE POLICY owner_fb_actions_admin ON public.owner_feedback_actions FOR ALL TO authenticated
  USING (public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::public.app_role[]))
  WITH CHECK (public.has_any_role((SELECT auth.uid()), ARRAY['admin','super_admin']::public.app_role[]));

-- Marcações: lê e marca quem pode editar o imóvel; done_by é sempre quem marcou.
DROP POLICY IF EXISTS owner_fb_done_read ON public.owner_feedback_action_done;
CREATE POLICY owner_fb_done_read ON public.owner_feedback_action_done FOR SELECT TO authenticated
  USING ((SELECT public.owner_feedback_can_edit(listing_code)));
DROP POLICY IF EXISTS owner_fb_done_insert ON public.owner_feedback_action_done;
CREATE POLICY owner_fb_done_insert ON public.owner_feedback_action_done FOR INSERT TO authenticated
  WITH CHECK (done_by = (SELECT auth.uid()) AND (SELECT public.owner_feedback_can_edit(listing_code))
    AND EXISTS (SELECT 1 FROM public.owner_feedback_actions a
                 WHERE a.id = action_id AND a.organization_id = owner_feedback_action_done.organization_id));
DROP POLICY IF EXISTS owner_fb_done_delete ON public.owner_feedback_action_done;
CREATE POLICY owner_fb_done_delete ON public.owner_feedback_action_done FOR DELETE TO authenticated
  USING ((SELECT public.owner_feedback_can_edit(listing_code)));

-- Lista inicial (modelo de Feedback RE/MAX usado hoje), para todas as imobiliárias.
WITH seed(list, category, label, weight, sort) AS (VALUES
  ('marketing','Foto e vídeo / produção visual','Aplicar tratamento profissional nas imagens','vital',101),
  ('marketing','Foto e vídeo / produção visual','Produzir fotos profissionais','vital',102),
  ('marketing','Foto e vídeo / produção visual','Produzir Reels de lançamento do imóvel','vital',103),
  ('marketing','Foto e vídeo / produção visual','Produzir tour virtual 360º','vital',104),
  ('marketing','Foto e vídeo / produção visual','Produzir vídeos curtos','vital',105),
  ('marketing','Foto e vídeo / produção visual','Produzir vídeos profissionais','vital',106),
  ('marketing','Conteúdo e materiais','Criar anúncio do imóvel para WhatsApp','vital',201),
  ('marketing','Conteúdo e materiais','Desenvolver descrição estratégica do imóvel','vital',202),
  ('marketing','Conteúdo e materiais','Desenvolver texto descritivo otimizado','vital',203),
  ('marketing','Conteúdo e materiais','Produzir ficha técnica do imóvel','vital',204),
  ('marketing','Portais, CRM e distribuição','Publicar no site RE/MAX Brasil','vital',301),
  ('marketing','Portais, CRM e distribuição','Publicar no site RE/MAX Global','vital',302),
  ('marketing','Portais, CRM e distribuição','Publicar Portal: Canal Pro (ZAP, Viva Real e OLX)','vital',303),
  ('marketing','Portais, CRM e distribuição','Publicar Portal: Casa Mineira','importante',304),
  ('marketing','Portais, CRM e distribuição','Publicar Portal: Chaves na Mão','importante',305),
  ('marketing','Portais, CRM e distribuição','Publicar Portal: Imóvel Web','importante',306),
  ('marketing','Portais, CRM e distribuição','Publicar tour virtual no site','importante',307),
  ('marketing','Portais, CRM e distribuição','Divulgar no site próprio do corretor','importante',308),
  ('marketing','Otimização de anúncios','Aplicar destaque e super destaque nos portais','vital',401),
  ('marketing','Otimização de anúncios','Atualizar imagens conforme estratégia','importante',402),
  ('marketing','Otimização de anúncios','Editar anúncios existentes','vital',403),
  ('marketing','Otimização de anúncios','Renovar anúncios','vital',404),
  ('marketing','Otimização de anúncios','Reorganizar fotos principais','importante',405),
  ('marketing','Otimização de anúncios','Trocar capas de anúncios','importante',406),
  ('marketing','Redes sociais','Produzir para Instagram (Stories, feed e Reels)','vital',501),
  ('marketing','Redes sociais','Publicar no Facebook','importante',502),
  ('marketing','Redes sociais','Publicar no LinkedIn','importante',503),
  ('marketing','Divulgação offline e presença local','Instalar placa RE/MAX','vital',601),
  ('marketing','Parcerias e distribuição ativa','Enviar semanalmente o imóvel em grupos de WhatsApp','vital',701),
  ('marketing','Parcerias e distribuição ativa','Compartilhar com a rede RE/MAX','vital',702),
  ('marketing','Parcerias e distribuição ativa','Desenvolver parcerias com influenciadores','complementar',703),
  ('marketing','Reuniões estratégicas e ajustes','Avaliar e apresentar todas as propostas ao proprietário','vital',801),
  ('marketing','Reuniões estratégicas e ajustes','Avaliar resultado das ações — redirecionar para o que funciona','vital',802),
  ('checklist','Etapa 1 · V1 — 1ª visita ao proprietário','Ouvir mais e falar menos (perguntas abertas e fechadas)',NULL,101),
  ('checklist','Etapa 1 · V1 — 1ª visita ao proprietário','Entregar dossiê pessoal',NULL,102),
  ('checklist','Etapa 1 · V1 — 1ª visita ao proprietário','Gerar conexão e apresentação breve sobre a RE/MAX',NULL,103),
  ('checklist','Etapa 1 · V1 — 1ª visita ao proprietário','Cadastro inicial do imóvel (físico ou digital)',NULL,104),
  ('checklist','Etapa 1 · V1 — 1ª visita ao proprietário','Entender necessidades do proprietário (o porquê? Quanto tempo está à venda?)',NULL,105),
  ('checklist','Etapa 1 · V1 — 1ª visita ao proprietário','Alinhar expectativas da venda (valor, condição e tempo de venda)',NULL,106),
  ('checklist','Etapa 1 · V1 — 1ª visita ao proprietário','Reconhecimento detalhado e inspeção técnica do imóvel',NULL,107),
  ('checklist','Etapa 1 · V1 — 1ª visita ao proprietário','Fazer fotos iniciais do imóvel',NULL,108),
  ('checklist','Etapa 1 · V1 — 1ª visita ao proprietário','Foto do IPTU e matrícula',NULL,109),
  ('checklist','Etapa 1 · V1 — 1ª visita ao proprietário','Sair da V1 com a V2 agendada (máximo dois dias)',NULL,110),
  ('checklist','Etapa 2 · Preparação da V2','Conferir e conciliar dados de IPTU com matrícula',NULL,201),
  ('checklist','Etapa 2 · Preparação da V2','Elaborar Estudo de Mercado',NULL,202),
  ('checklist','Etapa 2 · Preparação da V2','Elaborar Plano de Marketing',NULL,203),
  ('checklist','Etapa 2 · Preparação da V2','Preparar apresentação',NULL,204),
  ('checklist','Etapa 3 · V2 — Apresentação do estudo (ACM)','Apresentar dossiê RE/MAX',NULL,301),
  ('checklist','Etapa 3 · V2 — Apresentação do estudo (ACM)','Identificar e isolar objeções',NULL,302),
  ('checklist','Etapa 3 · V2 — Apresentação do estudo (ACM)','Apresentar condições e vantagens do modelo RE/MAX',NULL,303),
  ('checklist','Etapa 3 · V2 — Apresentação do estudo (ACM)','Apresentar ACM',NULL,304),
  ('checklist','Etapa 3 · V2 — Apresentação do estudo (ACM)','Definir preço junto ao proprietário (não pegar fora de preço)',NULL,305),
  ('checklist','Etapa 3 · V2 — Apresentação do estudo (ACM)','Solicitar documentos pessoais para o contrato (RG, CPF, certidão de estado civil, e-mail e telefone)',NULL,306),
  ('checklist','Etapa 3 · V2 — Apresentação do estudo (ACM)','Assinar contrato de gestão RE/MAX (entregar cópia)',NULL,307),
  ('checklist','Etapa 3 · V2 — Apresentação do estudo (ACM)','Assinar plano de marketing RE/MAX (entregar cópia)',NULL,308)
)
INSERT INTO public.owner_feedback_actions (organization_id, list, category, label, weight, sort)
SELECT o.id, s.list, s.category, s.label, s.weight, s.sort FROM public.organizations o CROSS JOIN seed s
ON CONFLICT (organization_id, list, category, label) DO NOTHING;
