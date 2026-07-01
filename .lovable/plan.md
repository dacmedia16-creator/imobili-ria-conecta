# Plano: Detalhe da venda em Etapas (wizard)

Vou substituir as abas atuais da tela `/vendas/:id` por um fluxo em etapas com barra de progresso, botões Voltar/Próximo e navegação clicável nos passos já concluídos. Nada do backend muda — só a apresentação.

## Etapas propostas (na ordem do fluxo real)

1. **Resumo** — dados do imóvel, partes, valores (leitura + edição rápida)
2. **Documentos** — upload/checklist com barra de progresso
3. **Status & Histórico** — botões de ação por perfil + linha do tempo
4. **Ocorrência** — sub-etapas internas: Dados → Financiamento/Pagamento → Comissões (6 papéis) → Parcerias → Revisão/Finalizar
5. **Comentários & Logs** — discussão e activity_logs

Corretor vê 1→2→3; Gestor/Jurídico/Financeiro veem todas conforme permissão atual (sem mudar RLS).

## Comportamento do wizard

- Barra de progresso no topo com número/nome de cada etapa e check quando completa
- Botões **Voltar** / **Próximo** fixos no rodapé; **Salvar** salva na etapa atual sem avançar
- Clicar num passo anterior volta direto; passos futuros bloqueados até validação da etapa atual
- Validações reaproveitam `validarProntaParaRevisao` (Etapa Documentos exibe pendências em PT)
- Estado da etapa atual guardado em query string `?step=documentos` para permitir link direto e refresh sem perder posição
- Mobile: etapas colapsam em dropdown "Etapa X de 5"

## Ocorrência como sub-wizard

Dentro da Etapa 4, mesmo padrão: mini-progresso interno com 5 sub-passos. Mantém os cálculos automáticos de comissão e validação de soma já implementados.

## Arquivos afetados (apresentação apenas)

- `src/routes/_authenticated/vendas.$id.tsx` — refatorar layout: substituir `<Tabs>` por componente `<Wizard>`; extrair cada aba atual em componente de etapa (`StepResumo`, `StepDocumentos`, `StepStatus`, `StepOcorrencia`, `StepComentarios`)
- `src/components/Wizard.tsx` (novo) — progresso + nav + contexto de etapa atual
- Nenhuma mudança em: banco, RLS, server functions, `status.ts`, rotas, tipos

## Fora do escopo

- Nova venda (`/vendas/nova`) e outras telas — você marcou "Todas as três" mas sugiro fazer só a de detalhe primeiro para validar o padrão. Se aprovar o resultado, replico em Nova venda no próximo ciclo. Me diga se prefere já fazer as três de uma vez.
