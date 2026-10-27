-- t_a7be646a (Denis 27/10/2026, tópico 6238): o aviso de ASSUNTO SENSÍVEL da atendente de IA também
-- vai para o Administrador principal (papel super_admin DA PRÓPRIA imobiliária).
-- Só muda o destino desse aviso: admin e gestor continuam; 'nao_lead' e 'lead sem responsável' não mudam.
-- Sem duplicar: SELECT DISTINCT por pessoa (quem tem 2 ou 3 desses papéis recebe 1 aviso) e o responsável
-- do lead (que já recebe o aviso dele) fica de fora. Isolamento: user_roles.organization_id = a da conversa.
-- Corpo igual ao de 20261026170000 (conferido igual à produção em 27/10), exceto o filtro de papéis.
-- Rollback: docs/sql/rollback/20261027100000_aviso_sensivel_admin_principal.rollback.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.lead_ia_passar(_conversa uuid, _motivo text, _resumo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _cv public.lead_conversas; _l public.leads; _g record; _titulo text; _msg text;
BEGIN
  SELECT * INTO _cv FROM public.lead_conversas WHERE id = _conversa FOR UPDATE;
  IF _cv.id IS NULL OR _cv.estado <> 'ativa' THEN RETURN; END IF;
  SELECT * INTO _l FROM public.leads WHERE id = _cv.lead_id;
  UPDATE public.lead_conversas
     SET estado = CASE _motivo WHEN 'optout' THEN 'optout' WHEN 'parada_manual' THEN 'parada' ELSE 'passada' END,
         motivo_fim = _motivo, resumo = left(public.lead_ia_mascarar(_resumo), 1000), passo = 'fim', encerrada_em = now(), updated_at = now()
   WHERE id = _cv.id;
  INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, autor_id)
  VALUES (_cv.organization_id, _cv.lead_id, 'ia', _motivo, auth.uid());
  _titulo := CASE _motivo
    WHEN 'qualificado' THEN 'IA qualificou um lead seu'
    WHEN 'visita' THEN 'Pré-agendamento de visita: confirme com o cliente'
    WHEN 'pediu_pessoa' THEN 'Cliente pediu para falar com o corretor'
    WHEN 'sensivel' THEN 'Atenção: assunto sensível em um lead'
    WHEN 'nao_lead' THEN 'Contato que não é comprador nem locatário'
    WHEN 'sem_interesse' THEN 'Lead disse que não tem interesse'
    WHEN 'optout' THEN 'Lead pediu para não receber mensagens'
    WHEN 'limite' THEN 'Conversa da IA passou para você'
    ELSE 'IA parada neste lead' END;
  _msg := 'Lead "' || _l.nome || '": ' || left(public.lead_ia_mascarar(_resumo), 300) || ' Veja a conversa em Meus leads.';
  IF _l.responsavel_id IS NOT NULL THEN
    PERFORM public.lead_notificar(_l.responsavel_id, _cv.organization_id, _titulo,
      CASE WHEN _l.aceito_em IS NOT NULL THEN _msg
           ELSE 'Lead "' || _l.nome || '": aceite o lead em Meus leads para ver o resumo e a conversa.' END);
  END IF;
  -- Sem responsável, assunto sensível ou contato que não é lead (proprietário, parceiro, fornecedor,
  -- pessoal): gestores e administradores da imobiliária também recebem. No assunto sensível, o
  -- Administrador principal (super_admin da própria imobiliária) também. DISTINCT: 1 aviso por pessoa.
  IF _l.responsavel_id IS NULL OR _motivo IN ('sensivel', 'nao_lead') THEN
    FOR _g IN SELECT DISTINCT r.user_id FROM public.user_roles r
               WHERE r.organization_id = _cv.organization_id
                 AND (r.role::text IN ('admin', 'gestor')
                      OR (_motivo = 'sensivel' AND r.role::text = 'super_admin'))
                 AND r.user_id IS DISTINCT FROM _l.responsavel_id LOOP
      PERFORM public.lead_notificar(_g.user_id, _cv.organization_id, _titulo, _msg);
    END LOOP;
  END IF;
END $$;

COMMIT;
