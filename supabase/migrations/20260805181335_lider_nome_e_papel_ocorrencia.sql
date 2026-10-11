-- Achado ao revisar: a comissão do líder por lado (valor_comissao_lider_captador/vendedor) nunca
-- chegava na Ocorrência. Diferente de corretor_captador/vendedor (que guardam id E nome em texto
-- na própria sales), lider_captador_id/lider_vendedor_id só guardavam o id — o nome só existia
-- resolvido em memória (liderOptions) dentro do componente da tela de venda, que não é visível pra
-- quem gera a ocorrência (componente separado) nem pras funções de sync que rodam com o objeto
-- `sale` cru. Sem nome nenhum lugar fixo, não dava pra criar a linha "Gestor/Team Leader do
-- captador/vendedor" na tabela de comissões da ocorrência.
--
-- Corrige guardando o nome também, no mesmo padrão de corretor_captador/vendedor.
ALTER TABLE public.sales ADD COLUMN lider_captador_nome text;
ALTER TABLE public.sales ADD COLUMN lider_vendedor_nome text;

UPDATE public.sales s
SET lider_captador_nome = p.nome
FROM public.profiles p
WHERE p.id = s.lider_captador_id AND s.lider_captador_nome IS NULL;

UPDATE public.sales s
SET lider_vendedor_nome = p.nome
FROM public.profiles p
WHERE p.id = s.lider_vendedor_id AND s.lider_vendedor_nome IS NULL;

-- Papéis fixos novos na tabela de comissões da ocorrência, pareados com os dois lados (mesmo
-- padrão de indicador_captador/vendedor).
ALTER TABLE public.occurrence_commissions DROP CONSTRAINT occurrence_commissions_papel_check;
ALTER TABLE public.occurrence_commissions ADD CONSTRAINT occurrence_commissions_papel_check
  CHECK (papel = ANY (ARRAY[
    'corretor_captador','indicador_captador','corretor_vendedor','indicador_vendedor',
    'gestor','team_leader','outro','lider_captador','lider_vendedor'
  ]));
