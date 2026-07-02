# Roteiro de Teste End-to-End — Esteira da Venda

Pré-requisitos: um Corretor (dono da venda), um Gestor (líder do corretor via `team_members`), um usuário Jurídico e um Financeiro. Admin/Super Admin opcionais para checagens de trava.

## Fluxo feliz — 12 passos

1. **Corretor** cria uma venda, preenche Resumo / Partes / Pagamento / Documentos obrigatórios e clica **Enviar ao gestor**. Status: `Enviada para revisão`.
2. **Gestor** abre a venda, revisa e clica **Aprovar p/ jurídico**. Status: `Aprovada pelo gestor`.
3. **Jurídico** abre a venda e clica **Iniciar contrato**. Status: `Em elaboração de contrato`.
4. **Jurídico** anexa o arquivo do contrato (aba Documentos → tipo *Contrato (versão para revisão)*) e clica **Anexar contrato e enviar ao gestor**. Status: `Contrato — conferência do gestor`.
5. **Gestor** confere o contrato e clica **Enviar ao corretor conferir**. Status: `Contrato — conferência do corretor`.
6. **Corretor** confere o contrato e clica **Dar OK no contrato**. Status: `Contrato aprovado pelo corretor`.
7. **Gestor** clica **Enviar para assinatura**. Status: `Aguardando assinatura`.
8. Após a assinatura offline, **Gestor** anexa o *Contrato assinado* na aba Documentos e clica **Marcar contrato assinado**. Status: `Contrato assinado` → automaticamente vira `Ocorrência pendente` e a etapa **Ocorrência** é desbloqueada para o gestor.
9. **Gestor** preenche a Ocorrência (financiamento, pagamento, comissões dos 6 papéis somando 100%, parcerias) e clica **Enviar ocorrência ao financeiro**. Status: `Ocorrência em análise (Financeiro)`.
10. **Financeiro** abre a ocorrência, confere e clica **Aceitar e travar**. A venda entra em modo leitura para Corretor, Gestor e Jurídico. Status: `Ocorrência concluída`.
11. Verificar que Corretor/Gestor/Jurídico veem o banner verde de trava e todos os campos ficam disabled.
12. **Financeiro** (ou Admin/Super Admin) pode clicar em **Liberar edições** com justificativa — a venda volta a `Ocorrência devolvida ao gestor` e o gestor pode ajustar.

## Cenários de devolução (repetir para cada ponto)

| Origem | Botão | Status resultante | Quem age depois |
| --- | --- | --- | --- |
| Gestor revisando | Devolver ao corretor | `Devolvida para ajuste` | Corretor corrige e reenvia |
| Jurídico analisando | Devolver ao gestor | `Enviada para revisão` | Gestor revisa e reenvia |
| Gestor conferindo contrato | Devolver ao jurídico | `Em elaboração de contrato` | Jurídico ajusta contrato |
| Corretor conferindo contrato | Devolver ao gestor | `Contrato — conferência do gestor` | Gestor decide |
| Gestor pré-assinatura | Devolver ao corretor | `Contrato — conferência do corretor` | Corretor confere de novo |
| Financeiro analisando ocorrência | Devolver ao gestor | `Ocorrência devolvida ao gestor` | Gestor ajusta e reenvia |

Em toda devolução: o motivo é **obrigatório**, fica gravado em `sale_status_history.motivo`, aparece no Histórico, gera comentário na aba Comentários e dispara notificação para o corretor dono da venda.

## Checagens extras

- **Isolamento por perfil**: ver `docs/TESTE_ACESSO.md`.
- **Trava do Financeiro**: um Admin (não super admin) não deve conseguir se promover; só Super Admin concede Admin/Super Admin.
- **Wizard buffered save**: alterações em Resumo/Partes/Pagamento/Ocorrência não vão ao banco até clicar Salvar ou avançar de etapa (aparece "Alterações não salvas").
- **Auditoria**: consultar `activity_logs` para `status_change`, `sale_viewed`, `role_granted`, `role_revoked`, `occurrence_locked`, `occurrence_unlocked`, `occurrence_reopened`.
