-- Rollback de 20261027100000 (t_a7be646a): volta a lead_ia_passar de 20261026170000 (aviso de assunto
-- sensível só para admin e gestor). Não mexe em dados; avisos já enviados ficam no sino.
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
  -- pessoal): gestores e administradores da imobiliária também recebem.
  IF _l.responsavel_id IS NULL OR _motivo IN ('sensivel', 'nao_lead') THEN
    FOR _g IN SELECT DISTINCT r.user_id FROM public.user_roles r
               WHERE r.organization_id = _cv.organization_id AND r.role::text IN ('admin', 'gestor')
                 AND r.user_id IS DISTINCT FROM _l.responsavel_id LOOP
      PERFORM public.lead_notificar(_g.user_id, _cv.organization_id, _titulo, _msg);
    END LOOP;
  END IF;
END $$;

COMMIT;
