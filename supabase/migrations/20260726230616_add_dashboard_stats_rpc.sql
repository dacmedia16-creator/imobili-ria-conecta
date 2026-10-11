-- Recuperado de supabase_migrations.schema_migrations (versão 20260726230616) em t_412dfcf2.
-- Já aplicada em produção; texto idêntico ao registrado no remoto (1 statement(s)).

-- Dashboard hoje baixa TODAS as vendas e ocorrências visíveis pro usuário (sem limite) só pra
-- contar/somar no client — não escala conforme a base cresce (auditoria #6). Move a contagem e
-- soma pro banco: SECURITY INVOKER (não DEFINER) pra continuar respeitando o RLS de cada papel
-- exatamente como as queries diretas de hoje (corretor só vê as próprias, gestor só o time, etc.).
CREATE OR REPLACE FUNCTION public.dashboard_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'funil', (
      SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) FROM (
        SELECT status::text AS status, count(*) AS cnt FROM sales GROUP BY status
      ) t
    ),
    'minhas_vendas', (SELECT count(*) FROM sales WHERE corretor_id = auth.uid()),
    'minhas_pendencias', (SELECT count(*) FROM sales WHERE corretor_id = auth.uid() AND status::text IN ('rascunho','devolvida_ajuste')),
    'meus_contratos_conferir', (SELECT count(*) FROM sales WHERE corretor_id = auth.uid() AND status::text = 'contrato_conferencia_corretor'),
    'meus_assinados', (SELECT count(*) FROM sales WHERE corretor_id = auth.uid() AND status::text IN ('contrato_assinado','ocorrencia_pendente','ocorrencia_analise_financeiro','ocorrencia_devolvida_gestor','ocorrencia_concluida')),
    'minha_comissao_prevista', COALESCE((SELECT sum(valor_total_comissao) FROM sales WHERE corretor_id = auth.uid() AND status::text NOT IN ('ocorrencia_concluida','arquivada','cancelada')), 0),
    'gestor_aguardando_revisao', (SELECT count(*) FROM sales WHERE status::text = 'enviada_revisao'),
    'gestor_contratos_conferir', (SELECT count(*) FROM sales WHERE status::text IN ('contrato_conferencia_gestor','contrato_ok_corretor')),
    'gestor_ocorrencias_enviar', (SELECT count(*) FROM sales WHERE status::text IN ('ocorrencia_pendente','ocorrencia_devolvida_gestor')),
    'gestor_devolvidas', (SELECT count(*) FROM sales WHERE status::text IN ('devolvida_ajuste','ocorrencia_devolvida_gestor')),
    'juridico_aprovadas_gestor', (SELECT count(*) FROM sales WHERE status::text = 'aprovada_gestor'),
    'juridico_em_elaboracao', (SELECT count(*) FROM sales WHERE status::text = 'em_elaboracao_contrato'),
    'juridico_aguardando_assinatura', (SELECT count(*) FROM sales WHERE status::text = 'aguardando_assinatura'),
    'juridico_assinados', (SELECT count(*) FROM sales WHERE status::text = 'contrato_assinado'),
    'fin_ocorrencias_analise', (SELECT count(*) FROM sales WHERE status::text = 'ocorrencia_analise_financeiro'),
    'fin_devolvidas', (SELECT count(*) FROM sales WHERE status::text = 'ocorrencia_devolvida_gestor'),
    'occ_pendentes_total', (SELECT count(*) FROM occurrences WHERE status <> 'concluida'),
    'occ_concluidas_total', (SELECT count(*) FROM occurrences WHERE status = 'concluida'),
    'comissao_prevista_total', COALESCE((SELECT sum(valor_comissao) FROM occurrences WHERE status <> 'concluida'), 0),
    'comissao_concluida_total', COALESCE((SELECT sum(valor_comissao) FROM occurrences WHERE status = 'concluida'), 0),
    'comissao_por_corretor', (
      SELECT COALESCE(jsonb_object_agg(corretor_id, total), '{}'::jsonb) FROM (
        SELECT s.corretor_id::text AS corretor_id, sum(o.valor_comissao) AS total
        FROM occurrences o JOIN sales s ON s.id = o.sale_id
        GROUP BY s.corretor_id
      ) t
    )
  );
$$;
