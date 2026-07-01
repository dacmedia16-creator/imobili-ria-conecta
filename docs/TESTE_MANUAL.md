# Checklist de Testes Manuais — Portal Imobiliária

Testar cada cenário em navegador anônimo, alternando entre usuários. Onde houver "❌ deve falhar", o sistema **deve** recusar a ação.

## 1. Fluxo positivo do corretor
1. Corretor loga → clica **Nova Venda** → salva como rascunho.
2. Corretor tenta clicar **Enviar para revisão** com dados vazios → sistema abre modal de conferência mostrando as **pendências em português** e não permite envio.
3. Corretor preenche imóvel, matrícula, vendedor 01 (nome + CPF), comprador 01 (nome + CPF), valor negociado, comissão e forma de pagamento; anexa RG, CPF e matrícula.
4. Corretor volta ao modal → **0 pendências** → confirma envio → status vai para **Enviada para revisão**.
5. Sistema notifica gestores/coordenadores (sininho no header).

## 2. Fluxo do gestor
6. Gestor abre a venda, vê banner "Aguardando revisão do gestor" → clica **Aprovar p/ jurídico** → status vira **Aprovada pelo gestor**.
7. Gestor abre outra venda e clica **Devolver** com motivo → obrigatório digitar o motivo → status vira **Devolvida para ajuste** e corretor é notificado.

## 3. Fluxo do jurídico
8. Jurídico só enxerga vendas em `aprovada_gestor` ou etapas seguintes (❌ não vê rascunhos).
9. Jurídico clica **Iniciar contrato** → status **Em elaboração**.
10. Jurídico → **Aguardando assinatura** → **Marcar contrato assinado**.
11. Ao assinar, sistema **automaticamente** move para **Ocorrência pendente** e notifica financeiro/admin.

## 4. Documentos
12. Gestor/jurídico rejeita um documento com motivo → corretor recebe notificação com o motivo em destaque na aba Documentos.
13. Corretor clica **Reenviar** no card do documento recusado → novo arquivo sobe → gestor pode aprovar.

## 5. Fluxo do financeiro (ocorrência)
14. Financeiro abre a venda em **Ocorrência pendente** → aba **Ocorrência** habilita.
15. Clica **Criar ocorrência a partir dos dados da venda** → dados são pré-preenchidos (código do imóvel, valor negociado, comissão, financiamento).
16. Preenche comissões dos 6 papéis; ao digitar % o valor é calculado (e vice-versa).
17. Soma das comissões maior que o total → banner vermelho de alerta.
18. Adiciona parceiro externo com dados bancários.
19. Clica **Finalizar** → confirma na tela de conferência → status vira **Ocorrência concluída** → aba trava para edição.
20. Financeiro clica **Reabrir** → obrigatório digitar justificativa → status volta para pendente, campo `reopen_reason` salvo e corretor notificado.

## 6. Segurança / RLS
21. Corretor A não consegue abrir `/vendas/<id-do-corretor-B>` (`can_view_sale` retorna false → 404/tela vazia).
22. Coordenador só vê vendas dos corretores vinculados em **Admin → Usuários**.
23. Colar URL assinada de documento em aba anônima após 60s → link expirado.
24. Usuário deslogado tenta abrir `/vendas` → redirecionado para `/auth`.
25. Admin logado tenta remover seu próprio papel de admin em **Admin → Usuários** → botão desabilitado e RLS `user_roles_admin_write` também bloqueia via API.
26. Corretor tenta inserir notificação para outro usuário via API → policy `notif_insert` rejeita.

## 7. Notificações
27. Sininho mostra contagem de não lidas em tempo real (canal realtime).
28. Página **/notificacoes** lista abas Não lidas / Lidas, permite marcar uma ou todas como lida e abre a venda relacionada.

## 8. Admin
29. Admin desativa um corretor → o corretor continua conseguindo logar mas pode ser filtrado pela lista (flag `ativo=false` exibida como badge).
30. Admin vincula corretor a gestor → gestor passa a ver as vendas do corretor.
31. Toda mudança de papel gera linha em `activity_logs` (trigger `log_role_change`).
