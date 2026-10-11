-- Papel "Lançamento": venda simplificada (sem documentos, sem jurídico, sem contrato) usada em
-- parcerias com construtoras. Reaproveita a tabela sales (e toda a infra de relatórios/metas que já
-- lê dela) via uma coluna modalidade, em vez de criar uma tabela paralela.

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS modalidade text NOT NULL DEFAULT 'padrao',
  ADD COLUMN IF NOT EXISTS premio_valor numeric(14,2),
  ADD COLUMN IF NOT EXISTS nota_fiscal_obrigatoria boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_assinatura date;

COMMENT ON COLUMN public.sales.modalidade IS 'padrao = fluxo completo (documentos/jurídico/contrato); lancamento = venda em parceria com construtora, formulário único direto pro financeiro.';
COMMENT ON COLUMN public.sales.premio_valor IS 'Prêmio/bônus da venda de lançamento, somado à comissão na previsão de recebimento — fora da conta percentual normal.';
COMMENT ON COLUMN public.sales.nota_fiscal_obrigatoria IS 'Staging do campo de mesmo nome em occurrences, preenchido no formulário de Lançamento antes da Ocorrência existir.';
COMMENT ON COLUMN public.sales.data_assinatura IS 'Staging do campo de mesmo nome em occurrences — só usado hoje pela venda de Lançamento (a venda padrão registra a assinatura só na etapa de contrato).';

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_modalidade_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_modalidade_check CHECK (modalidade IN ('padrao', 'lancamento'));

ALTER TABLE public.occurrences ADD COLUMN IF NOT EXISTS premio_valor numeric(14,2);
COMMENT ON COLUMN public.occurrences.premio_valor IS 'Copiado de sales.premio_valor na criação da Ocorrência (venda de Lançamento).';

-- "Coordenador (Lançamento)": papel de comissão específico do formulário de Lançamento (pessoa que
-- coordena a relação com a construtora), sem equivalente nos papéis normais de captador/vendedor.
ALTER TABLE public.sale_commission_extras DROP CONSTRAINT IF EXISTS sale_commission_extras_papel_check;
ALTER TABLE public.sale_commission_extras ADD CONSTRAINT sale_commission_extras_papel_check
  CHECK (papel IS NULL OR papel IN ('gestor','team_leader','outro','corretor_captador','corretor_vendedor','coordenador_lancamento'));

ALTER TABLE public.occurrence_commissions DROP CONSTRAINT IF EXISTS occurrence_commissions_papel_check;
ALTER TABLE public.occurrence_commissions ADD CONSTRAINT occurrence_commissions_papel_check
  CHECK (papel = ANY (ARRAY['corretor_captador','indicador_captador','corretor_vendedor','indicador_vendedor','gestor','team_leader','outro','lider_captador','lider_vendedor','coordenador_lancamento']::text[]));

-- Novo papel de usuário: quem preenche vendas de Lançamento. Só pode ser atribuído por admin/super
-- admin (mesmo nível de jurídico/financeiro) -- ver allowedRolesFor em admin.usuarios.tsx.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'lancamento';
