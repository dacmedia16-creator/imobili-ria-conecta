-- Gestor/team_leader marca "contrato assinado" e a venda avança automaticamente pra
-- ocorrencia_pendente (mesma ação, ver changeStatus em vendas.$id.tsx) — mas não existia caminho de
-- volta se marcado por engano (arquivo errado, clique sem querer): a única transição permitida a
-- partir de ocorrencia_pendente era pra frente (financeiro). Libera o gestor/team_leader devolver
-- pra aguardando_assinatura, reabrindo os botões de subir/substituir e marcar o contrato assinado de
-- novo. Sem ocorrência criada ainda nesse ponto do fluxo (isso só acontece manualmente, passo
-- separado), então não há nada pra desfazer/limpar além do próprio status.
CREATE OR REPLACE FUNCTION public.validate_sale_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  actor uuid := auth.uid();
  is_owner boolean := (OLD.corretor_id = auth.uid());
  allowed boolean := false;
  from_status text := OLD.status::text;
  to_status text := NEW.status::text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF public.has_any_role(actor, ARRAY['admin','super_admin']::app_role[]) THEN
    RETURN NEW;
  END IF;

  IF is_owner AND (from_status, to_status) IN (
    ('rascunho', 'enviada_revisao'),
    ('devolvida_ajuste', 'enviada_revisao'),
    ('contrato_conferencia_corretor', 'contrato_ok_corretor'),
    ('contrato_conferencia_corretor', 'contrato_conferencia_gestor')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND is_owner AND public.has_any_role(actor, ARRAY['gestor','team_leader']::app_role[]) AND (from_status, to_status) IN (
    ('rascunho', 'aprovada_gestor'),
    ('devolvida_ajuste', 'aprovada_gestor')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND is_owner AND public.has_role(actor, 'lancamento'::app_role) AND (from_status, to_status) IN (
    ('rascunho', 'ocorrencia_analise_financeiro'),
    ('devolvida_ajuste', 'ocorrencia_analise_financeiro')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND public.has_any_role(actor, ARRAY['gestor','team_leader']::app_role[]) AND (from_status, to_status) IN (
    ('enviada_revisao', 'aprovada_gestor'),
    ('enviada_revisao', 'devolvida_ajuste'),
    ('contrato_conferencia_gestor', 'contrato_conferencia_corretor'),
    ('contrato_conferencia_gestor', 'aguardando_assinatura'),
    ('contrato_conferencia_gestor', 'em_elaboracao_contrato'),
    ('contrato_ok_corretor', 'aguardando_assinatura'),
    ('contrato_ok_corretor', 'contrato_conferencia_corretor'),
    ('aguardando_assinatura', 'contrato_assinado'),
    ('contrato_assinado', 'ocorrencia_pendente'),
    ('contrato_assinado', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'ocorrencia_analise_financeiro'),
    ('ocorrencia_pendente', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'aguardando_assinatura'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_analise_financeiro'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_concluida')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND public.has_role(actor, 'juridico') AND (from_status, to_status) IN (
    ('aprovada_gestor', 'em_elaboracao_contrato'),
    ('aprovada_gestor', 'enviada_revisao'),
    ('aprovada_gestor', 'devolvida_ajuste'),
    ('em_elaboracao_contrato', 'contrato_conferencia_gestor'),
    ('em_elaboracao_contrato', 'enviada_revisao'),
    ('em_elaboracao_contrato', 'devolvida_ajuste')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND public.has_role(actor, 'financeiro') AND (from_status, to_status) IN (
    ('ocorrencia_analise_financeiro', 'ocorrencia_devolvida_gestor'),
    ('ocorrencia_analise_financeiro', 'ocorrencia_concluida'),
    ('contrato_assinado', 'ocorrencia_concluida'),
    ('ocorrencia_pendente', 'ocorrencia_concluida'),
    ('ocorrencia_devolvida_gestor', 'ocorrencia_concluida'),
    ('ocorrencia_concluida', 'ocorrencia_pendente')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed AND public.has_role(actor, 'financeiro') AND NEW.modalidade = 'lancamento' AND (from_status, to_status) IN (
    ('ocorrencia_analise_financeiro', 'devolvida_ajuste'),
    ('ocorrencia_concluida', 'ocorrencia_analise_financeiro')
  ) THEN
    allowed := true;
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Transição de status não permitida para este usuário: % -> %', from_status, to_status
      USING ERRCODE = '42501';
  END IF;

  IF from_status = 'aguardando_assinatura' AND to_status = 'contrato_assinado' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.sale_documents d
      WHERE d.sale_id = OLD.id AND d.tipo = 'contrato_assinado'
    ) THEN
      RAISE EXCEPTION 'Anexe o contrato assinado (aba Documentos) antes de marcar como assinado.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
