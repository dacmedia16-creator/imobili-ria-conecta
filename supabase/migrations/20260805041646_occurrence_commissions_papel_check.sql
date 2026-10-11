-- occurrence_commissions.papel aceitava qualquer texto, sem trava no banco — mesmo o dropdown do
-- formulário já restringindo a essas 7 opções (COMISSAO_PAPEIS em src/lib/status.ts). Um script,
-- chamada direta na API ou bug de código poderia gravar um valor fora da lista sem ninguém notar,
-- e quebrar silenciosamente qualquer relatório agrupado por papel. Tabela está vazia hoje, então
-- não há dado existente pra migrar.
ALTER TABLE public.occurrence_commissions ADD CONSTRAINT occurrence_commissions_papel_check
  CHECK (papel = ANY (ARRAY['corretor_captador','indicador_captador','corretor_vendedor','indicador_vendedor','gestor','team_leader','outro']::text[]));
