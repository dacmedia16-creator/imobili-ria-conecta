
## Fluxo desejado (resumo)

```text
Corretor cria/edita
   │ envia
   ▼
Gestor revisa ──devolver──► Corretor (com observação)
   │ aprova
   ▼
Jurídico analisa ──devolver──► Gestor (com observação)
   │ aceita, elabora e anexa contrato
   ▼
Gestor confere contrato ──devolver──► Jurídico
   │ envia para corretor conferir
   ▼
Corretor confere contrato ──devolver──► Gestor
   │ dá OK
   ▼
Gestor dá OK final → envia para assinatura
   │
   ▼
Aguardando assinatura ─► Gestor sobe contrato assinado
   │
   ▼ (abre automaticamente o campo de ocorrência para o Gestor)
Ocorrência sendo preenchida pelo Gestor
   │ envia
   ▼
Financeiro analisa ──devolver──► Gestor (com observação)
   │ aceita e trava
   ▼
Ocorrência concluída (fim)
```

## Alterações no banco (uma migração)

Adicionar novos valores ao enum `sale_status`:
- `contrato_conferencia_gestor` — jurídico anexou contrato, gestor precisa conferir
- `contrato_conferencia_corretor` — gestor mandou o corretor conferir
- `contrato_ok_corretor` — corretor deu OK, aguardando gestor liberar assinatura
- `ocorrencia_analise_financeiro` — gestor enviou ocorrência ao financeiro
- `ocorrencia_devolvida_gestor` — financeiro devolveu ocorrência para o gestor ajustar

Reaproveita os já existentes: `rascunho`, `enviada_revisao`, `devolvida_ajuste`, `aprovada_gestor`, `em_elaboracao_contrato`, `aguardando_assinatura`, `contrato_assinado`, `ocorrencia_pendente`, `ocorrencia_concluida`, `cancelada`, `arquivada`.

Também adicionar coluna `contrato_url` em `sales` (texto) para o arquivo do contrato, se ainda não existir — usada tanto pelo jurídico (contrato não assinado) quanto pelo gestor (contrato assinado), com histórico via `sale_documents` do tipo `contrato` / `contrato_assinado`.

## Alterações em `src/lib/status.ts`

- Estender `SaleStatus`, `STATUS_LABEL`, `STATUS_TONE` e `proximoResponsavel` com os novos estados.
- Rótulos em português: "Contrato — conferência do gestor", "Contrato — conferência do corretor", "Contrato aprovado pelo corretor", "Ocorrência em análise (Financeiro)", "Ocorrência devolvida ao gestor".
- Adicionar dois tipos de documento em `DOC_TYPES`: `contrato` (grupo outros) e `contrato_assinado` (grupo outros, obrigatório para concluir).

## Alterações em `src/routes/_authenticated/vendas.$id.tsx`

Substituir a barra de botões atual pela esteira completa. Cada botão só aparece para o papel e status corretos, e todo "devolver" abre o diálogo de observação já existente (`openReturnDialog`), gravando o motivo em `sale_status_history.motivo` e disparando notificação.

Mapa de botões por papel × status:

| Status atual | Quem age | Botões |
| --- | --- | --- |
| `rascunho` / `devolvida_ajuste` | Corretor (dono) | Enviar para o gestor |
| `enviada_revisao` | Gestor | Aprovar p/ jurídico · Devolver ao corretor |
| `aprovada_gestor` / `em_elaboracao_contrato` | Jurídico | Iniciar contrato · Anexar contrato e enviar ao gestor · Devolver ao gestor |
| `contrato_conferencia_gestor` | Gestor | Enviar ao corretor conferir · Devolver ao jurídico |
| `contrato_conferencia_corretor` | Corretor | Dar OK · Devolver ao gestor |
| `contrato_ok_corretor` | Gestor | Enviar para assinatura · Devolver ao corretor |
| `aguardando_assinatura` | Gestor | Anexar contrato assinado (marca `contrato_assinado`) |
| `contrato_assinado` | Gestor | Abrir ocorrência (vai para `ocorrencia_pendente`) — automático ao subir contrato assinado |
| `ocorrencia_pendente` | Gestor | Enviar ocorrência ao financeiro |
| `ocorrencia_analise_financeiro` | Financeiro | Aceitar e travar (fluxo atual) · Devolver ao gestor |
| `ocorrencia_devolvida_gestor` | Gestor | Reenviar ao financeiro |

Regras acopladas:
- "Anexar contrato" (jurídico) e "Anexar contrato assinado" (gestor) abrem um upload direto para `sale_documents` com `tipo = contrato` / `contrato_assinado`; ao salvar, o status muda automaticamente (`em_elaboracao_contrato` → `contrato_conferencia_gestor`; `aguardando_assinatura` → `contrato_assinado`).
- Ao entrar em `contrato_assinado`, o painel de Ocorrência (wizard) é desbloqueado para o gestor (hoje ele já libera; ampliar para `ocorrencia_pendente`, `ocorrencia_analise_financeiro`, `ocorrencia_devolvida_gestor`).
- "Enviar ocorrência ao financeiro" só habilita se `validarOcorrencia()` passar (soma das comissões = 100%, campos obrigatórios preenchidos) — mensagem em PT no botão desabilitado.
- Cada transição continua registrando `sale_status_history` + `activity_logs` + notificação para o próximo responsável (o helper `notifyRole` já existe).

## Ajustes de leitura / edição

Atualizar a regra `editable` para cobrir os novos estados de ida-e-volta:
- Corretor edita quando `rascunho`, `devolvida_ajuste`, `contrato_conferencia_corretor` (apenas o comentário/OK, campos permanecem em leitura).
- Gestor edita quando `enviada_revisao`, `contrato_conferencia_gestor`, `contrato_ok_corretor`, `ocorrencia_pendente`, `ocorrencia_devolvida_gestor`.
- Jurídico edita quando `aprovada_gestor`, `em_elaboracao_contrato`.
- Financeiro edita sempre; trava por aceite continua igual.

## Dashboards e lista de vendas

- Adicionar contadores nos cards por papel usando os novos status (ex.: Gestor → "Contratos para conferir", "Ocorrências devolvidas"; Corretor → "Contratos para conferir"; Financeiro → "Ocorrências em análise").
- Filtro de status em `/vendas` já é dinâmico via `STATUS_LABEL`, então herda os novos rótulos automaticamente.

## Documentação de teste

Atualizar `docs/TESTE_MANUAL.md` com o roteiro end-to-end da nova esteira em 12 passos numerados (um por transição), incluindo os cenários de devolução em cada ponto.

## Detalhes técnicos

- Enum: `ALTER TYPE public.sale_status ADD VALUE IF NOT EXISTS '...';` para cada novo valor (uma instrução por valor, sem transação).
- `sales.contrato_url TEXT` opcional; usar `IF NOT EXISTS`.
- Nenhuma tabela nova, nenhuma policy nova (as policies atuais já cobrem os novos status porque dependem de papéis/ownership, não do valor específico do status). Exceção: `can_view_sale` do jurídico usa uma lista textual de status — incluir os novos estados de contrato lá.
- Sem mudanças em RLS de `occurrences`; o financeiro continua sendo quem trava.
- Sem mudança de UI de wizard: reaproveita a estrutura de etapas atual.

## Fora de escopo desta rodada

- Assinatura eletrônica integrada (D4Sign/Clicksign) — hoje é upload manual.
- Edição colaborativa em tempo real do contrato.
- Aprovação em lote no dashboard.
