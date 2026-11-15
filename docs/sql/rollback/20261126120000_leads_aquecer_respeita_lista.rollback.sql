-- Rollback de 20261126120000_leads_aquecer_respeita_lista (t_1697c3d4): devolve lead_aquecer_preparar igual à
-- versão de 20261125120000_leads_aquecer e apaga a função auxiliar. Nenhum dado é alterado.
-- Atenção: sem esta trava o aquecimento volta a escolher qualquer lead parado. Antes, desligue o aquecimento:
-- UPDATE public.lead_config SET aquecer_ativo = false;
BEGIN;

CREATE OR REPLACE FUNCTION public.lead_aquecer_preparar(_chip text DEFAULT NULL, _agora timestamptz DEFAULT now())
RETURNS TABLE (envio_id uuid, lead_id uuid, telefone text, texto text, modo_real boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
DECLARE _c public.lead_config; _real boolean; _a public.lead_aquecer; _l public.leads; _cv public.lead_conversas;
  _txt text; _org text; _ia text; _frase text; _env uuid; _n integer := 0;
BEGIN
  IF _chip IS NOT NULL AND _chip !~ '^[0-9]{10,11}$' THEN RAISE EXCEPTION 'Chip invalido' USING ERRCODE = '22023'; END IF;
  FOR _c IN
    SELECT c.* FROM public.lead_config c
      JOIN public.organizations o ON o.id = c.organization_id AND o.status = 'ativa'
      JOIN public.organization_modules m ON m.organization_id = c.organization_id AND m.module = 'leads' AND m.enabled
     WHERE c.aquecer_ativo AND c.aquecer_pausado_em IS NULL AND c.ia_ativa
       AND public.lead_aquecer_horario(c.ia_domingo, _agora)
       AND (c.aquecer_proximo_em IS NULL OR c.aquecer_proximo_em <= now())
     ORDER BY c.aquecer_proximo_em NULLS FIRST
     LIMIT 10
     FOR UPDATE OF c SKIP LOCKED
  LOOP
    EXIT WHEN _n >= 5;
    _real := _chip IS NOT NULL AND _c.aquecer_chip_numero = _chip;
    -- Limpeza da imobiliária: quem pediu SAIR fecha como optout; lembrete sem resposta vira frio; o 1º envio
    -- esquecido (lead ganho/perdido/assumido) fecha como frio depois de 2 janelas.
    UPDATE public.lead_aquecer a SET estado = 'optout', finalizado_em = now(), updated_at = now()
      FROM public.leads l
     WHERE a.organization_id = _c.organization_id AND a.estado IN ('enviado', 'lembrete') AND l.id = a.lead_id
       AND EXISTS (SELECT 1 FROM public.lead_ia_optouts op WHERE op.organization_id = a.organization_id
                    AND op.contato = ANY (public.lead_ia_contatos(l.telefone, l.email)));
    WITH f AS (
      UPDATE public.lead_aquecer a SET estado = 'frio', finalizado_em = now(), updated_at = now()
       WHERE a.organization_id = _c.organization_id
         AND ((a.estado = 'lembrete' AND a.lembrete_em <= now() - make_interval(days => _c.aquecer_lembrete_dias))
           OR (a.estado = 'enviado' AND a.enviado_em <= now() - make_interval(days => 2 * _c.aquecer_lembrete_dias)))
      RETURNING a.organization_id, a.lead_id, a.modo_real)
    INSERT INTO public.lead_eventos (organization_id, lead_id, tipo, para, nota)
    SELECT f.organization_id, f.lead_id, 'ia', 'aquecer_frio',
           'Aquecimento: o cliente não respondeu à mensagem nem ao lembrete. Marcado como frio.'
           || CASE WHEN f.modo_real THEN '' ELSE ' (modo teste)' END
      FROM f;
    -- Intervalo do chip real: nenhum envio real neste chip há aquecer_intervalo_min_s (vale entre imobiliárias).
    CONTINUE WHEN _real AND EXISTS (SELECT 1 FROM public.lead_aquecer_envios e WHERE e.modo_real AND e.chip_numero = _chip
                                     AND e.created_at > now() - make_interval(secs => _c.aquecer_intervalo_min_s));
    CONTINUE WHEN public.lead_aquecer_enviados_hoje(_c.organization_id, CASE WHEN _real THEN _chip END, _agora)
                  >= public.lead_aquecer_limite_hoje(_c, _agora);
    _org := public.lead_ia_org_nome(_c.organization_id);
    _ia := coalesce(nullif(btrim(_c.ia_nome), ''), 'Nicole');
    _a := NULL; _txt := NULL;
    -- a) Lembrete (1 só): enviado há aquecer_lembrete_dias, sem resposta e sem a equipe ter mexido no lead desde então.
    SELECT a.* INTO _a FROM public.lead_aquecer a JOIN public.leads l ON l.id = a.lead_id
     WHERE a.organization_id = _c.organization_id AND a.estado = 'enviado' AND a.respondeu_em IS NULL
       AND a.modo_real = _real
       AND a.enviado_em <= now() - make_interval(days => _c.aquecer_lembrete_dias)
       AND NOT l.simulado AND l.etapa NOT IN ('ganho', 'perdido') AND l.sale_id IS NULL
       AND (l.proximo_contato_em IS NULL OR l.proximo_contato_em <= now())
       AND NOT EXISTS (SELECT 1 FROM public.lead_ia_optouts op WHERE op.organization_id = l.organization_id
                        AND op.contato = ANY (public.lead_ia_contatos(l.telefone, l.email)))
       AND NOT EXISTS (SELECT 1 FROM public.lead_eventos e WHERE e.lead_id = l.id AND e.autor_id IS NOT NULL
                        AND e.created_at > a.enviado_em)
     ORDER BY a.enviado_em
     LIMIT 1
     FOR UPDATE OF a SKIP LOCKED;
    IF _a.id IS NOT NULL THEN
      SELECT * INTO _l FROM public.leads WHERE id = _a.lead_id;
      _txt := public.lead_aquecer_texto('lembrete', public.lead_aquecer_nome(_l.nome), NULL, _ia, _org, _l.id::text || ':l');
      INSERT INTO public.lead_aquecer_envios (organization_id, aquecer_id, tipo, texto, modo_real, chip_numero)
      VALUES (_c.organization_id, _a.id, 'lembrete', _txt, _real, CASE WHEN _real THEN _chip END) RETURNING id INTO _env;
      UPDATE public.lead_aquecer SET estado = 'lembrete', lembrete_em = now(), updated_at = now() WHERE id = _a.id;
    ELSE
      -- b) Lead novo: parado há aquecer_dias ou mais. Pré-filtro barato antes da regra completa; o mais "morno" primeiro.
      SELECT l.* INTO _l FROM public.leads l
       WHERE l.organization_id = _c.organization_id AND NOT l.simulado AND l.etapa NOT IN ('ganho', 'perdido')
         AND l.funil = 'venda' AND l.telefone IS NOT NULL
         AND l.created_at <= now() - make_interval(days => _c.aquecer_dias)
         AND coalesce(l.ultima_interacao_em, l.created_at) <= now() - make_interval(days => _c.aquecer_dias)
         AND public.lead_aquecer_elegivel(l, _c.aquecer_dias)
         -- Modo teste nunca mexe em conversa ativa da Nicole (só leads sem conversa ativa entram na simulação).
         AND (_real OR NOT EXISTS (SELECT 1 FROM public.lead_conversas cv0 WHERE cv0.lead_id = l.id AND cv0.estado = 'ativa'))
       ORDER BY public.lead_aquecer_ultima_interacao(l) DESC, l.id
       LIMIT 1
       FOR UPDATE OF l SKIP LOCKED;
      CONTINUE WHEN _l.id IS NULL;
      _frase := public.lead_aquecer_frase(_l);
      _txt := public.lead_aquecer_texto('primeira', public.lead_aquecer_nome(_l.nome), _frase, _ia, _org, _l.id::text);
      IF NOT public.lead_aquecer_texto_ok(_txt, _org) THEN
        _txt := public.lead_aquecer_texto('primeira', public.lead_aquecer_nome(_l.nome), NULL, _ia, _org, _l.id::text);
      END IF;
      CONTINUE WHEN NOT public.lead_aquecer_texto_ok(_txt, _org);
      -- Conversa do lead (a mesma da Nicole). Sem conversa: abre uma PARADA (a Nicole só fala depois do "sim").
      -- Conversa ativa antiga: pausa em silêncio para os lembretes de 24/72 h e o de 15 min não dispararem.
      SELECT * INTO _cv FROM public.lead_conversas WHERE lead_id = _l.id FOR UPDATE;
      IF _cv.id IS NULL THEN
        INSERT INTO public.lead_conversas (organization_id, lead_id, canal, estado, passo, encerrada_em, resumo)
        VALUES (_l.organization_id, _l.id, CASE WHEN _real THEN 'ziontalk' ELSE 'teste' END, 'parada', 'fim', now(),
                'Conversa aberta pelo aquecimento de lead parado.')
        RETURNING * INTO _cv;
      ELSIF _cv.estado = 'ativa' THEN
        UPDATE public.lead_conversas SET estado = 'parada', passo = 'fim', encerrada_em = now(), updated_at = now(),
               resumo = left(coalesce(resumo || ' ', '') || 'IA pausada: aquecimento de lead parado.', 1000)
         WHERE id = _cv.id;
      END IF;
      INSERT INTO public.lead_aquecer (organization_id, lead_id, conversa_id, estado, modo_real, chip_numero)
      VALUES (_l.organization_id, _l.id, _cv.id, 'enviando', _real, CASE WHEN _real THEN _chip END) RETURNING * INTO _a;
      INSERT INTO public.lead_aquecer_envios (organization_id, aquecer_id, tipo, texto, modo_real, chip_numero)
      VALUES (_c.organization_id, _a.id, 'primeira', _txt, _real, CASE WHEN _real THEN _chip END) RETURNING id INTO _env;
    END IF;
    UPDATE public.lead_config
       SET aquecer_proximo_em = now() + make_interval(secs => _c.aquecer_intervalo_min_s
                                 + floor(random() * (_c.aquecer_intervalo_max_s - _c.aquecer_intervalo_min_s + 1))),
           aquecer_rampa_desde = coalesce(aquecer_rampa_desde, (_agora AT TIME ZONE 'America/Sao_Paulo')::date)
     WHERE organization_id = _c.organization_id;
    envio_id := _env; lead_id := _l.id; telefone := _l.telefone; texto := _txt; modo_real := _real;
    _n := _n + 1;
    RETURN NEXT;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.lead_aquecer_na_lista(public.lead_config, text);

COMMIT;
