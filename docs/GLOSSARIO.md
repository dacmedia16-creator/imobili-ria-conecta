# Glossário do ADM MAX

Linguagem compartilhada do negócio. Use **estes nomes** em telas, mensagens, cartões, commits e conversas com Denis.
Cada termo traz: definição curta · **Código/tabela** (quando existe) · **Evite** (sinônimos que confundem).

Fontes: código e migrations deste repositório (`src/lib/auth.tsx`, `src/lib/status.ts`, `src/lib/locacao.ts`,
`supabase/migrations/*`), nota do Obsidian `02 - Projetos/Sistema ADM MAX.md` e mapa de telas do ADM MAX.
Quando o código e este glossário divergirem, vale o código; corrija o glossário no mesmo PR.

---

## 1. Empresa e plataforma

**Imobiliária** — Cada empresa cliente do sistema (multiempresa). Tudo que se vê e grava fica preso à imobiliária atual.
- Código: tabela `organizations`; `organization_id`, `current_org_id()`.
- Evite: "agência", "empresa", "tenant", "unidade" (unidade é sempre a loja/CNPJ, nunca a imobiliária inteira).

**Unidade** — Sempre a **loja**, ou seja, o **CNPJ**, de uma imobiliária. É usada no contrato de captação exclusiva, e uma imobiliária pode ter várias unidades. (Denis, 17/11)
- Código: tabela `exclusive_units`; tela `/admin/unidades-captacao`.
- Evite: usar "unidade" como sinônimo de imobiliária.

**Plataforma** — A camada da equipe MAX acima das imobiliárias: cria imobiliárias, liga módulos e entra em cada uma.
- Código: `platform_admins`, `is_platform_super_admin`, rotas `/plataforma/*`.
- Evite: confundir com "Administrador principal" (que é da imobiliária).

**Módulo** — Funcionalidade ligada ou desligada por imobiliária em Plataforma → Imobiliárias. Desligado: o menu esconde e as RPCs recusam.
- Código: tabela `organization_modules` (ex.: `captacao_exclusiva`, `feedback_proprietario`, `oportunidades`, `locacao`, `especialistas_publico`, `meu_plano_2027`, `leads`, `proposta_compra`).
- Evite: "feature flag", "plugin".

**Imobiliária histórica** — A Única Escolha, primeira imobiliária do sistema; alguns módulos nascem ligados só para ela.
- Código: `organizations.legacy_default`.

**Cadastro único** — O ADM MAX é a fonte da verdade de usuários e papéis; Visita e Estudo copiam automaticamente.
- Código: `docs/sync-satelites.md`.
- Evite: editar usuários direto no Visita/Estudo.

**Conta MAX** — Login único (sempre Google) que dá acesso aos sistemas MAX.
- Código: edge `conta-max-bridge`, rota `/conta-max`.

**UniHub** — Nome escolhido (22/10) para a página que reúne os sistemas, antes chamada "MAX Hub". Domínio principal: somosunihub.com.br.
- Código: rota `/` (ainda com textos "MAX Hub").

## 2. Pessoas e papéis

**Papel** — Permissão de uma pessoa dentro de uma imobiliária. Uma pessoa pode ter vários.
- Código: tabela `user_roles`, enum `app_role`; rótulos em `ROLE_LABEL` (`src/lib/auth.tsx`).
- Evite: "perfil" para papel (perfil é `profiles`, os dados pessoais).

**Corretor** — Quem capta e vende imóveis.
- Código: papel `corretor`.
- Evite: "agente", "vendedor" (vendedor é a parte que vende o imóvel ou a ponta de venda).

**Gestor** — Aprova vendas e captações e acompanha equipes da imobiliária. **Equivale a Team Leader** e é **diferente de Administrador**. (Denis, 17/11)
- Código: papel `gestor`.
- Evite: "gerente", "coordenador" (nome antigo); tratar gestor como administrador.

**Team Leader (TL)** — Líder de uma equipe de corretores; vê e aprova o que é da equipe.
- Código: papel `team_leader`; `teams.lider_id`; nas vendas `lider_captador_id`/`lider_vendedor_id`.
- Evite: "coordenador" (nome antigo de Team Leader e de Gestor).

**Coordenador** — **Nome antigo** de Team Leader e de Gestor. Não use em telas nem textos. (Denis, 17/11)
- Código: ainda aparece no enum `app_role` e em `sales.coordenador_id` (legado).
- Use: "Team Leader" ou "Gestor".

**Líder auxiliar** — Pessoa que co-lidera uma equipe junto com o TL.
- Código: tabela `team_co_leaders`.
- Evite: "vice-líder", "co-TL".

**Equipe** — Grupo de corretores com um TL; pode ter sub-equipes.
- Código: `teams`, `team_members`.
- Evite: "time" em texto de tela (o código usa "time" só internamente).

**Administrador** — Administra a imobiliária (usuários, dados, módulos da casa).
- Código: papel `admin`.
- Evite: chamar o administrador de "gestor" (gestor é outro papel, equivalente a TL).

**Administrador principal** — Dono/administrador principal **da imobiliária**. Pode fazer sozinho as etapas de gestor e jurídico da venda (imobiliárias sem gestor/jurídico).
- Código: papel `super_admin` (rótulo "Administrador principal").
- Evite: "Super Admin" — esse nome é só para o administrador da **plataforma**.

**Staff** — **Equipe interna** da imobiliária; vê dados sensíveis como a Ficha de colaboradores e cria regiões. (Denis, 17/11)
- Código: papel `staff`.
- Evite: "funcionário", "backoffice".

**Jurídico** — Conferência de documentos e elaboração do contrato da venda.
- Código: papel `juridico`.

**Financeiro** — Analisa a ocorrência, confere comissões e dá baixa nos recebimentos.
- Código: papel `financeiro` (global). Na Locação existe outro "financeiro" interno (`locacao_papeis`).

**Lançamento (papel)** — Coordenador de lançamentos; registra vendas do tipo lançamento.
- Código: papel `lancamento`.

**Fotógrafo** — Papel que só enxerga a área de agendamento de fotos.
- Código: papel `fotografo`.

**Locação (papel)** — Papel que só dá acesso à área de locação. Dentro dela há papéis próprios: Gestora de locação, Setor de contratos, Vistoria/Seguro, Financeiro da locação.
- Código: papel `locacao`; tabela `locacao_papeis` (`gestora`, `contratos`, `vistoria`, `financeiro`).

**ID RE/MAX** — Identificador do corretor na rede RE/MAX. Usado para ligar anúncios do XML às captações. **Obrigatório** para corretor, gestor e team leader: 9 dígitos começando com 630, sem repetir entre usuários ativos. Staff e administrativo sem esses papéis não informam.
- Código: `profiles.remax_id`; no contrato, "ID RE/MAX do captador (travado)"; regra em `cadastro_exige_registro` e índice `profiles_remax_id_uniq` (migration `20261029160000_cadastro_completo_ficha.sql`).
- Evite: "código RE/MAX", "matrícula".

**CRECI** — Registro profissional do corretor. **Opcional**: vazio ou só zeros = sem CRECI. Sem CRECI, o corretor vira testemunha e um gestor/TL assina o contrato.
- Código: `profiles.creci`; `creciSoZeros`, `validCreci`.

**Completar cadastro** — Tela do 1º acesso: foto, nome, e-mail, telefone e data de nascimento obrigatórios para todos. Para corretor, gestor e team leader, também são **obrigatórios** o CPF válido e o ID RE/MAX (9 dígitos, começa com 630, único entre usuários ativos). Staff e administrativo sem esses papéis não informam CPF nem ID. O CRECI é opcional e nunca bloqueia a ficha.
- Código: `src/components/CompletarPerfil.tsx`, `src/lib/completar-perfil.ts`.

**Ficha de colaboradores** — Ficha pessoal e de emergência de cada pessoa; visível só para staff e administração.
- Código: rota `/ficha-colaboradores`.

**Impersonação ("Ver como")** — Abrir o sistema vendo como outro usuário, com faixa vermelha e auditoria.
- Código: `operational_impersonation_sessions`.

## 3. Captação

**Captação exclusiva** — Contrato em que o proprietário dá exclusividade de venda à imobiliária por um prazo. É o centro do módulo de captação. **Não existe captação sem exclusividade** (Denis, 17/11).
- Código: tabela `exclusive_captures`; telas `/exclusividades`; status `rascunho`, `devolvida`, `enviada`, `em_assinatura`, `aprovada`.
- Evite: "exclusividade" e "captação" como coisas diferentes — no ADM são a mesma; "angariação".

**Captador** — O corretor que trouxe o imóvel (a captação). Na venda, é uma das duas pontas.
- Código: `exclusive_captures` (corretor), `sales.corretor_captador_id`.

**Proprietário** — Dono do imóvel captado; pode haver vários na mesma captação.
- Evite: "cliente" (ambíguo), "vendedor" na captação.

**Data de assinatura (da captação)** — Dia em que o contrato foi assinado; a exclusividade conta a partir dela. Vencimento = data de assinatura + prazo em dias.
- Código: `exclusive_captures.signed_on`, `prazo_dias_numero` (padrão 180).
- Evite: contar o prazo pela data de cadastro.

**Captação manual** — Captação lançada à mão (contrato já assinado fora). Prazos de plano/feedback contam da **aprovação**.
- Código: migration `20261008160000_exclusividade_cadastro_manual.sql`.

**Contrato-base (RE/MAX)** — Modelo padrão do contrato de captação, preenchido com os dados da unidade. Unidades antigas podem manter o PDF antigo.
- Código: `exclusive_units.contrato_antigo`, `legacy_template`; `src/lib/capture-pdfs`.

**Plano de Marketing** — Lista de ações de divulgação do imóvel, obrigatória (pelo menos 1 ação) e anexada ao contrato da captação.
- Código: `exclusive_plan_*`, `PlanoChecklist`.
- Evite: "Dossiê" (nome antigo), "Planejamento de Marketing".

**Feedback ao proprietário** — Relatório para o dono do imóvel com números dos portais e ações do plano; só imóveis à venda.
- Código: rota `/feedback`, módulo `feedback_proprietario`, `owner_feedback_*`.

**XML RE/MAX** — Arquivo oficial de anúncios RE/MAX→Grupo OLX; base dos anúncios do Feedback (só `For Sale`). O link é segredo.
- Código: `remax_xml_*`, `docs/remax-xml-feed.md`.

**Virou venda** — Ação que liga uma captação exclusiva à venda que nasceu dela.
- Código: RPC `exclusive_virar_venda`.

**Transferência de captação** — Passar a captação de um corretor para outro.
- Código: migration `20261028140000_captacao_transferir_corretor.sql`.

## 4. Venda

**Venda** — Negociação de compra e venda de um imóvel, do rascunho até a ocorrência concluída.
- Código: tabela `sales`; status em `src/lib/status.ts`.
- Evite: "negócio", "deal", "transação".

**Venda padrão** — Venda de imóvel de terceiros (usado), com o fluxo Corretor → Gestor → Jurídico → Contrato → Financeiro.
- Evite: "venda normal".

**Lançamento** — Venda de empreendimento novo, com fluxo próprio (sem o caminho padrão do Jurídico).
- Código: RPC `criar_lancamento`, rota `/vendas/lancamento/nova`.

**Status da venda** — Etapa em que a venda está: Rascunho, Enviada para revisão, Devolvida para ajuste, Aprovada pelo gestor, Enviada ao jurídico, Em elaboração de contrato, conferências do contrato, Aguardando assinatura, Contrato assinado, Ocorrência pendente/em análise/devolvida/concluída, Arquivada, Cancelada.
- Código: `SaleStatus`, `STATUS_LABEL`.

**Esteira** — Vendas abertas que ainda não têm contrato assinado, ordenadas por tempo parado.
- Evite: "pipeline", "funil" (funil é o relatório de ocorrências).

**Vendido** — Termo oficial para a venda com contrato assinado; conta no mês da **data de assinatura**. Use "Vendido" em todos os textos. (Denis, 17/11)
- Código: `data_assinatura_oficial`; filtro `VENDIDOS_FILTER` (`src/lib/status.ts`). "efetivada"/"concluída" e os status `ocorrencia_concluida`/`concluida` são só nomes **internos** do código.
- Evite: "efetivada", "concluída" nos textos para dizer que a venda foi feita.

**Partes** — Vendedor(es) e comprador(es) do imóvel na venda.
- Código: `sale_parties`.
- Evite: "clientes".

**Ponta** — Cada lado da venda: ponta captação e ponta venda. Na produção, a venda padrão vale 0,5 para cada ponta (metade do VGV e da comissão).
- Código: `src/lib/producao-por-pessoa-calc.ts`.
- Evite: "lado" (exceto em "Lado REMAX").

**Parceria externa** — Venda feita com outra imobiliária em uma das pontas; a quantidade fica inteira para a ponta interna e a comissão da parceira é descontada.
- Código: `occurrence_partners`.

**Ocorrência** — Documento financeiro da venda, criado após o contrato assinado; o financeiro analisa e conclui. É o que gera as comissões a pagar.
- Código: tabelas `occurrences`, `occurrence_commissions`; status `ocorrencia_*`.
- Evite: usar "ocorrência" como sinônimo de venda ou de problema/incidente.

**Ocorrência concluída** — Ocorrência finalizada pelo financeiro; base do relatório e da impressão. É etapa **interna** do financeiro: para dizer que a venda aconteceu, use "Vendido".
- Código: `ocorrencia_concluida`, rota `/ocorrencias-concluidas`.

## 5. Dinheiro e números

**VGV (Valor Geral de Vendas)** — Soma dos valores de venda dos imóveis.
- Código: `vgv*` (ex.: `vgvTotal`, `vgvEfetivado`).
- Evite: chamar comissão de VGV.

**VGC (Valor Geral de Comissão)** — Soma das comissões geradas; base do ranking e da previsão da Inteligência de gestão.
- Código: `src/lib/inteligencia-gestao.ts`.

**Comissão** — Valor pago pela venda, dividido entre pessoas e papéis. Comissão recebida conta no mês em que o dinheiro entrou.
- Código: `occurrence_commissions`, `sale_commission_extras`, `calcular_distribuicao_venda`.
- Evite: "honorários", "fee".

**Divisão de comissão** — Quanto cada pessoa recebe da comissão da venda.

**Comparativo 6%** — Relatório que compara a comissão praticada com o padrão de 6% do valor do imóvel.
- Código: `comparativo_comissao_6pct`, `vgvEquivalente6`.

**Lado REMAX** — **Nome oficial** da parte da comissão que fica com a imobiliária (ex.: com parceria, total 6% e lado REMAX 3%). (Denis, 17/11)

**Baixa de recebimentos** — Marcar a comissão como recebida.
- Código: rota `/comissoes-a-receber`.

**Produção** — VGV e comissão atribuídos a cada pessoa por ponta.
- Código: rota `/producao-por-pessoa`, `producao_por_pessoa_dados`.

## 6. Carreira e gestão

**Minha carreira** — Painel pessoal: hoje, meu mês, meu dinheiro, conquistas, diário e meta.
- Código: rota `/minha-carreira`.

**Meu Plano** — Plano anual do corretor (KRIs/KPIs, metas, orçamento pessoal), na ordem da cartilha; as metas atuais valem a partir de 01/01/2027. O nome é **"Meu Plano", sem o ano**. (Denis, 17/11)
- Código: módulo `meu_plano_2027`, `src/lib/meu-plano-2027/`, rota `/minha-carreira/plano` (o "2027" no código é só nome interno).
- Evite: "Meu Plano 2027", "planejamento anual", "plano de metas".

**Inteligência de gestão** — Farol, previsão, conversa 1:1 e termômetro para o gestor.
- Código: módulo `inteligencia_gestao`, `src/lib/inteligencia-gestao.ts`.

**Clube RE/MAX** — Faixas de reconhecimento por produção. O nome **não muda por imobiliária**; as faixas oficiais são as que estão cadastradas no código/banco. (Denis, 17/11)
- Código: `clube_remax_faixas`, `carreira_clube`; faixas iniciais em `20261104120000_ranking_clubes.sql`.

**Mural de Conquistas** — Feed de vendas e captações da equipe com aplausos, ranking e aniversariantes.
- Código: rota `/mural-conquistas`, `achievement_*`.

**Oportunidades** — Mural de pedidos e ofertas de imóveis entre corretores.
- Código: módulo `oportunidades`, `opportunity_posts`.

## 7. Especialistas e regiões

**Encontre um especialista** — **Nome oficial** da página pública com corretores por região, separada por imobiliária. (Denis, 17/11)
- Código: módulo `especialistas_publico`, rota `/especialistas/<slug>`.
- Evite: "Ache um especialista".

**Região (de atuação)** — Bairro/área em que o corretor atua. Pertence à **cidade** (cidade + UF), compartilhada entre imobiliárias da mesma cidade; cada imobiliária aprova, recusa ou junta para si.
- Código: `positioning_regions`, `positioning_region_orgs` (`ativa`, `pendente`, `recusada`, `juntada`), `corretor_positioning_regions`.
- Evite: dizer que a região é "da imobiliária".

**Sugestão de região** — Pedido do corretor para criar uma região nova; o administrador aprova.
- Código: `positioning_region_suggestions`, rota `/admin/posicionamento`.

## 8. Locação

**Locação** — Módulo de aluguel: esteira do contrato até a entrega das chaves e financeiro (cobranças e repasses).
- Código: módulo `locacao`, tabelas `locacoes`, `locacao_*`; rotas `/locacoes`.
- Evite: "aluguel" como nome do módulo.

**Garantia (locatícia)** — Forma de garantia do aluguel: seguro-fiança, caução, fiador, Loft, título de capitalização, outras.
- Código: `src/lib/locacao.ts`.

**Parceria na locação** — Locação feita com outra RE/MAX ou imobiliária externa. Um lado é sempre da casa e o outro do parceiro (no máximo 1 lado externo): **Captador (lado do proprietário)** ou **Corretor do locatário**. O pagamento do parceiro vai para a imobiliária (CNPJ) ou direto ao corretor (CPF). (Denis, 20/11)
- Código: `locacao_lancamentos.parceria_lado`; dados de pagamento em `locacao_parceiro_pagamento` (só Financeiro da locação e gestão; RPCs `locacao_parceiro_pag_*`).

**Repasse** — Valor do aluguel repassado ao proprietário depois dos descontos.
- Código: `locacao_repasses`.

## 9. Atendimento e outros

**Lead** — Contato de interessado vindo de portal/formulário.
- Código: módulo `leads`, rotas `/meus-leads`, `/painel-leads`.

**Nicole** — IA de atendimento de leads (antes "Emanuella").
- Evite: "Emanuella", "bot".

**Proposta de compra** — Proposta assinada por link + código, com validade de 5 dias.
- Código: módulo `proposta_compra`, rota `/propostas/$id`.

**Ajuda e sugestões** — Chamados abertos pelos usuários, tratados na Central de chamados.
- Código: rota `/ajuda`, `/plataforma/chamados`.
