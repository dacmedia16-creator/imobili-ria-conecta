## Documentos primeiro + auto-preenchimento via IA

Reordenar o fluxo de nova venda para começar pelos documentos, extrair dados com IA (Lovable AI Gateway) e pré-preencher as próximas etapas.

### Escolhas do usuário
- Documentos obrigatórios na etapa 0: **RG/CNH do comprador**, **Comprovante de estado civil**, **Matrícula do imóvel**, **Contrato social (PJ)**.
- Resultado: **auto-preencher** os campos e destacar visualmente que vieram do documento.
- Momento: **botão "Extrair dados"** ao final da etapa de documentos (1 chamada consolidada).
- Escopo: **apenas novas vendas**. Sem reextrair vendas antigas nesta iteração.

### Backend

1. **Migração**
   - Adicionar coluna `public.sale_documents.tipo text` (nullable) com CHECK em `('rg_cnh','estado_civil','matricula','contrato_social','outros')`.
   - Adicionar `public.sales.extraction_data jsonb` para guardar o payload bruto extraído (auditoria + badge "extraído de X").

2. **Server function `extractSaleData`** em `src/lib/sale-extraction.functions.ts`
   - Middleware: `requireSupabaseAuth`.
   - Input: `{ saleId: string }`.
   - Passos:
     a. Buscar `sale_documents` da venda (RLS já garante acesso).
     b. Para cada doc, gerar signed URL do bucket `sale-documents` (~1h).
     c. Montar uma chamada `generateText` + `Output.object` no Lovable AI Gateway usando `google/gemini-3-flash-preview` (aceita PDF e imagem via `image_url`/`file`). Um único prompt consolidado com todos os anexos, retornando JSON com:
        - `comprador`: nome, cpf, rg, data_nascimento, estado_civil, regime_bens, nome_conjuge, cpf_conjuge, endereco.
        - `imovel`: matricula, cartorio, endereco, area_util, proprietario_atual.
        - `empresa` (PJ): razao_social, cnpj, socios[].
        - `_confidence` por campo (0-1) + `_source` (qual `tipo` de doc).
     d. Salvar em `sales.extraction_data` e devolver ao cliente.
   - Erros do gateway (429/402) devolvidos com mensagem para o toast.

3. **Sem novas policies** — RLS de `sales`/`sale_documents` já cobre.

### Frontend

1. **`src/routes/_authenticated/vendas.nova.tsx`** vira wizard de 2 etapas:
   - **Etapa 1 — Documentos**: upload direto no bucket `sale-documents` com seletor de `tipo` (dropdown com os 4 tipos + "outros"). Mostra lista dos anexados, permite remover. Ao ter pelo menos 1 doc, habilita botão **"Extrair dados e continuar"**.
   - **Etapa 2 — Confirmação**: chama `extractSaleData`, mostra spinner ("Lendo documentos..."), então exibe cards com os campos extraídos agrupados (Comprador / Imóvel / Empresa), cada campo editável e com badge `📄 extraído de RG.pdf`. Botão "Criar venda" persiste em `sales`, `sale_parties`, `sale_payment` (o que couber) já preenchidos e navega para `/vendas/$id`.
   - Como a venda ainda não existe no passo 1, upload usa um `draftId = crypto.randomUUID()` como prefixo no storage; ao criar a venda, os documentos são movidos/registrados em `sale_documents` com o `sale_id` real. (Alternativa mais simples: criar `sales` como rascunho já no passo 1 — decido pela simples se você preferir menos código.)

2. **Componente `ExtractedField`** reutilizável em `src/components/ExtractedField.tsx`: input + badge de origem + tooltip com o valor original bruto.

3. **`src/lib/status.ts`**: helper `mapExtractionToForms(extraction)` que traduz o JSON da IA para os shapes de `sale_parties` e `sale_payment`.

### O que NÃO muda
- Wizard de edição da venda (`vendas.$id.tsx`) continua igual — os documentos permanecem editáveis lá, só que já vêm anexados.
- Regras de status, RLS, ocorrências, permissões.
- Vendas antigas não ganham botão de reextração agora.

### Custo/latência
- 1 chamada Gemini Flash por venda nova (~5–15s dependendo do tamanho dos PDFs). Sem custo fixo além do consumo normal do Lovable AI Gateway.

### Pergunta antes de codar
- **Rascunho vs draftId**: prefere que eu já crie a venda como `rascunho` no passo 1 (mais simples, menos código, mas gera vendas "vazias" se o corretor desistir) ou usar `draftId` só em memória e só criar a venda ao confirmar (mais limpo no banco, mais código)?
