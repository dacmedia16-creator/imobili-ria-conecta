// Manual "como usar a Locação" do balão Ajuda MAX (t_b037935e). Escrito a partir do código da main d1d5cd9:
// rotas /locacoes e /locacoes/$id, src/lib/locacao.ts (ETAPAS, PAPEL_LABEL) e os componentes de src/components/locacao.
// É o ÚNICO conhecimento que a IA recebe: nenhum dado de locação, cliente, contrato ou valor real entra aqui.
// Ao mudar botão/aba/etapa da Locação, atualize este texto (o teste confere os nomes das abas e etapas).

export const MANUAL_VERSAO = "2026-11-11";

export const MANUAL_LOCACAO = `
# Como usar a Locação no ADM MAX

## Onde fica
- Menu lateral → **Locação** (no celular: botão de menu ☰ no topo → Locação). Só aparece se a imobiliária tem o módulo Locação ligado.
- A tela principal tem o botão **Nova locação** (canto superior direito) e abas. Cada pessoa vê só as abas do seu papel.
- Clicar no código de uma locação (ex.: LOC-0001) na lista abre a esteira dela, com 9 etapas.
- Nada da Locação é enviado ao cliente: o corretor preenche e sobe tudo no sistema.

## Papéis
- **Corretor**: abre a locação, preenche a ficha e sobe os documentos.
- **Gestora de locação**: aprova a pré-análise e confere a documentação.
- **Setor de contratos**: monta a minuta e controla as assinaturas.
- **Vistoria/Seguro**: cuida do pós-assinatura e da entrega das chaves.
- **Financeiro da locação**: cobranças, baixas e repasses (aba Financeiro).
- Administrador e administrador principal podem agir em qualquer papel. Uma pessoa pode ter mais de um papel.
- Quem define os papéis: gerência, na aba **Regras e papéis** → quadro **Quem faz cada papel** (marcar a caixa da pessoa na coluna do papel).

## As 8 abas da tela Locação
1. **Minhas locações** — lista das locações do corretor (código, candidato, imóvel, etapa, com quem está). Se estiver vazia: clique em **Nova locação**.
2. **Gestora** — duas filas: **Pré-análises aguardando** e **Documentações para conferir**. Clique no código para abrir e decidir.
3. **Contratos** — fila **Minutas e assinaturas** (etapas 5 e 6).
4. **Pós-assinatura e chaves** — fila **Pós-assinatura e entrega das chaves**, com a situação de vistoria, seguro e titularidade.
5. **Comissão** — locações com chave entregue: 1º aluguel, taxa de administração → %, comissão do lado da casa, coordenador, corretor, parceiro e data de pagamento. É só cálculo para conferência; nada é lançado no financeiro por esta aba. Aparece para gerência, financeiro e gestora.
6. **Financeiro** — só para quem tem o papel Financeiro da locação. Subabas: **Painel**, **Contratos**, **Repasse e extrato**, **Regras financeiras**. Baixa e repasse são registros manuais: o ADM MAX não gera boleto, não recebe Pix e não transfere dinheiro.
7. **Visão geral** — esteira completa: quadros Em andamento, Paradas há mais de 5 dias, Minutas em ajuste, Devolvidas ao corretor, e **Tempo parado por etapa**.
8. **Regras e papéis** — só gerência (administrador, administrador principal, staff). Quadros **Quem faz cada papel** e **Regras desta imobiliária** (percentual do coordenador, dias de pagamento da comissão, tabela Taxa de administração → % do 1º aluguel, lista de documentos por garantia). Botão **Salvar regras**.

## Dentro de uma locação (esteira de 9 etapas)
- No topo: código, nome do candidato, etapa atual e há quanto tempo está parada.
- A barra de etapas (1 a 9) mostra o andamento. Clique numa etapa já feita para ver o que foi feito nela; clique na atual para voltar.
- Abaixo aparece "Etapa N — nome" e o **Responsável** pela etapa.
- No fim da página fica o **Histórico** (data e responsável de cada passo).
- Botão **← Locações** volta para a lista.

### Etapa 1 — Pré-análise (corretor)
1. Na tela Locação, clique em **Nova locação** (ou abra uma locação sua em Minhas locações).
2. Preencha a ficha: Imóvel (ID do imóvel, tipo Residencial/Comercial, mobília, metragem), Valores e garantia (aluguel, IPTU, condomínio, taxa de administração, garantia: Fiador, Caução ou Seguro-fiança), Locatário (candidato), Proprietário, Corretores (corretor captador, parceria) e Observações e tratativas.
3. Clique em **Salvar rascunho** para guardar sem enviar.
4. Clique em **Enviar ficha à gestora**. O botão fica travado enquanto falta campo; embaixo aparece "Falta preencher: ...".
- Obrigatórios da pré-análise: CPF, nome completo, data de nascimento, telefone e e-mail do candidato, endereço do imóvel e aluguel. Da ficha: ID do imóvel, mobília, metragem, endereço atual do locatário, nome do proprietário, telefone ou e-mail do proprietário e corretor captador.

### Etapa 2 — Aprovação gestora
1. A gestora abre a aba **Gestora** → **Pré-análises aguardando** → clica no código.
2. Clica **Aprovar pré-análise**, ou escreve o motivo no campo **Motivo** e clica **Reprovar** (o motivo é obrigatório).
- Reprovada: volta ao corretor ou encerra, conforme a regra "Pré-análise reprovada volta ao corretor" em Regras e papéis.
- Se a locação voltou para o corretor, aparece no topo o aviso amarelo **Devolvida pela gestora:** com o motivo.

### Etapa 3 — Documentação (corretor)
1. Abra a locação. Aparece o checklist de documentos da garantia escolhida, separado por Locatário, Fiador/Caução/Seguro-fiança e Proprietário.
2. Em cada item, escolha o arquivo (PDF, JPG, PNG ou WEBP). Item que termina em "(opcional)" não trava.
3. A IA pode ler o documento e preencher os **Dados do contrato** (só campos vazios). Use **Ler com IA** se houver documentos esperando leitura; o selo mostra "Aguardando IA", "IA falhou" (aí digite à mão) ou "Lido pela IA". Confira sempre o que foi preenchido.
4. Complete o quadro **Dados do contrato**. Se a pessoa não tem um dado, marque **Não possui**.
5. Quando aparecer "Tudo anexado e preenchido. Pode enviar para conferência.", clique **Enviar documentação à gestora**. O botão fica travado com o aviso 🔒 **Falta preencher** enquanto faltar documento obrigatório ou dado.
- Para trocar um arquivo: clique no ícone de lixeira (Remover) e envie outro.

### Etapa 4 — Conferência gestora
1. A gestora abre a aba **Gestora** → **Documentações para conferir** → clica no código.
2. Confere os documentos e o resumo **Dados do contrato** (mostra de onde veio cada campo).
3. Clica **Ok — enviar ao setor de contratos**, ou escreve o motivo e clica **Devolver ao corretor**.

### Etapa 5 — Minuta (setor de contratos)
1. O setor de contratos abre a aba **Contratos** → **Minutas e assinaturas** → clica no código.
2. O modelo sugerido aparece conforme tipo do imóvel × garantia.
3. **Montar contrato** (hoje só para residencial com fiador): preencha os passos, use **Próximo**/**Voltar**, **Salvar correções** e **Gerar PDF para conferência**. Fica travado ("Montar contrato travado") enquanto faltar documento obrigatório. Não gera cobrança, repasse nem assinatura.
4. Se a minuta já veio pronta de outra RE/MAX, marque **⚡ Atalho: minuta já veio pronta de outra RE/MAX**.
5. Botões do setor de contratos: **Cobrar pendência** (escreva a pendência; ela aparece para o corretor), **Marcar "em ajuste"**, **Montar e enviar minuta ao corretor** (ou **Enviar minuta externa ao corretor**), e **Preparar assinatura →**.
6. O corretor, com a minuta em mãos, clica **Proprietário de acordo** ou escreve o ajuste e clica **Pedir ajuste**. Se houve pendência, responde e clica **Resolver pendência**.
- "Preparar assinatura" só libera com a minuta aprovada pelo corretor/proprietário (ou com o atalho de minuta externa).

### Etapa 6 — Assinatura (setor de contratos)
1. Tabela com 3 documentos: 1. Contrato de administração, 2. Contrato de locação, 3. Laudo de vistoria, com quem assina e a situação (não enviado, aguardando assinaturas, assinado).
2. Se a chave já está na imobiliária, marque **vistoria junto** para mandar o laudo junto (3º documento).
3. Clique **Registrar envio para assinatura (DocuSign)**. O envio é feito fora do sistema; aqui só se registra. A ligação automática fica para uma próxima fase.
4. Quando cada documento for assinado, clique **marcar assinado** na linha dele.
- Com o contrato de administração e o de locação assinados, a locação segue sozinha para o Pós-assinatura.

### Etapa 7 — Pós-assinatura (vistoria)
1. A vistoria abre a aba **Pós-assinatura e chaves** → clica no código.
2. Quadro **Vistoria**: **Vistoria pedida** → registrar hoje; **Laudo enviado p/ assinatura e assinado** → registrar hoje; **Contestação de vistoria** → registrar contestação.
3. Quadro **Seguro e condomínio**: digite o nº da apólice e clique **registrar** em Seguro (incêndio/fiança) contratado; em **Aviso ao condomínio** registre o aviso ou clique **sem condomínio**; em **Agendamento de mudança** escolha a data e clique **salvar**.
4. **Troca de titularidade** (CPFL energia, SAAE água, Gás): o corretor informa o nº do protocolo ou marca "não se aplica". Falta de protocolo não trava nada; só gera alerta na comissão.
5. Clique **Pós-assinatura concluída → combinar entrega das chaves**.

### Etapa 8 — Entrega das chaves (vistoria)
1. Escolha a data combinada com o corretor e clique **Registrar entrega**.
- Se o laudo de vistoria ainda não foi assinado: a entrega fica bloqueada até o laudo, ou é permitida com alerta, conforme a regra "Permite entregar a chave antes do laudo assinado" em Regras e papéis.
- Com o seguro incêndio obrigatório ligado nas regras, ele precisa estar registrado antes das chaves.

### Etapa 9 — Comissão
- Aparece "Chaves entregues em ..." com a comissão prevista para o corretor e a data de pagamento (mês seguinte, conforme o dia da entrega: 1 a 15 ou 16 a 31, regra da imobiliária).
- Se faltar protocolo de titularidade, aparece um alerta que não bloqueia a comissão. O corretor ainda pode informar o protocolo nessa tela.
- A conta completa fica na aba **Comissão**.

## Financeiro da locação (aba Financeiro)
- **Painel**: escolha o mês com **‹ Anterior** / **Próximo ›** e clique **Gerar cobranças de <mês>**. Quadros: A receber (a vencer), Recebido no mês, Em atraso, Repasses do mês. Clique numa cobrança para abrir.
- Na cobrança: **Registrar baixa** (pagamento recebido fora do sistema), **Desfazer baixa** ou **Cancelar cobrança** (os dois pedem motivo).
- **Contratos**: o contrato nasce sozinho quando a esteira registra a entrega das chaves. Os que estão "a completar" precisam de dados (inquilino, proprietário, CPF/CNPJ do proprietário, dados para repasse, aluguel, taxa de administração, dia de vencimento de 1 a 28...). Botões **Salvar** e **Salvar e ativar contrato**.
- **Repasse e extrato**: lance descontos (descrição + valor), registre o repasse com data e comprovante (opcional) e clique **Marcar repasse feito**; **Desfazer registro do repasse** se errou. **Extrato do proprietário**: escolha o proprietário na lista.
- **Regras financeiras**: multa e juros por atraso, dias para o repasse, se a imobiliária retém o 1º aluguel, se condomínio e IPTU entram na cobrança. Só quem tem o papel Financeiro da locação altera; os demais só leem. Botão **Salvar regras financeiras**.

## Itens marcados "a confirmar"
- Algumas regras aparecem com a marca "a confirmar": são valores de exemplo até a imobiliária confirmar. Quem altera é a gerência em Regras e papéis (ou o financeiro em Regras financeiras).

## O que o Ajuda MAX não faz
- Não consulta locações, clientes, contratos, valores nem documentos. Não altera nada no sistema.
- Não responde sobre leis, cálculo jurídico, valores de mercado ou casos específicos de clientes.
`.trim();
