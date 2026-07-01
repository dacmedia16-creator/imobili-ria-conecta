## Problema
Hoje cada campo dispara salvamento automático (autosave por onChange/onBlur), causando "salvando…" o tempo todo.

## Objetivo
Salvar apenas ao avançar de etapa no wizard (ou ao clicar em "Salvar" explicitamente). Digitar campos não deve mais disparar requisição.

## Mudanças

1. **`src/routes/_authenticated/vendas.$id.tsx`**
   - Remover qualquer autosave por campo (onChange/onBlur/`useEffect` com debounce que faz `update`).
   - Manter estado local (`formState`) por etapa, sem persistir no banco a cada tecla.
   - Adicionar função `salvarEtapaAtual()` que faz o `update` no Supabase apenas dos campos daquela etapa.
   - Marcar etapa como "dirty" quando o usuário edita algo; se dirty, ao clicar **Próximo** chama `salvarEtapaAtual()` antes de avançar. Se falhar, não avança e mostra erro.
   - Botão **Voltar** não salva (só navega); se houver alterações não salvas, pergunta "Descartar alterações?".
   - Manter botão **Salvar** visível na etapa para salvar sem avançar.
   - Indicador de status: trocar "Salvando…" contínuo por badge discreto ("Alterações não salvas" / "Salvo") atualizado só nesses eventos.

2. **`src/components/Wizard.tsx`**
   - Aceitar prop opcional `onBeforeNext?: (fromStep, toStep) => Promise<boolean>`; se retornar `false`, cancela a navegação.
   - Sem mudanças visuais.

## Fora do escopo
- Não altero schema, RLS, comissões, parcerias, dashboards nem lógica de status.
- Uploads de documento continuam salvando na hora (é ação explícita, não digitação).
- Comentários continuam com envio explícito.

Confirma que é isso?