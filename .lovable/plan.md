## Objetivo
Permitir até **2 compradores** e **2 vendedores** na etapa de Documentos, com a IA roteando os dados extraídos para a pessoa certa (comprador_1, comprador_2, vendedor_1, vendedor_2).

## Mudanças

### 1. Banco (`sale_documents.parte`)
Ampliar o check constraint da coluna `parte` para aceitar:
- `comprador_1`, `comprador_2`
- `vendedor_1`, `vendedor_2`
- `imovel`, `outros`

Migração de dados: `comprador` → `comprador_1`, `vendedor` → `vendedor_1`.

### 2. Tipos e labels (`src/lib/status.ts`)
Atualizar `DocParte` e `docParteLabel` com as 4 variações de pessoa + imóvel + outros. Cores:
- Comprador 1: azul / Comprador 2: azul claro
- Vendedor 1: âmbar / Vendedor 2: âmbar claro
- Imóvel: esmeralda / Outros: cinza

### 3. UI — etapa Documentos (`src/routes/_authenticated/vendas.$id.tsx`)
Reorganizar em 6 blocos ao invés de 4:
- Cliente Comprador 1
- Cliente Comprador 2 *(colapsável, botão "+ Adicionar 2º comprador")*
- Cliente Vendedor 1
- Cliente Vendedor 2 *(colapsável, botão "+ Adicionar 2º vendedor")*
- Documentos do Imóvel
- Outros

Cada bloco grava a `parte` correta no upload.

### 4. IA — extração e aplicação (`src/lib/documents.functions.ts`)
- Prompt informa qual pessoa (ex.: "documento do 2º comprador").
- `applySaleExtractions` roteia:
  - `comprador_1` → campos `comprador_1_*`
  - `comprador_2` → campos `comprador_2_*`
  - `vendedor_1` → campos `vendedor_1_*`
  - `vendedor_2` → campos `vendedor_2_*`
- Mantém regra de só preencher campos vazios.

### 5. Etapa Partes
Garantir que os inputs de `comprador_2` e `vendedor_2` já existem no formulário; se estiverem ocultos, adicionar toggle "+ Adicionar 2ª pessoa" espelhando o comportamento da etapa Documentos.

## Detalhes técnicos
- Migração idempotente: `DROP CONSTRAINT ... IF EXISTS`, `UPDATE` dos valores antigos, `ADD CONSTRAINT` novo.
- Sem mudança em RLS (a policy já é por `sale_id`).
- Sem breaking change para vendas antigas: dados migrados automaticamente.

Confirma que posso implementar?
