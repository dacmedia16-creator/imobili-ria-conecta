## Objetivo
Na etapa **Documentos**, separar os documentos pessoais por **Cliente Comprador** e **Cliente Vendedor** (documentos do imóvel e outros continuam como estão). A IA deve preencher automaticamente os campos da parte correta — o que vier do RG/CPF do comprador entra em `comprador_1`, o do vendedor em `vendedor_1`.

## Mudanças

### 1. Banco — nova coluna `parte` em `sale_documents`
- Migração adicionando `parte text` com valores permitidos: `comprador` | `vendedor` | `imovel` | `outros`.
- Default `outros` para não quebrar registros antigos.
- Sem mudança de RLS (já é por `sale_id`).

### 2. UI da etapa Documentos (`src/routes/_authenticated/vendas.$id.tsx`)
Reorganizar o painel em 4 blocos visuais:

```text
┌─ Cliente Comprador ─────────────┐
│ RG · CPF · Certidão · Endereço  │  (upload com tipo)
├─ Cliente Vendedor ──────────────┤
│ RG · CPF · Certidão · Endereço  │
├─ Documentos do Imóvel ──────────┤
│ Matrícula · IPTU · CND          │
├─ Outros ────────────────────────┤
│ Contrato · Contrato assinado    │
└─────────────────────────────────┘
```

- Ao clicar em "Enviar" num bloco pessoal, o upload já grava `parte = 'comprador'` (ou `vendedor`) automaticamente.
- Documentos do imóvel gravam `parte = 'imovel'`, contrato/outros gravam `parte = 'outros'`.
- Documentos antigos sem `parte` aparecem em "Outros" com badge para o usuário reclassificar (dropdown inline).

### 3. Extração da IA (`src/lib/documents.functions.ts`)
- `extractDocument`: passa `parte` no prompt para o modelo saber que aquele documento é do comprador/vendedor (evita ambiguidade quando o próprio documento não diz).
- `applySaleExtractions`: usa `sale_documents.parte` como fonte de verdade para decidir `comprador_1` vs `vendedor_1`. Remove o fallback "assume vendedor" que hoje pode misturar dados.
- Documentos do imóvel continuam alimentando `salePatch` (matrícula, IPTU, etc.).
- Regra mantida: só preenche campos vazios, nunca sobrescreve.

## Arquivos afetados
- `supabase/migrations/<nova>.sql` — adiciona `parte` em `sale_documents`.
- `src/routes/_authenticated/vendas.$id.tsx` — reescreve `DocumentsPanel` com 4 blocos e passa `parte` no insert.
- `src/lib/documents.functions.ts` — usa `parte` no prompt e no roteamento do `applySaleExtractions`.

## Fora de escopo
- Suportar múltiplos compradores/vendedores (`comprador_2`, `vendedor_2`). Fica pendente para uma próxima rodada — hoje o schema já tem `papel` livre, então dá para estender depois sem migração.
- Mudanças no fluxo de status ou nos outros passos do wizard.
