## Objetivo
Quando o Jurídico clica em **"Anexar contrato e enviar ao gestor"**, hoje só muda o status. Vou trocar por um fluxo em 2 passos: primeiro anexa o arquivo do contrato, depois envia para o gestor conferir.

## Mudanças (só em `src/routes/_authenticated/vendas.$id.tsx`)

1. Substituir o botão único por um **diálogo de anexo** que:
   - Aceita PDF/DOC/DOCX (input file).
   - Faz upload no bucket `sale-documents` com `categoria = "contrato"` e `parte = "outros"` (mesmo padrão dos outros documentos).
   - Grava a linha em `sale_documents`.
   - Só depois muda o status para `contrato_conferencia_gestor` e registra em `sale_status_history`.

2. Se já existir um contrato anexado, o diálogo mostra o(s) arquivo(s) já enviados e permite:
   - **Substituir** (subir nova versão — o anterior fica no histórico, marcado como versão antiga).
   - **Enviar assim mesmo** (usar o contrato já anexado).

3. Bloqueio: o botão de enviar ao gestor fica **desabilitado** enquanto nenhum arquivo de categoria `contrato` estiver anexado.

4. Mensagens de erro claras (falha de upload, falha de RLS, arquivo grande demais).

## Não muda
- Fluxo de status, RLS, papéis.
- Etapa "Documentos" do wizard continua igual (o contrato também aparecerá lá, na seção "Outros", categoria Contrato).
- Botões dos outros perfis (gestor, corretor, financeiro).

## Fora de escopo
- Assinatura eletrônica.
- Versionamento formal (por ora, cada upload é uma linha nova em `sale_documents`).