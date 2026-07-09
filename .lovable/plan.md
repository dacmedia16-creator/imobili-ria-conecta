## Novo fluxo de extração

Hoje cada upload dispara a IA imediatamente — lento e caro. Vamos separar: **upload é só upload**; a IA só roda quando você clicar em **Aplicar dados aos campos**.

## Mudanças

### `src/routes/_authenticated/vendas.$id.tsx` — `DocumentsPanel`
- Remover a chamada automática de `extractDocument` logo após o upload. Uploads ficam com `extraction_status = 'idle'` (ou `null`) e badge neutro tipo "aguardando IA".
- Manter o botão de ✨ (Sparkles) por arquivo para reprocessar um só quando quiser.
- Trocar o botão **Aplicar dados aos campos** por um fluxo em 2 passos executado no mesmo clique:
  1. Buscar todos os docs da venda com `extraction_status` diferente de `done` (idle/failed/pending).
  2. Rodar `extractDocument` para cada um **em paralelo** (`Promise.allSettled`), atualizando o badge de cada card conforme termina.
  3. Quando tudo acabar, chamar `applySaleExtractions` uma vez e recarregar a venda.
- Enquanto roda, mostrar progresso ("Lendo 3 de 7 documentos…") e desabilitar o botão. Toast final: "IA leu X docs, preencheu Y campos".
- Se algum doc falhar, seguir com os que deram certo e listar os que falharam no toast.

### `src/lib/documents.functions.ts`
Sem mudança de contrato — `extractDocument` e `applySaleExtractions` continuam iguais. A orquestração fica no cliente.

## Fora do escopo
- Não mexer no schema do banco, RLS, wizard, status, ou nos campos que `applySaleExtractions` grava (isso fica pra outra rodada, se você quiser depois).
- Reprocessar a venda atual: depois do deploy, abra a venda e clique **Aplicar dados aos campos** — ela vai ler o que faltar e preencher.
