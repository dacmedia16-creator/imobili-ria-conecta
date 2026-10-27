// Wiki MAX v4 (aprovada por Denis em 22/10/2026, t_5e94d050). Conteúdo gerado da maquete
// wiki-max-maquete-v4.html, sem o que era só da maquete (O que mudou, lacunas, decisões, rascunho).
// Texto com <b>…</b> é o único HTML aceito; é convertido em <strong> por renderizarTexto (sem innerHTML).
import type { WikiFaq, WikiGuia } from "./tipos";

export const GUIAS: WikiGuia[] = [
  {
    id: "entrar",
    sistema: "ger",
    icone: "🔑",
    titulo: "Como entrar nos sistemas",
    resumo: "Uma conta Google só para os três sistemas.",
    papeis: ["c", "tl", "g", "a", "f"],
    onde: "Site <b>unicaescolha.com.br</b> (abre o <b>UniHub</b>) → cartão do sistema → entrar com a sua conta <b>Google</b>",
    passos: [
      "Abra <b>unicaescolha.com.br</b>. Ele abre o <b>UniHub</b>, a página com todos os sistemas MAX.",
      "Clique no cartão do sistema que você quer usar: <b>Sistema ADM MAX</b>, <b>Visita MAX</b> ou <b>Estudo de Mercado MAX</b>.",
      "Entre com a sua <b>conta Google</b>. Use o mesmo e-mail que a imobiliária cadastrou (ex.: o seu @remax.com.br). O MAX não tem senha própria.",
      "<b>1º acesso ao ADM MAX:</b> aparece a tela <b>Complete seu perfil</b> (foto, nome, e-mail, telefone, CPF, CRECI, <b>Data de nascimento</b> e ID RE/MAX). Preencha e clique em <b>Salvar e entrar</b>. Para conta nova, é obrigatório, inclusive a data de nascimento. Quem já tinha conta pode clicar em <b>Agora não</b> e recebe um lembrete a cada entrada; para essas contas, a data aparece como <b>(opcional)</b>.",
      "<b>1º acesso ao Visita MAX:</b> aparece a tela <b>Termos de Uso</b>. Leia, marque a caixa de concordância e clique em <b>Aceitar e Continuar</b>.",
      "<b>1º acesso ao Estudo de Mercado MAX:</b> pode aparecer <b>Complete seu perfil</b>. Confira nome, telefone e e-mail e clique em <b>Salvar e continuar</b>.",
    ],
    dica: "Você não precisa criar conta no Visita nem no Estudo. O cadastro é feito uma vez só, no ADM MAX, e vai para os outros sozinho.",
    cuidado: "Não compartilhe a sua conta Google. Cada corretor tem o próprio acesso.",
    outrosPapeis:
      "A tela <b>Complete seu perfil</b> aparece só para quem é <b>corretor</b>. Conta nova (criada a partir de 20/10/2026) não entra sem preencher a data de nascimento: aparece “Falta preencher: … Data de nascimento.” e, embaixo do campo, “Informe sua data de nascimento.” A idade mínima é 16 anos.",
    prints: [
      {
        chave: "entrar-1",
        legenda:
          "UniHub: escolha o sistema. No topo ficam os botões Trocar conta e Sair da Conta MAX.",
      },
      {
        chave: "adm-1acesso-nascimento",
        legenda: "Complete seu perfil de conta nova: a Data de nascimento é obrigatória.",
      },
      {
        chave: "visita-3-aceitar-termos",
        legenda: "Visita MAX, 1º acesso: tela Termos de Uso.",
      },
    ],
    videos: [
      {
        chave: "entrar",
        capa: "video-entrar-capa",
        legenda: "Vídeo: como entrar nos sistemas com a sua conta Google.",
        duracao: "3:08",
      },
    ],
  },
  {
    id: "nao-entro",
    sistema: "ger",
    icone: "🔒",
    titulo: "Não consigo entrar",
    resumo: "O que fazer quando o acesso não funciona.",
    papeis: ["c", "tl", "g", "a", "f"],
    onde: "Entrada pelo <b>Google</b>. Quem corrige o seu e-mail é o team leader, o gestor ou o administrador: ADM MAX → <b>Usuários</b> → <b>Editar dados</b>",
    passos: [
      "Lembre: o MAX <b>não tem senha própria</b>. Você entra com a conta Google do e-mail que a imobiliária cadastrou.",
      "Esqueceu a senha do Google? Recupere pela tela de entrada do próprio Google.",
      "Entrou com outro e-mail do Google? No UniHub, clique em <b>Trocar conta</b> e escolha o e-mail certo.",
      "O e-mail cadastrado está errado ou você não tem conta Google nesse e-mail? Peça ao seu team leader, gestor ou administrador. Ele corrige no ADM MAX em <b>Administração</b> → <b>Usuários</b> → <b>Editar dados</b>.",
      "Nada resolveu? Peça a um colega que já entra para abrir um chamado em <b>Ajuda e sugestões</b> por você.",
    ],
    cuidado:
      "Se no Visita MAX aparecer a página <b>Recuperar senha</b>, não use. Ela é de contas antigas. Volte e entre pelo Google.",
    videos: [
      {
        chave: "nao-entro",
        capa: "video-nao-entro-capa",
        legenda: "Vídeo: o que fazer quando não consegue entrar.",
        duracao: "2:13",
      },
    ],
  },
  {
    id: "dados",
    sistema: "ger",
    icone: "🪪",
    titulo: "Meus dados estão errados",
    resumo: "Telefone, foto, CPF, CRECI, nome ou e-mail.",
    papeis: ["c", "tl", "g", "a", "f"],
    onde: "ADM MAX → Menu → Conta e acesso → <b>Meu acesso</b>",
    passos: [
      "No ADM MAX, abra <b>Meu acesso</b>.",
      "Estes dados você mesmo corrige: <b>Telefone (WhatsApp)</b> → botão <b>Salvar</b>; foto → <b>Escolher foto</b>; CPF e CRECI → <b>Salvar CPF e CRECI</b>; ID de corretor → botão <b>Salvar</b> ao lado.",
      "<b>Data de nascimento:</b> logo abaixo do telefone. Enquanto estiver vazia, o quadro fica em amarelo com o aviso “Preencha sua data de nascimento para a equipe lembrar do seu aniversário.” Escolha a data no calendário e clique em <b>Salvar</b> ao lado. Aparece “Data de nascimento salva”.",
      "Na mesma tela ficam também os seus links públicos, o seu posicionamento (regiões onde atua) e os <b>Dados para pagamento</b>.",
      "<b>Nome e e-mail</b> você não muda sozinho. Peça ao team leader, ao gestor ou ao administrador: ele corrige em <b>Administração</b> → <b>Usuários</b> → <b>Editar dados</b>.",
      "No Visita MAX e no Estudo, os seus dados aparecem travados de propósito. Corrija sempre no ADM MAX: em cerca de 1 minuto a mudança aparece nos três sistemas.",
    ],
    dica: "Preencha o <b>ID de corretor</b> (os 9 primeiros números do código dos seus imóveis). Sem ele, o Feedback ao proprietário não encontra os seus anúncios. Preencha também a <b>data de nascimento</b>: é ela que coloca você nos <b>Aniversariantes do mês</b> do Mural.",
    cuidado:
      "O team leader só corrige dados das pessoas da equipe dele. Na data de nascimento, os colegas veem só o <b>dia e o mês</b>; o ano e a idade ficam só com você e a gestão. A idade mínima aceita é 16 anos. Para tirar a data, apague o campo e clique em Salvar (“Data de nascimento removida”).",
    prints: [
      {
        chave: "adm-meu-acesso-nascimento",
        legenda:
          "Meu acesso: quadro Data de nascimento ainda vazio, em destaque, com o botão Salvar.",
      },
    ],
    videos: [
      {
        chave: "dados",
        capa: "video-dados-capa",
        legenda: "Vídeo: como corrigir os seus dados em Meu acesso.",
        duracao: "2:48",
      },
    ],
  },
  {
    id: "ajuda",
    sistema: "ger",
    icone: "💬",
    titulo: "Pedir ajuda ou dar sugestão",
    resumo: "Abrir um chamado com print.",
    papeis: ["c", "tl", "g", "a", "f"],
    onde: "Botão <b>Ajuda e sugestões</b> no topo da tela",
    passos: [
      "Clique em <b>Ajuda e sugestões</b>, no topo da tela.",
      "Em <b>O que você quer fazer?</b>, escolha <b>Relatar erro</b>, <b>Tirar dúvida</b> ou <b>Dar ideia</b>.",
      "Escreva o que aconteceu e o que você esperava que acontecesse.",
      "Se quiser, clique em <b>Anexar imagem</b> e mande um print. Antes de enviar, dá para passar uma tarja sobre nomes, CPF, telefone e valores.",
      "Clique em <b>Enviar chamado</b>. A resposta chega no sino 🔔.",
      "Para acompanhar: ADM MAX → Conta e acesso → <b>Ajuda e sugestões</b> (lista <b>Meus chamados</b>). No Visita e no Estudo, use o menu <b>Meus chamados</b>.",
      "Problema resolvido? Abra o chamado em <b>Meus chamados</b> e clique em <b>Resolveu, pode fechar</b>. Ele passa para <b>Resolvido</b>; se precisar de novo, abra outro chamado.",
    ],
    dica: "O administrador vê também a aba <b>Chamados da imobiliária</b>.",
    cuidado: "Não mande CPF, RG, telefone ou dados de clientes no texto nem no print.",
    prints: [
      {
        chave: "ajuda-1-gaveta",
        legenda: "A gaveta Ajuda e sugestões aberta.",
      },
    ],
    videos: [
      {
        chave: "ajuda",
        capa: "video-ajuda-capa",
        legenda: "Vídeo: como abrir um chamado, acompanhar e ver a resposta.",
        duracao: "3:08",
      },
    ],
  },
  {
    id: "inicio",
    sistema: "adm",
    icone: "🏠",
    titulo: "Entendendo a tela Início",
    resumo: "O resumo que aparece quando você entra.",
    papeis: ["c", "tl", "g", "a", "f"],
    onde: "ADM MAX → Menu → <b>Início</b>",
    passos: [
      "O conteúdo muda conforme o seu papel.",
      "<b>Corretor:</b> “Olá, seu nome” e o quadro <b>Suas vendas</b> (Comissão prevista, Minhas vendas, Pendências, Contratos e VGV). Abaixo ficam <b>Situação atual das vendas</b> e <b>Vendas recentes</b>.",
      "Atalhos: <b>Nova venda</b> e <b>Exclusividades</b>. Team leader e gestor também têm o atalho <b>Equipe</b>.",
      "<b>Team leader e gestor</b> veem também o <b>Painel do gestor</b>.",
      "<b>Administrador:</b> vê o <b>Painel administrativo</b>, com <b>Este mês</b> (botões <b>Mês anterior</b> e <b>Abrir financeiro</b>), o <b>Painel financeiro</b> e a <b>Movimentação do período</b>.",
    ],
    videos: [
      {
        chave: "inicio",
        capa: "video-inicio-capa",
        legenda: "Vídeo: o que aparece na tela Início para cada papel.",
        duracao: "3:15",
      },
    ],
  },
  {
    id: "carreira",
    sistema: "adm",
    icone: "📈",
    titulo: "Minha carreira: meta, comissões e conquistas",
    resumo: "Seu painel pessoal. Só você vê os seus valores.",
    papeis: ["c", "tl", "g", "a"],
    onde: "ADM MAX → Menu → <b>Minha carreira</b> (logo abaixo de Início)",
    passos: [
      "<b>O que fazer hoje:</b> as suas pendências do dia.",
      "<b>Meu mês:</b> escolha <b>Mês</b> ou <b>Ano</b>, preencha as metas de Comissão, VGV, Vendas e Captações e clique em <b>Salvar minha meta</b>.",
      "<b>Meu dinheiro:</b> as suas comissões no mês, no ano ou em todo o período.",
      "<b>Conquistas:</b> Clube RE/MAX, Ranking e Meus destaques no Mural.",
      "<b>Diário de atividades:</b> registre cada <b>Ligação</b>, <b>Visita</b> ou <b>ACM</b> que você fez.",
      "<b>Minhas captações:</b> as suas captações, com o filtro das que estão paradas.",
    ],
    dica: "Os números desta tela são só seus. Colegas não veem as suas comissões.",
    cuidado:
      "Se “Minha carreira” não aparece no menu, o módulo de captação está desligado para a sua imobiliária.",
    outrosPapeis:
      "Gestor e administrador veem também o <b>Diário da equipe</b>. O administrador tem ainda o botão <b>Editar faixas</b> do Clube.",
    videos: [
      {
        chave: "carreira",
        capa: "video-carreira-capa",
        legenda: "Vídeo: meta, comissões, conquistas e diário em Minha carreira.",
        duracao: "3:28",
      },
    ],
  },
  {
    id: "venda",
    sistema: "adm",
    icone: "🧾",
    titulo: "Como registrar uma venda",
    resumo: "Do rascunho até a venda concluída.",
    papeis: ["c", "tl", "g"],
    onde: "ADM MAX → Menu → Vendas e captações → <b>Vendas</b> → <b>Registrar venda</b> (ou o atalho <b>Nova venda</b> no Início)",
    passos: [
      "Clique em <b>Registrar venda</b>. Abre a tela <b>Nova venda</b>.",
      "No quadro <b>Identificação do imóvel</b>, preencha o <b>ID do imóvel</b> e escolha o <b>Tipo de pessoa</b> do vendedor/proprietário e do comprador (física ou jurídica).",
      "Clique em <b>Criar rascunho</b>. O sistema abre a página da venda.",
      "Complete as etapas <b>1. Documentos</b>, <b>2. Resumo</b>, <b>3. Partes</b> e <b>4. Pagamento</b>. O resto pode ser preenchido depois, com calma.",
      "Quando estiver tudo certo, clique em <b>Enviar ao gestor</b>. A venda segue o caminho: Corretor → Gestor → Jurídico → Contrato/assinatura → Financeiro → Concluída.",
    ],
    dica: "Se você também trabalha com lançamentos, antes aparece a pergunta “Qual tipo de venda…”. Escolha <b>Venda padrão</b> ou <b>Lançamento</b>.",
    cuidado:
      "A venda só pode ser apagada (<b>Excluir venda</b>) enquanto é rascunho. Depois disso, só a plataforma cancela, com o motivo registrado.",
    outrosPapeis: "O administrador não vê o botão Registrar venda.",
    prints: [
      {
        chave: "adm-venda-2-nova",
        legenda: "Tela Nova venda, com o botão Criar rascunho.",
      },
    ],
    videos: [
      {
        chave: "venda-parte1",
        capa: "video-venda-parte1-capa",
        titulo: "Vídeo 1 de 2 · Registrar a venda",
        legenda: "Do rascunho até o envio ao gestor e a aprovação para o jurídico.",
        duracao: "6:30",
      },
      {
        chave: "venda-parte2",
        capa: "video-venda-parte2-capa",
        titulo: "Vídeo 2 de 2 · Do contrato à assinatura",
        legenda: "Do jurídico até o contrato assinado, digital ou no papel.",
        duracao: "4:42",
      },
    ],
  },
  {
    id: "captacao",
    sistema: "adm",
    icone: "🏡",
    titulo: "Captação exclusiva",
    resumo: "Cadastrar e acompanhar a exclusividade.",
    papeis: ["c", "tl", "g", "a"],
    onde: "ADM MAX → Menu → Vendas e captações → <b>Captações exclusivas</b>",
    passos: [
      "No quadro <b>Nova captação</b>, clique no botão com o <b>nome da sua unidade</b>. A captação é criada na hora, como rascunho.",
      "Abra a captação, confira os documentos e complete os dados.",
      "Contrato já assinado no papel? Clique em <b>Cadastrar exclusividade já assinada</b> e envie o PDF ou a foto. O gestor confere e aprova.",
      "Acompanhe pelos contadores: <b>Aguardando gestor</b>, <b>Em assinatura</b>, <b>Devolvidas</b>, <b>Aprovadas no mês</b> e <b>Aprovadas (total)</b>.",
      "Clique em <b>Vencendo</b> para ver as exclusividades perto do fim (ou use o filtro Situação → <b>Vence em até 30 dias</b>).",
      "Em <b>Painel e mapa</b> (ou no menu <b>Mapa de captações</b>) você vê as captações no mapa.",
    ],
    cuidado:
      "Clicar no nome da unidade já cria uma captação. Não clique só para “ver como é”. Se criou sem querer, use <b>Excluir</b> no rascunho.",
    videos: [
      {
        chave: "captacao",
        capa: "video-captacao-capa",
        legenda: "Vídeo: captação exclusiva, do rascunho até o contrato assinado.",
        duracao: "8:05",
      },
    ],
  },
  {
    id: "feedback",
    sistema: "adm",
    icone: "📊",
    titulo: "Feedback ao proprietário",
    resumo: "Relatório em PDF enviado pelo seu WhatsApp.",
    papeis: ["c", "tl", "g", "a"],
    onde: "ADM MAX → Menu → Vendas e captações → <b>Feedback ao proprietário</b>",
    passos: [
      "Antes de tudo, preencha o seu <b>ID RE/MAX</b> em <b>Meu acesso</b>. Sem ele aparece “Ainda não encontramos anúncios com o seu ID RE/MAX”.",
      "Escolha o <b>imóvel</b>.",
      "Revise o texto (há uma sugestão pronta), o <b>Plano de Marketing</b> e o checklist.",
      "Baixe o PDF. Aparece o aviso “PDF baixado. Anexe no WhatsApp junto com a mensagem.”",
      "Envie pelo <b>seu WhatsApp</b>, com o PDF anexado e a mensagem.",
    ],
    dica: "O proprietário que recebe relatório sente que o imóvel está sendo trabalhado, e isso ajuda a renovar a exclusividade.",
    videos: [
      {
        chave: "feedback",
        capa: "video-feedback-capa",
        legenda: "Vídeo: como montar e enviar o feedback ao proprietário.",
        duracao: "3:02",
      },
    ],
  },
  {
    id: "oportunidades",
    sistema: "adm",
    icone: "🤝",
    titulo: "Oportunidades entre corretores",
    resumo: "Os pedidos e ofertas do grupo de WhatsApp, organizados.",
    papeis: ["c", "tl", "g", "a"],
    onde: "ADM MAX → Menu → Vendas e captações → <b>Oportunidades</b> (tela “Oportunidades: mural do grupo”)",
    passos: [
      "Poste o pedido do seu cliente ou o imóvel que você tem no <b>grupo de WhatsApp</b> da imobiliária, como sempre. A tela não tem botão de publicar.",
      "O sistema organiza os posts em <b>Procurando</b>, <b>Oferecendo</b> e <b>Outros</b>. Cada cartão some depois de 7 dias.",
      "Use os filtros: <b>Tipo</b>, <b>Venda / locação</b>, <b>Bairro / região</b>, <b>Faixa de valor</b>, <b>Corretor</b> e <b>Busca livre</b>.",
      "Fique de olho nos selos: 🤝 <b>possível encaixe</b> (alguém do grupo oferece o que outro procura) e ⭐ <b>encaixe com captação da equipe</b>.",
      "Achou um encaixe? Combine a parceria com o colega.",
    ],
    cuidado: "Se o item não aparece no menu, o módulo está desligado para a sua imobiliária.",
    prints: [
      {
        chave: "adm-oportunidades-2-corretor",
        legenda: "Oportunidades: abas, filtros e legenda dos selos.",
      },
    ],
    videos: [
      {
        chave: "oportunidades",
        capa: "video-oportunidades-capa",
        legenda: "Vídeo: como usar o mural de oportunidades e os encaixes.",
        duracao: "2:47",
      },
    ],
  },
  {
    id: "mural",
    sistema: "adm",
    icone: "🏆",
    titulo: "Mural de Conquistas",
    resumo: "Vendas assinadas, ranking e aniversariantes.",
    papeis: ["c", "tl", "g", "a"],
    onde: "ADM MAX → Menu → Vendas e captações → <b>Mural de Conquistas</b>",
    passos: [
      "<b>Conquistas recentes:</b> só entram vendas com contrato assinado. Cada cartão mostra quem captou e quem vendeu, o tipo de imóvel e o bairro, com o selo <b>Contrato assinado</b>. Não aparece valor, comissão nem nome do cliente.",
      "Para aplaudir um colega, clique em <b>👏 Parabenizar</b> no cartão da conquista. O botão vira <b>👏 Você parabenizou</b> e, ao lado, aparece “N parabéns” com os nomes de quem parabenizou. Cada pessoa parabeniza uma vez.",
      "<b>Ranking do mês:</b> escolha o mês. Conta pela quantidade de vendas (captador e vendedor contam 1 cada), sem valores.",
      "<b>Aniversariantes do mês:</b> fica no cartão à direita, abaixo do Ranking. Mostra o nome e o dia (ex.: “hoje · 22/10” ou “25/10”), nunca o ano nem a idade.",
      "Para aparecer na lista, informe a sua <b>data de nascimento</b> em <b>Meu acesso</b> (ou peça à gestão, em Usuários → Editar dados). Assim que for salva, você já aparece no mês do seu aniversário.",
      "Não quer o confete na tela quando sai uma venda? Em <b>Meu acesso</b>, na parte <b>Comemorações de vendas</b>, desligue “Mostrar confete e aviso quando alguém da imobiliária assinar uma venda”.",
    ],
    dica: "Quando ninguém do mês informou a data, o cartão diz “Nenhum aniversariante neste mês. Cada pessoa pode informar o aniversário em Meu perfil.” — “Meu perfil” é a tela <b>Meu acesso</b> do menu.",
    cuidado: "Se o item não aparece no menu, o módulo está desligado para a sua imobiliária.",
    prints: [
      {
        chave: "adm-mural-simulado",
        legenda: "Mural de Conquistas: cartão de conquista depois de clicar em Parabenizar.",
      },
      {
        chave: "adm-mural-aniversariante",
        legenda: "Aniversariantes do mês, no Mural de Conquistas.",
      },
    ],
    videos: [
      {
        chave: "mural",
        capa: "video-mural-capa",
        legenda: "Vídeo: como usar o Mural de Conquistas.",
        duracao: "2:28",
      },
    ],
  },
  {
    id: "sala",
    sistema: "adm",
    icone: "📅",
    titulo: "Reservar sala de reunião",
    resumo: "Ver horário livre e reservar.",
    papeis: ["c", "tl", "g", "a"],
    onde: "ADM MAX → Menu → Agenda → <b>Reservar sala</b> (tela “Agendamento de salas”)",
    passos: [
      "Escolha a data no calendário. Se quiser, use <b>Filtrar sala</b>.",
      "Clique num horário <b>Livre</b> ou no botão <b>Reservar sala</b>.",
      "Na janela <b>Nova reserva de sala</b>, escolha a sala, as datas, o período e os horários.",
      "Marque os <b>participantes</b> (eles recebem lembrete no WhatsApp), escreva a <b>finalidade</b> e, se quiser, as observações.",
      "Clique em <b>Confirmar reserva</b>.",
      "As suas reservas ficam em <b>Minhas próximas reservas</b>. Para cancelar, abra a reserva e clique em <b>Cancelar reserva</b>.",
    ],
    dica: "Todos veem a sala, o horário e quem reservou, mas não o motivo nem os participantes.",
    cuidado: "3 cancelamentos feitos depois da primeira hora bloqueiam novas reservas por 7 dias.",
    prints: [
      {
        chave: "adm-sala-2-dialogo",
        legenda: "Janela Nova reserva de sala.",
      },
    ],
    videos: [
      {
        chave: "sala",
        capa: "video-sala-capa",
        legenda: "Vídeo: como reservar e cancelar uma sala de reunião.",
        duracao: "2:51",
      },
    ],
  },
  {
    id: "painel-equipe",
    sistema: "adm",
    icone: "👥",
    titulo: "Painel da Equipe",
    resumo: "Vendas, ranking e “de quem é a vez” na sua equipe.",
    papeis: ["tl", "g", "a"],
    onde: "ADM MAX → Menu → Equipe → <b>Painel da Equipe</b>",
    passos: [
      "Escolha o <b>mês</b>.",
      "Veja VGV, VGC, imóveis vendidos e ticket médio da equipe, e o quadro “Quanto EU vou ganhar no mês”.",
      "<b>Ranking da equipe:</b> toque num corretor para ver os detalhes dele.",
      "<b>Andamento das vendas da equipe:</b> mostra de quem é a vez em cada venda.",
      "Clique em <b>Ver por corretor →</b> para ver pessoa por pessoa.",
    ],
    dica: "Use a tela na reunião semanal da equipe.",
    cuidado:
      "O gestor que não lidera nenhuma equipe vê a mensagem “Você não lidera nenhuma equipe nesta imobiliária.”",
    videos: [
      {
        chave: "painel-equipe",
        capa: "video-painel-equipe-capa",
        legenda: "Vídeo: como usar o Painel da Equipe.",
        duracao: "3:51",
      },
    ],
  },
  {
    id: "desempenho",
    sistema: "adm",
    icone: "📉",
    titulo: "Desempenho da equipe e da empresa",
    resumo: "Produção, comissões em carteira e ranking.",
    papeis: ["tl", "g", "a"],
    onde: "ADM MAX → Menu → Equipe → <b>Desempenho</b>",
    passos: [
      "Escolha o período: <b>Mês atual</b>, <b>Mês anterior</b> ou <b>Selecionar mês</b>.",
      "<b>Administrador e gestor:</b> use as abas <b>Por corretor</b>, <b>Por equipe</b> e <b>Total geral</b>.",
      "<b>Team leader:</b> escolha <b>Minha equipe</b> ou <b>Empresa</b> e veja o ranking <b>Por corretor</b> ou <b>Total geral</b>.",
      "Veja o <b>Resumo da operação</b> e as <b>Comissões em carteira</b> (vendas em andamento × concluídas).",
    ],
    videos: [
      {
        chave: "desempenho",
        capa: "video-desempenho-capa",
        legenda: "Vídeo: desempenho da equipe e da empresa.",
        duracao: "3:19",
      },
    ],
  },
  {
    id: "financeiro",
    sistema: "adm",
    icone: "💰",
    titulo: "Central financeira",
    resumo: "5 abas de visão financeira, mais baixa de recebimentos e relatórios.",
    papeis: ["a", "f"],
    onde: "ADM MAX → Menu → Relatórios detalhados → <b>Financeiro</b> (só para administrador e financeiro)",
    passos: [
      "Use os filtros: período (<b>Mês atual</b>, <b>Mês anterior</b>, <b>Ano atual</b> ou datas), Modalidade, Situação, Papel, Corretor, Gestor e Equipe.",
      "Navegue pelas 5 abas: <b>Visão Geral</b> (produção gerada, caixa do período e próximos recebimentos), <b>Recebimentos</b>, <b>Comissões Calculadas</b>, <b>Previsão e Aging</b> (o que está atrasado e o que vai vencer) e <b>Divergências</b>.",
      "Para registrar o dinheiro que entrou, use <b>outro item do menu</b>: <b>Baixa de recebimentos</b>. Na aba <b>A receber</b>, marque os recebimentos e clique em <b>Marcar como recebida(s)</b>. Dá para <b>Exportar CSV</b> (planilha).",
      "Em <b>Relatórios financeiros</b> (também no menu) ficam as abas Fluxo de caixa, Comissões, Financiamentos e Funil de ocorrências.",
      "No mesmo grupo do menu ficam <b>Comparativo 6%</b> e <b>Produção por pessoa</b> (botão <b>Imprimir / baixar</b>).",
    ],
    cuidado:
      "Gestor e team leader <b>não</b> entram no Financeiro (aparece “Acesso não autorizado.”). Eles só veem <b>Produção por pessoa</b>.",
    prints: [
      {
        chave: "adm-financeiro-1-visao-geral",
        legenda: "Financeiro: filtros e as 5 abas.",
      },
    ],
    videos: [
      {
        chave: "financeiro",
        capa: "video-financeiro-capa",
        legenda: "Vídeo: as abas da Central financeira e a baixa de recebimentos.",
        duracao: "2:58",
      },
    ],
  },
  {
    id: "usuarios",
    sistema: "adm",
    icone: "🧑‍💼",
    titulo: "Cadastrar ou desligar corretor",
    resumo: "Uma vez no ADM, vale para os três sistemas.",
    papeis: ["tl", "g", "a"],
    onde: "ADM MAX → Menu → Administração → <b>Usuários</b> (tela “Usuários e perfis”)",
    passos: [
      "<b>Administrador:</b> clique em <b>Novo usuário</b>, preencha Nome completo, E-mail, Telefone (WhatsApp), <b>Data de nascimento (opcional)</b> e Papel e clique em <b>Criar usuário</b>.",
      "<b>Team leader ou gestor:</b> clique em <b>Novo corretor</b>. O papel já vem como Corretor (no caso do team leader, a pessoa entra na equipe dele). A data de nascimento também pode ser preenchida aqui.",
      "Não existe senha. A pessoa entra com a conta Google desse e-mail. Em cerca de 1 minuto ela já entra também no Visita MAX e no Estudo.",
      "Para colocar a pessoa numa equipe, use <b>Equipes</b> (link “gerenciar em Equipes →”).",
      "Para corrigir nome, e-mail ou <b>data de nascimento</b>: <b>Editar dados</b>. O campo <b>Data de nascimento</b> mostra “Ainda não preenchida” quando a pessoa ainda não informou. Escolha a data e clique em <b>Salvar</b> (“Dados do usuário atualizados.”). Para mudar o papel: <b>Editar papéis</b> (só administrador).",
      "Para desligar: clique em <b>Desativar</b> no cartão da pessoa. Abre a confirmação <b>“Desativar Nome da pessoa?”</b>, com o aviso “Ele não vai mais conseguir entrar no sistema.”",
      "Clique em <b>Desativar</b> (botão vermelho) para confirmar ou em <b>Cancelar</b> para desistir. Ao confirmar, aparece “Usuário desativado” e o acesso aos três sistemas é bloqueado.",
      "Nada é apagado. O cartão vai para o grupo <b>Mostrar N inativos</b>; para religar, abra esse grupo e clique em <b>Ativar</b> (sem confirmação).",
    ],
    cuidado:
      "Confira o nome no título da confirmação antes de clicar em Desativar. O gestor e o team leader só veem Desativar para quem eles podem gerenciar. Na data de nascimento: o administrador preenche a de qualquer pessoa da imobiliária; o gestor, só de quem é corretor; o team leader, só dos corretores da equipe dele. Sem permissão, o campo nem aparece. Data de quem tem menos de 16 anos é recusada (“A idade mínima é 16 anos.”) e o usuário não é criado.",
    prints: [
      {
        chave: "adm-usuarios-desativar",
        legenda: "Confirmação que aparece ao clicar em Desativar.",
      },
      {
        chave: "adm-usuarios-editar-nascimento",
        legenda: "Editar dados do usuário: campo Data de nascimento.",
      },
      {
        chave: "adm-usuarios-novo-menor16",
        legenda:
          "Novo usuário: data de quem teria menos de 16 anos mostra “A idade mínima é 16 anos.”",
      },
    ],
    videos: [
      {
        chave: "usuarios",
        capa: "video-usuarios-capa",
        legenda: "Vídeo: como cadastrar, editar e desligar um corretor.",
        duracao: "3:06",
      },
    ],
  },
  {
    id: "modulos",
    sistema: "adm",
    icone: "🧩",
    titulo: "Configurar a imobiliária",
    resumo: "Dados, marca, salas e unidades.",
    papeis: ["a"],
    onde: "ADM MAX → Menu → Administração → <b>Dados da imobiliária</b> e <b>Unidades da captação</b> (só administrador)",
    passos: [
      "Em <b>Dados da imobiliária</b>: dados da empresa, marca e cores, logo e mapa de captações.",
      "Ainda em Dados da imobiliária, na parte <b>Salas de reunião</b>: <b>Nova sala</b>, <b>Editar</b> e <b>Ver reservas</b>.",
      "Em <b>Unidades da captação</b>: <b>Nova unidade</b> e <b>Editar</b>. O nome de cada unidade vira um botão na tela de Nova captação.",
      "Ligar ou desligar módulos (captações, feedback, oportunidades, mural, salas) é feito pela equipe MAX, não pelo administrador. Se precisar, peça em <b>Ajuda e sugestões</b>.",
    ],
    videos: [
      {
        chave: "modulos",
        capa: "video-modulos-capa",
        legenda: "Vídeo: como configurar dados, salas e unidades da imobiliária.",
        duracao: "2:56",
      },
    ],
  },
  {
    id: "visita",
    sistema: "vis",
    icone: "📝",
    titulo: "Registrar uma visita com prova",
    resumo: "Ficha da visita com proprietário e comprador.",
    papeis: ["c"],
    onde: "Visita MAX (visitamax.com.br) → Início → <b>Novo Registro de Visita</b>",
    passos: [
      "No 1º acesso, aceite os <b>Termos de Uso</b> (botão <b>Aceitar e Continuar</b>).",
      "Na tela <b>Início</b>, clique em <b>Novo Registro de Visita</b>. Na primeira vez aparece um tour rápido (“Progresso”): clique em <b>Próximo</b> ou feche no X.",
      "Escolha como quer criar o registro: <b>Preencher todos os dados agora</b>, <b>Apenas Proprietário primeiro</b> ou <b>Apenas Comprador primeiro</b>. Clique em <b>Próximo</b>.",
      "Siga as etapas <b>Modo → Imóvel → Proprietário → Comprador → Confirmar</b>. Em Imóvel: <b>Endereço completo</b> e <b>Tipo do imóvel</b>. Em Proprietário e Comprador, o <b>Telefone (WhatsApp)</b> é obrigatório; se marcar “Deixar o proprietário preencher”, a própria pessoa informa nome e CPF ao confirmar.",
      "Em <b>Confirmar</b>, revise o <b>Resumo do Registro</b> e a <b>Data e hora da visita</b>. Escolha se liga o <b>Envio automático via WhatsApp</b> (manda o código na hora) e o <b>Lembrete de visita para o comprador</b>.",
      "Clique em <b>Criar Registro</b>. Aparece “Registro criado com sucesso!” com o número do protocolo e abre a página do registro.",
      "Se o envio automático estava desligado, use o quadro <b>Enviar para Confirmação</b>: <b>Enviar para Proprietário</b> e <b>Enviar para Comprador</b> mandam o código pelo WhatsApp de cada um.",
      "Depois que as partes confirmam, aparece <b>Baixar Comprovante PDF</b>. Os seus registros ficam em <b>Registros</b>. Enquanto não houver confirmação, dá para apagar pela lixeira (<b>Excluir registro</b>).",
    ],
    dica: "A sua comissão começa a ser protegida na visita: o registro mostra quem apresentou o imóvel e quando.",
    cuidado:
      "O registro ajuda a comprovar a visita, mas não garante a comissão nem o resultado de um processo. Confira o telefone antes de enviar: o código vai direto para o WhatsApp da pessoa.",
    prints: [
      {
        chave: "visita-6-novo-registro",
        legenda: "Novo Registro de Visita: escolha do modo e etapas.",
      },
      {
        chave: "visita-registro-enviar",
        legenda: "Registro criado: quadro Enviar para Confirmação.",
      },
    ],
    videos: [
      {
        chave: "visita",
        capa: "video-visita-capa",
        legenda: "Vídeo: como registrar uma visita com prova no Visita MAX.",
        duracao: "3:40",
      },
    ],
  },
  {
    id: "visita-pesquisa",
    sistema: "vis",
    icone: "📋",
    titulo: "Pesquisa Pós-Visita (opinião do comprador)",
    resumo: "Saber o que o comprador achou do imóvel.",
    papeis: ["c", "tl", "g", "a"],
    onde: "Visita MAX → Menu → <b>Pesquisas</b>",
    passos: [
      "A pesquisa é feita a partir da ficha da visita e pergunta ao <b>comprador</b> o que ele achou do imóvel.",
      "<b>Corretor:</b> abra <b>Pesquisas</b> (tela <b>Minhas Pesquisas</b>) para ver as suas.",
      "<b>Administrador, gestor e team leader:</b> abra <b>Pesquisas</b> (tela <b>Pesquisas Pós-Visita</b>), com Total, Respondidas e Pendentes e o filtro <b>Todas / Pendentes / Respondidas</b>.",
      "Use as respostas para conversar com o proprietário sobre preço e apresentação do imóvel.",
    ],
    dica: "Para mandar um relatório pronto ao proprietário, use o <b>Feedback ao proprietário</b> do ADM MAX.",
    prints: [
      {
        chave: "visita-prop-2-pesquisas-admin",
        legenda: "Pesquisas Pós-Visita (visão da imobiliária).",
      },
    ],
    videos: [
      {
        chave: "visita-pesquisa",
        capa: "video-visita-pesquisa-capa",
        legenda: "Vídeo: como ver as pesquisas pós-visita no Visita MAX.",
        duracao: "2:49",
      },
    ],
  },
  {
    id: "visita-gestao",
    sistema: "vis",
    icone: "🗂️",
    titulo: "Acompanhar as visitas da equipe",
    resumo: "A área da imobiliária no Visita MAX.",
    papeis: ["tl", "g", "a"],
    onde: "Visita MAX → ao entrar, você cai direto no <b>Dashboard</b> da imobiliária",
    passos: [
      "No <b>Dashboard</b> você vê Corretores, Registros/Mês, Pesquisas e o gráfico <b>Registros por Mês</b>.",
      "Em <b>Ações Rápidas</b>: <b>Ver todos os registros</b> e <b>Gerar relatório</b>.",
      "No menu: <b>Corretores</b>, <b>Registros de Visita</b>, <b>Relatórios</b> (filtros e evolução mensal), <b>Pesquisas</b> e <b>Agenda</b>.",
      "Em <b>Configurações</b> ficam os dados da empresa, notificações, integrações e o link de cadastro da imobiliária. Em <b>Assinatura</b>, o plano.",
      "Para cadastrar ou desligar corretor, use o ADM MAX. A tela Corretores tem o botão <b>Abrir o ADM MAX</b>.",
    ],
    cuidado:
      "No Visita MAX, gestor e team leader veem a imobiliária inteira, igual ao administrador. As <b>Equipes</b> do Visita não vêm do ADM e aparecem vazias.",
    prints: [
      {
        chave: "visita-gestao-1-empresa-admin",
        legenda: "Dashboard da imobiliária no Visita MAX.",
      },
    ],
    videos: [
      {
        chave: "visita-gestao",
        capa: "video-visita-gestao-capa",
        legenda: "Vídeo: como acompanhar as visitas da equipe no Visita MAX.",
        duracao: "3:02",
      },
    ],
  },
  {
    id: "estudo",
    sistema: "est",
    icone: "🔎",
    titulo: "Fazer um estudo de mercado",
    resumo: "Comparáveis, valor do m² e faixa de preço.",
    papeis: ["c", "tl", "g", "a"],
    onde: "Estudo de Mercado MAX (estudodemercadomax.com.br) → <b>Novo estudo</b> (no menu ou no botão <b>+ Novo estudo</b> do topo)",
    passos: [
      "Clique em <b>Novo estudo</b>. Abre a tela “Vamos analisar seu imóvel”.",
      "Dê um <b>Nome do estudo</b> e siga as 6 etapas: <b>1. Localização</b>, <b>2. Endereço</b>, <b>3. Características</b>, <b>4. Valores</b>, <b>5. Diferenciais</b>, <b>6. Portais</b>. Avance com <b>Próximo</b> e use <b>Voltar</b> para corrigir.",
      "Na Localização: CEP, Finalidade, Tipo do imóvel, Cidade, Estado e Bairro principal. Se quiser, ligue <b>Buscar também em bairros próximos</b> (até 3 km).",
      "Confira os comparáveis, o valor do m² e o peso de cada comparável (anúncio com mais de 120 dias pesa menos).",
      "Os seus estudos ficam em <b>Estudos</b>. Em <b>Comparativos</b> você compara estudos (precisa de pelo menos 2).",
    ],
    cuidado:
      "O estudo é uma opinião de mercado, não uma avaliação formal. Não prometa preço nem prazo de venda.",
    outrosPapeis:
      "Administrador, gestor e team leader também têm <b>Minha imobiliária</b> (abas Visão geral, Usuários, Equipes, Estudos). Gestor e TL têm ainda <b>Equipe</b>.",
    prints: [
      {
        chave: "estudo-4-novo-estudo",
        legenda: "Novo estudo: as 6 etapas.",
      },
    ],
    videos: [
      {
        chave: "estudo",
        capa: "video-estudo-capa",
        legenda: "Vídeo: como fazer um estudo de mercado, etapa por etapa.",
        duracao: "3:10",
      },
    ],
  },
  {
    id: "estudo-pdf",
    sistema: "est",
    icone: "🖨️",
    titulo: "Apresentar o estudo ao proprietário",
    resumo: "Modo cliente e PDF em A4.",
    papeis: ["c", "tl", "g", "a"],
    onde: "Estudo pronto → <b>Modo cliente</b> → <b>Imprimir / Baixar PDF</b> (botões no topo do relatório)",
    passos: [
      "Abra o estudo em <b>Estudos</b>. Abre o relatório do estudo.",
      "No topo, clique em <b>Modo cliente</b>. A tela passa a se chamar “Análise comparativa de mercado” e esconde os ajustes técnicos (ACM, critérios e lista de comparáveis).",
      "Apresente os comparáveis e o posicionamento de preço ao proprietário.",
      "Clique em <b>Imprimir / Baixar PDF</b>. Abre a janela de impressão do navegador: para guardar o arquivo, escolha <b>Salvar como PDF</b> no destino.",
      "Para voltar aos ajustes, clique em <b>Sair do modo cliente</b>.",
      "Os relatórios gerados ficam no menu <b>Relatórios</b>.",
    ],
    dica: "Use o estudo na reunião de captação: o proprietário entende o preço olhando imóveis reais parecidos com o dele.",
    prints: [
      {
        chave: "estudo-modo-cliente",
        legenda: "Modo cliente aberto num estudo.",
      },
    ],
    videos: [
      {
        chave: "estudo-pdf",
        capa: "video-estudo-pdf-capa",
        legenda: "Vídeo: modo cliente e PDF do estudo para o proprietário.",
        duracao: "2:15",
      },
    ],
  },
];

export const FAQ: WikiFaq[] = [
  {
    pergunta: "Onde informo o meu aniversário?",
    resposta:
      "No ADM MAX, em Meu acesso → Data de nascimento → Salvar. Os colegas veem só o dia e o mês, nos Aniversariantes do mês do Mural. Se preferir, peça à gestão para preencher em Usuários → Editar dados.",
  },
  {
    pergunta: "Preciso de três senhas?",
    resposta:
      "Não. O MAX não tem senha: você entra com a sua conta Google (o e-mail que a imobiliária cadastrou) nos três sistemas.",
  },
  {
    pergunta: "Esqueci a senha. E agora?",
    resposta:
      "A senha é a do Google. Recupere pelo Google. Se o e-mail cadastrado estiver errado, peça ao team leader, ao gestor ou ao administrador para corrigir em Usuários → Editar dados.",
  },
  {
    pergunta: "Um item sumiu do meu menu. E agora?",
    resposta:
      "Pode ser que o módulo esteja desligado para a sua imobiliária ou que o seu papel não tenha acesso. Quem liga os módulos é a equipe MAX: peça pelo Ajuda e sugestões.",
  },
  {
    pergunta: "Posso apagar uma venda que registrei errado?",
    resposta:
      "Só enquanto ela é rascunho (botão Excluir venda). Depois disso, peça o cancelamento por um chamado.",
  },
  {
    pergunta: "Meu gestor vê minhas comissões?",
    resposta:
      "Na tela Minha carreira, os valores são só seus. Gestores veem a produção da equipe nas telas Painel da Equipe e Desempenho.",
  },
  {
    pergunta: "O estudo de mercado vale como avaliação oficial?",
    resposta:
      "Não. Ele é uma opinião de mercado para orientar o preço. Avaliação formal é outro serviço.",
  },
];
