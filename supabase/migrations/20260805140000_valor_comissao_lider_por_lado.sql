-- Campo de comissão automático pro líder de cada lado (Equipe), no mesmo espírito de
-- valor_comissao_captador/vendedor: sempre visível quando há um líder selecionado naquele lado,
-- sem precisar de um botão "+" separado. Sai sempre da fatia daquele mesmo lado (líquido do
-- captador/vendedor desconta esse valor).
--
-- Não mexe no mecanismo antigo de "+Gestor"/"+Team Leader" (sale_commission_extras, papel='gestor'
-- ou 'team_leader') — existe pelo menos uma venda real em andamento (aguardando_assinatura) usando
-- aquele caminho com origem='imobiliaria' (corte saindo da fatia da imobiliária, não do captador/
-- vendedor), caso que estas duas colunas não cobrem. Os dois mecanismos coexistem.
ALTER TABLE public.sales ADD COLUMN valor_comissao_lider_captador numeric;
ALTER TABLE public.sales ADD COLUMN valor_comissao_lider_vendedor numeric;
