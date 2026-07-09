
# Documentos como primeira etapa + autopreenchimento por IA

## Fluxo novo

1. **Etapa 1 — Documentos** (nova primeira etapa do wizard)
   - Ao abrir `/vendas/nova`, a venda é criada imediatamente como `rascunho` (necessário porque os arquivos precisam ficar ligados à venda no banco — o jurídico usa depois para imprimir).
   - Corretor sobe cada documento nos grupos já existentes (Pessoais / Imóvel / Outros — tipos definidos em `DOC_TYPES` em `src/lib/status.ts`).
   - A cada upload concluído, dispara **extração por IA** (Lovable AI / Gemini multimodal) em background; o corretor vê "Lendo documento..." e depois um badge "Campos extraídos".
2. **Etapas seguintes** (Partes, Pagamento, Ocorrência, etc.) já abrem com os campos **pré-preenchidos** pela IA — corretor só confere e corrige.
   - Cada campo autopreenchido mostra um selo discreto "sugerido pela IA" que some ao editar.

## O que a IA extrai (por tipo de documento)

- **RG / CNH** → nome completo, CPF, RG, data de nascimento, filiação, estado civil → grava em `sale_parties` (comprador/vendedor).
- **Certidão de casamento** → estado civil, regime de bens, cônjuge → `sale_parties`.
- **Contrato social / CNPJ** → razão social, CNPJ, sócio administrador → `sale_parties` (PJ).
- **Matrícula do imóvel** → endereço, matrícula, área, cartório, proprietários atuais, ônus → `sales` (endereco, matricula) + observações.
- **Comprovante de residência** → endereço → `sale_parties`.
- **Contracheque / IR** → renda declarada → `sale_payment` (quando financiamento).

Campos não reconhecidos ficam vazios, sem erro.

## Implementação

### Banco (migração)
- Nova tabela `document_extractions` (por documento): `document_id`, `sale_id`, `status` (pending/done/failed), `raw_json`, `error`, timestamps. RLS: mesma regra de `sale_documents` (quem pode ver a venda vê a extração).
- Coluna nova em `sale_documents`: `extraction_status` (para o badge na UI).

### Server function (`src/lib/documents.functions.ts`, novo)
- `extractDocument({ documentId })`: middleware `requireSupabaseAuth`, carrega o arquivo via signed URL, chama Lovable AI Gateway (`google/gemini-2.5-flash`, multimodal image/PDF) com prompt específico por `tipo` do documento e um schema Zod pequeno para saída estruturada (guardado com `NoObjectGeneratedError`). Grava resultado em `document_extractions` e atualiza `sale_documents.extraction_status`.
- `applyExtractionsToSale({ saleId })`: consolida todas as extrações done da venda e devolve um patch sugerido `{ parties, payment, sale }` para o front (não grava — o corretor confirma nas próximas etapas).

### Frontend
- `src/components/Wizard.tsx`: sem mudança estrutural — só reordenar as etapas no chamador.
- `src/routes/_authenticated/vendas.$id.tsx`:
  - Mover **Documentos** para a posição 1 do array `steps`.
  - Painel de Documentos: após upload, chama `extractDocument` e mostra estado (Lendo → Pronto/Falhou + botão "Tentar de novo").
  - Ao mudar de etapa, se houver extrações novas, chamar `applyExtractionsToSale` e mesclar no estado local do wizard (buffered, só salva ao avançar — mantém o comportamento atual).
  - Campos vindos da IA renderizam selo "IA" (some ao editar).
- `src/routes/_authenticated/vendas.nova.tsx`: cria a venda como `rascunho` e já redireciona para a etapa Documentos.

### Segurança / permissões
- Sem mudança na matriz existente — só corretor dono / gestor / jurídico / financeiro / admin veem os documentos e as extrações (RLS de `sale_documents` já cobre).
- Chamada da IA sempre server-side; `LOVABLE_API_KEY` fica no servidor.

## Fora do escopo desta rodada
- Reprocessar documentos antigos em massa.
- Extração de assinaturas / reconhecimento facial.
- Validação cruzada (ex.: CPF do RG bate com CPF digitado) — fica para próxima.

Se aprovar, implemento nessa ordem: migração → server functions → reorganização do wizard → selo IA nos campos.
