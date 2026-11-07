# Importação de vendas antigas: fichas "OCORRÊNCIA DE COMPRA E VENDA"

Pedido de Denis (tópico 6238, 09/10/2026): trazer para o ADM MAX as vendas feitas fora do sistema
desde jan/2026 (~50 fichas/mês, ~450 a 500 arquivos). Só o financeiro importa. Os relatórios de hoje
devem continuar iguais, sem mudar telas nem regras.

**Fase 1 (este PR) é só leitura.** O leitor não grava nada no ADM e não usa IA. Ele lê o XML do .docx
de forma determinística, sem custo.

## Como rodar

```bash
# prévia + conferência no ADM (usuários e duplicidade), sempre em modo somente leitura
python3 scripts/importacao-fichas/ler_fichas.py PASTA_COM_FICHAS --adm --saida /caminho/fora/do/git

# sem acesso ao banco: usuários e vendas por CSV exportado
python3 scripts/importacao-fichas/ler_fichas.py PASTA --usuarios usuarios.csv --vendas vendas.csv --saida OUT

# testes (fichas sintéticas, sem banco)
python3 scripts/importacao-fichas/test_ler_fichas.py
```

O `--adm` usa o endpoint `database/query/read-only` da Management API. A credencial fica em arquivo
protegido e nunca é impressa. As consultas leem só `profiles` (id, nome, ativo) e `sales`, `occurrences` e
`sale_status_history` (código, data, valor e status), filtrando a organização Única.

Saídas, sempre fora do repositório:

- `previa.csv`: uma linha por ficha, separada por `;` e em UTF-8, pronta para abrir no Excel;
- `problemas.csv`: uma linha por erro ou aviso.

## O que o leitor extrai

Ele procura os campos pelo **rótulo**, não pela posição. Isso permite ler variações pequenas do modelo.

| Ficha | Coluna da prévia | Destino no sistema (fase 2) |
|---|---|---|
| Código do imóvel (ID RE/MAX) | `codigo_interno` | `sales.codigo_interno` / `occurrences.codigo_imovel` |
| Tempo de venda | `tempo_venda`, `tempo_venda_dias` | `sales/occurrences.tempo_venda(_dias)` |
| Data de assinatura | `data_assinatura`, `mes_comercial` | `occurrences.data_assinatura` + histórico `contrato_assinado` |
| Nota fiscal sim/não | `nota_fiscal_obrigatoria` | `sales/occurrences.nota_fiscal_obrigatoria` |
| Mídia | `midia` (lista oficial), `midia_original` | `sales/occurrences.midia` |
| Lançamento | `modalidade` | `sales.modalidade` |
| Vendedor / comprador | **somente** `*_nome` e `*_tipo_pessoa` | `sale_parties` (`vendedor_1` / `comprador_1`, só nome) |
| Valor anunciado / negociado / % / comissão | mesmos nomes de `sales` | `sales` + `occurrences` |
| Captador, vendedor, indicadores, coordenadores | nome, usuário sugerido, id, % e R$ | colunas de `sales` → `sync_occurrence_commissions` |
| Financiamento | `financiamento*` | `sale_payment` / `occurrences.financiamento*` |
| Parcelas 1 a 3 | `prev_recebimento{,2,3}_{valor,data,forma}` | `occurrences.prev_recebimento*` |
| Parceria | nome, %, valor | `sales.parceria_*` / `occurrence_partners` |

**LGPD:** o leitor nunca guarda CPF/CNPJ, RG, e-mail, celular nem dados bancários. Esses dados não
vão para a prévia, para o `problemas.csv`, para o log nem para a saída do terminal. Ele usa os dígitos
do CPF/CNPJ apenas para saber se a parte é pessoa física ou jurídica e descarta o número na hora.
Um teste automatizado (`LGPD`) garante isso.

Para a fase 2, ficam colunas vazias que o financeiro preenche na planilha:
`situacao_comissao` (`paga` / `a_receber`) e `recebido_em_parcela_1..3`. Elas podem ser preenchidas
por venda ou em bloco, por mês.

## Validações (ERRO bloqueia a linha; AVISO pede confirmação)

| Regra | Gravidade |
|---|---|
| Data inválida (`19/06/026`, dia inexistente, fora de dd/mm/aaaa), com sugestão | ERRO |
| Data de assinatura vazia ou no futuro / antes de jan/2026 | ERRO / AVISO |
| Participantes + parceria passam da comissão total | ERRO |
| Indicador maior que a comissão do lado dele (mesma regra de `calcular_distribuicao_venda`) | ERRO |
| % do participante não confere com o R$ (vale o R$, como no sistema) | AVISO |
| % da comissão não confere com o R$ | AVISO |
| Soma das parcelas ≠ comissão própria (comissão − parceria), mesma regra de `validar_previsao_recebimento` | ERRO |
| Parcela sem valor, data ou forma (o trigger do banco exige o trio) / mais de 3 parcelas | ERRO |
| Parcelas com a mesma data | AVISO |
| Corretor sem usuário igual na Única: sugere o mais parecido (AVISO) ou não acha (ERRO) | AVISO / ERRO |
| Obrigatório vazio: código, data, NF, mídia, vendedor, comprador, valor, comissão, financiamento, parcelas | ERRO |
| Código fora do formato `^[0-9]{9}-[0-9]{1,3}$` (mesma constraint do banco) | ERRO |
| Mídia fora da lista do banco: corrige digitação (`Intagram` → Instagram) ou usa "Outro" | AVISO |
| Parceria sem tipo (imobiliária externa × RE/MAX externa: a ficha não traz) | AVISO |
| Lançamento com captador (o sistema não tem captador em Lançamento) | AVISO |
| Já existe no ADM (código + data + valor) / mesmo código com outra data ou valor / repetida no lote | ERRO / AVISO / ERRO |

Situação final por linha: `PRONTA`, `PRONTA — confirmar avisos`, `BLOQUEADA — corrigir erros`,
`DUPLICADA — não importar` ou `DUPLICADA NO LOTE — não importar`.

## Duplicidade

Uma venda já existe quando o código é igual (só os dígitos, com ou sem hífen/"ID"), a data de
assinatura também, e o valor negociado bate centavo a centavo. O leitor compara o código com
`sales.codigo_interno`, `sales.imovel_id` e `occurrences.codigo_imovel`. A data é comparada com
`occurrences.data_assinatura`, `sales.data_assinatura` (Lançamento) ou com a data em São Paulo do
último `contrato_assinado`. O valor é comparado com `sales.valor_negociado` e
`occurrences.valor_negociado`.

Quando o código bate, mas a data ou o valor são diferentes, a ficha recebe AVISO, e não exclusão
automática. Pode ser revenda do mesmo imóvel ou uma data digitada errada. Hoje o ADM tem ocorrências
assinadas de 03/08/2026 a 07/10/2026. Por isso, só as fichas de agosto a outubro podem colidir.

## Proposta para a fase 2 (NADA aplicado)

### Como a venda importada entra

Ela entra pronta, sem passar pelas filas:

1. `sales` com `status = 'ocorrencia_concluida'` e `organization_id` da Única explícito. A divisão
   entra nas mesmas colunas preenchidas pela tela, como `valor_comissao_captador`, `corretor_captador_id`,
   `valor_comissao_lider_*`, `percentual_remax/valor_remax` e `parceria_*`.
2. `sale_parties`: `vendedor_1` e `comprador_1`, só com o nome. `tipo_pessoa` vem da prévia.
3. `occurrences` com `status = 'concluida'`, `aceita_financeiro = true`, `data_assinatura` e as parcelas
   em `prev_recebimento*`.
4. `sync_occurrence_commissions(sale_id)` gera `occurrence_commissions` com
   `calcular_distribuicao_venda`, as mesmas funções usadas hoje. Antes de gravar cada venda, a
   distribuição precisa sair com `calculo_valido = true`. Se não sair, a linha volta para a prévia.
5. `sale_status_history` recebe dois eventos com o **horário da assinatura** (meia-noite em
   America/Sao_Paulo): `contrato_assinado` e `ocorrencia_concluida`. Em Lançamento, entra
   `ocorrencia_analise_financeiro`. **É isso que coloca a venda no mês certo em todos os relatórios**,
   porque `vendas_comerciais_validas()` usa o último `contrato_assinado` ou, em Lançamento,
   `sales.data_assinatura`. `motivo = 'Importada pelo financeiro (ficha .docx)'` e `autor_id` vem do
   usuário financeiro que importou.

### Comissões: os dois casos

Denis ainda vai conferir. Por isso, a coluna `situacao_comissao` fica aberta na prévia.

| Caso | Parcelas (`occurrences`) | Efeito nas telas |
|---|---|---|
| **paga** | `prev_recebimento*` + `prev_recebimento*_recebido_em/_recebido_valor` preenchidos (data real do recebimento; se ninguém souber, a data prevista, marcada na prévia) | Entra em "Recebidas" no mês do recebimento; não aparece em "A receber" |
| **a_receber** | só `prev_recebimento*` | Aparece em "A receber". **Atenção:** parcelas com data passada aparecem como atrasadas. Com ~450 vendas antigas, a fila pode encher. |

O ADM não tem campo de **"pago ao corretor"**. Ele registra só o recebimento da imobiliária.
Por isso, "comissão paga ao corretor" não muda nenhuma coluna, e a resposta de Denis decide apenas
entre recebida e a receber.

### Migration mínima necessária (proposta, não aplicada)

```sql
alter table public.sales
  add column origem_registro text not null default 'sistema'
    check (origem_registro in ('sistema', 'importada_financeiro')),
  add column importacao_lote text,          -- id do lote, para reverter em bloco
  add column importacao_arquivo_hash text;  -- hash da ficha, evita importar duas vezes
create unique index sales_importacao_arquivo_hash_uq on public.sales (importacao_arquivo_hash)
  where importacao_arquivo_hash is not null;
```

Também falta decidir um ponto de regra. Hoje o trigger
`validar_data_venda_lancamento_mes_atual` **bloqueia qualquer Lançamento com data fora do mês atual**,
inclusive no INSERT. Assim, os Lançamentos antigos não entram sem uma exceção estreita. Uma saída é
liberar só quando `origem_registro = 'importada_financeiro'` e o autor for financeiro ou admin, gravando
pela RPC de importação. Isso depende do ok de Denis.

A gravação deve ser feita por uma RPC `importar_venda_ficha(jsonb)` `SECURITY DEFINER`, executável só
por financeiro, admin ou super_admin. Ela grava a venda inteira numa transação, chama
`calcular_distribuicao_venda` e recusa a venda se `calculo_valido = false`.

### Impacto nos relatórios

- **Entram, no mês da assinatura:** Vendas, VGV, Visão Executiva, Financeiro, Produção por
  Pessoa, Desempenho, rankings e Ocorrências concluídas. A regra de origem é a mesma das vendas de
  hoje, e nenhuma tela muda.
- **Recebimentos:** depende do caso pago ou a receber descrito acima.
- **Ficam vazios nas importadas:** endereço do imóvel, ficha do imóvel (área e tipo), documentos e
  dados pessoais das partes. Relatórios que usam área, como o estudo de mercado, não vão contar essas
  vendas até alguém completar os dados.
- `origem_registro` permite filtrar ou separar as importadas mais tarde, sem mudar tela agora.

### Fase 2: passo a passo

1. Receber as ~450 fichas e rodar a prévia completa com `--adm`.
2. O financeiro corrige ERROS na ficha ou na planilha, confirma AVISOS e preenche `situacao_comissao`.
3. Denis dá o "sim" para a migration, para a exceção de Lançamento e para a gravação.
4. Fazer backup verificado e gravar em lotes por mês, com `importacao_lote`.
5. Conferir os totais do mês contra a prévia.
6. Reverter, se preciso: apagar por `importacao_lote` (venda, ocorrência, comissões, partes e histórico).
