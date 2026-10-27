/**
 * Tela "Regras de papéis" (Usuários e perfis → Regras de papéis), pedido de Denis 27/10/2026 (t_37becd0c).
 *
 * SÓ DESCREVE as regras: não decide nada. A fonte da verdade continua sendo o código e o banco
 * (user-management-policy.ts, sale-permissions.ts, registrar-venda.ts, ocorrencias-concluidas.ts,
 * leads.ts, menu-lateral.ts, o gatilho validate_sale_status_transition, can_view_sale /
 * vendas_visiveis_ids, as funções lead_* e as políticas RLS).
 *
 * Para a tela não ficar desatualizada:
 * - os itens de menu e os papéis que cada um pode dar são CALCULADOS das mesmas funções do sistema
 *   (montarMenuLateral, grantableRoles);
 * - as frases marcadas com `regra` são conferidas por regras-papeis.test.ts contra as funções de
 *   permissão (REGRAS_CONFERIDAS): se uma permissão mudar e o texto não, o teste falha.
 */
import { ROLE_LABEL, type AppRole } from "@/lib/auth";
import { ALL_MANAGED_ROLES, grantableRoles, type ManagedRole } from "@/lib/user-management-policy";
import { getSaleRoleFlags, podeFinalizarOcorrencia } from "@/lib/sale-permissions";
import { registrarVendaAction } from "@/lib/registrar-venda";
import {
  podeImprimirOcorrenciasConcluidas,
  podeVerOcorrenciasConcluidas,
} from "@/lib/ocorrencias-concluidas";
import { podeAtenderLeads, podeVerPainelLeads } from "@/lib/leads";
import { podeAcessarCentralFinanceira } from "@/lib/financeiro-dashboard-calc";
import { podeAcessarPainelEquipe } from "@/lib/painel-equipe-calc";
import { podeAcessarProducaoPorPessoa } from "@/lib/producao-por-pessoa-calc";
import { montarMenuLateral } from "@/lib/menu-lateral";

/** Quem abre a tela: quem já administra Usuários e perfis como administrador (Denis, 27/10/2026).
 * O admin da plataforma dentro de uma imobiliária recebe os papéis admin/super_admin do contexto. */
export const PAPEIS_REGRAS_PAPEIS = ["admin", "super_admin"] as const;
export function podeVerRegrasPapeis(roles: readonly string[]): boolean {
  return roles.some((r) => (PAPEIS_REGRAS_PAPEIS as readonly string[]).includes(r));
}

export type AreaId =
  | "vendas"
  | "aprovacao"
  | "contratos"
  | "ocorrencias"
  | "financeiro"
  | "relatorios"
  | "leads"
  | "usuarios"
  | "configuracoes";

export const AREAS: { id: AreaId; titulo: string }[] = [
  { id: "vendas", titulo: "Vendas e captações" },
  { id: "aprovacao", titulo: "Aprovação e cancelamento de venda" },
  { id: "contratos", titulo: "Contratos e assinatura" },
  { id: "ocorrencias", titulo: "Ocorrências" },
  { id: "financeiro", titulo: "Financeiro e comissões" },
  { id: "relatorios", titulo: "Relatórios" },
  { id: "leads", titulo: "Leads e a IA de atendimento" },
  { id: "usuarios", titulo: "Usuários e equipes" },
  { id: "configuracoes", titulo: "Configurações" },
];

/** Permissões conferidas automaticamente contra as funções reais do sistema. */
export const REGRAS_CONFERIDAS = {
  registrar_venda: (r: ManagedRole) =>
    ["venda_padrao", "escolher"].includes(registrarVendaAction([r as AppRole])),
  registrar_lancamento: (r: ManagedRole) =>
    ["lancamento", "escolher"].includes(registrarVendaAction([r as AppRole])),
  etapas_gestor: (r: ManagedRole) => {
    const f = getSaleRoleFlags([r as AppRole], [], undefined);
    return f.isGestor || f.isAdminPrincipal;
  },
  etapas_juridico: (r: ManagedRole) => {
    const f = getSaleRoleFlags([r as AppRole], [], undefined);
    return f.isJuridico || f.isAdminPrincipal;
  },
  editar_venda_travada: (r: ManagedRole) => {
    const f = getSaleRoleFlags([r as AppRole], [], undefined);
    return f.isFinanceiro || f.isAdminLike;
  },
  concluir_ocorrencia: (r: ManagedRole) => {
    const f = getSaleRoleFlags([r as AppRole], [], undefined);
    return podeFinalizarOcorrencia(f.isFinanceiro, f.isAdminLike);
  },
  ocorrencias_concluidas: (r: ManagedRole) => podeVerOcorrenciasConcluidas([r]),
  imprimir_ocorrencias: (r: ManagedRole) => podeImprimirOcorrenciasConcluidas([r]),
  central_financeira: (r: ManagedRole) => podeAcessarCentralFinanceira([r]),
  producao_desempenho: (r: ManagedRole) => podeAcessarProducaoPorPessoa([r]),
  painel_equipe: (r: ManagedRole) => podeAcessarPainelEquipe([r]),
  atender_leads: (r: ManagedRole) => podeAtenderLeads([r]),
  painel_leads: (r: ManagedRole) => podeVerPainelLeads([r]),
  cadastrar_usuarios: (r: ManagedRole) => grantableRoles([r]).length > 0,
  conceder_admin: (r: ManagedRole) => grantableRoles([r]).includes("admin"),
} as const;
export type RegraId = keyof typeof REGRAS_CONFERIDAS;

/** Regras que TODO papel precisa citar (em "pode" ou "não pode"), para nenhum ficar sem resposta. */
export const REGRAS_OBRIGATORIAS: RegraId[] = [
  "registrar_venda",
  "etapas_gestor",
  "etapas_juridico",
  "concluir_ocorrencia",
  "ocorrencias_concluidas",
  "central_financeira",
  "atender_leads",
  "painel_leads",
  "cadastrar_usuarios",
];

export type Item = { texto: string; regra?: RegraId };
export type DetalheArea = { pode: Item[]; naoPode: Item[] };
export type RegraPapel = {
  papel: ManagedRole;
  resumo: string;
  areas: Record<AreaId, DetalheArea>;
};

const it = (texto: string, regra?: RegraId): Item => (regra ? { texto, regra } : { texto });
const area = (pode: Item[], naoPode: Item[] = []): DetalheArea => ({ pode, naoPode });

const NAO_CANCELA = it("Não cancela venda: só o Administrador da plataforma cancela.");
const NADA_CONFIG = area([], [it("Não acessa as configurações da imobiliária.")]);
const SEM_LEADS = area(
  [],
  [
    it("Não recebe nem atende leads.", "atender_leads"),
    it("Não abre o Painel de leads.", "painel_leads"),
  ],
);
const SEM_USUARIOS = area(
  [],
  [
    it("Não cadastra nem edita usuários e não gerencia equipes.", "cadastrar_usuarios"),
    it('Altera só os próprios dados, em "Meu acesso".'),
  ],
);
const SEM_FINANCEIRO = it(
  "Não abre a Central financeira, os Relatórios financeiros, o Comparativo 6% nem a Baixa de recebimentos.",
  "central_financeira",
);

// Peças repetidas entre gestor e team leader (mesmas regras de venda; muda só o alcance).
const LIDER_APROVACAO = (alcance: string) =>
  area(
    [
      it(
        `Aprova a venda e manda ao jurídico, ou devolve ao corretor para ajuste (${alcance}).`,
        "etapas_gestor",
      ),
      it("Venda registrada por ele mesmo pula a própria aprovação e vai direto ao jurídico."),
    ],
    [NAO_CANCELA],
  );
const LIDER_CONTRATOS = area(
  [
    it(
      "Confere o contrato feito pelo jurídico: manda ao corretor, devolve ao jurídico ou envia direto para assinatura.",
    ),
    it(
      "Escolhe como o contrato vai ser assinado (Clicksign ou papel, quando a Clicksign está ligada) e marca o contrato como assinado.",
    ),
  ],
  [it("Não monta o contrato (isso é do jurídico).", "etapas_juridico")],
);
const LIDER_OCORRENCIAS = area(
  [
    it("Preenche a ocorrência da venda e a envia ao financeiro enquanto ela está com ele."),
    it("Vê o relatório Ocorrências concluídas.", "ocorrencias_concluidas"),
    it("Imprime o documento completo das ocorrências concluídas.", "imprimir_ocorrencias"),
  ],
  [
    it(
      "Não conclui a ocorrência: isso é do financeiro ou do administrador.",
      "concluir_ocorrencia",
    ),
    it(
      "Depois que o financeiro aceita a ocorrência, a venda fica só para leitura para ele.",
      "editar_venda_travada",
    ),
  ],
);
const LIDER_FINANCEIRO = area(
  [it("Ajusta a divisão da comissão nas etapas em que a venda está com ele.")],
  [SEM_FINANCEIRO],
);

const ADMIN_VENDAS = area(
  [
    it("Vê todas as vendas e todas as captações exclusivas da imobiliária."),
    it(
      "Edita a venda em qualquer etapa, mesmo depois de travada pelo financeiro.",
      "editar_venda_travada",
    ),
    it(
      "Exclui venda em rascunho, arquiva em qualquer etapa (mesmo depois de assinada) e desarquiva.",
    ),
  ],
  [
    it(
      "Não registra venda só com este papel (precisa também do papel Corretor, Gestor ou Team leader).",
      "registrar_venda",
    ),
  ],
);
const ADMIN_OCORRENCIAS = area([
  it("Edita e conclui ocorrências, como o financeiro.", "concluir_ocorrencia"),
  it("Vê o relatório Ocorrências concluídas.", "ocorrencias_concluidas"),
]);
const ADMIN_FINANCEIRO = area([
  it(
    "Abre a Central financeira, os Relatórios financeiros, o Comparativo 6% e a Baixa de recebimentos.",
    "central_financeira",
  ),
  it("Edita a divisão da comissão da venda."),
]);
const ADMIN_RELATORIOS = area([
  it("Abre Desempenho e Produção por pessoa.", "producao_desempenho"),
  it("Abre o Painel da Equipe.", "painel_equipe"),
  it("Vendas por região e Mapa de captações."),
]);
const ADMIN_LEADS = (extra: Item[] = []) =>
  area(
    [
      it("Pode ser responsável por um lead e atendê-lo.", "atender_leads"),
      it("Vê todos os leads no Painel de leads, com telefone e e-mail.", "painel_leads"),
      it(
        "Cria lead, atribui, redistribui (inclusive do banco), reabre lead ganho ou perdido e usa o simulador.",
      ),
      it(
        "Configura a distribuição e os prazos, o nome, a mensagem de boas-vindas e o roteiro da atendente de IA, o formulário de teste e o link de retorno do WhatsApp.",
      ),
      ...extra,
    ],
    [
      it(
        "Não liga o módulo de leads, não escolhe o canal do WhatsApp e não libera números: isso é do Administrador da plataforma.",
      ),
    ],
  );

export const REGRAS_PAPEIS: RegraPapel[] = [
  {
    papel: "super_admin",
    resumo:
      "O dono da imobiliária no sistema: faz tudo o que o Administrador faz e ainda cobre as etapas de gestor e de jurídico na venda, dá o papel de Administrador e abre as Configurações.",
    areas: {
      vendas: ADMIN_VENDAS,
      aprovacao: area(
        [
          it(
            "Faz sozinho as etapas de gestor em qualquer venda da imobiliária: aprova, devolve para ajuste e confere o contrato. Serve para a imobiliária sem gestor ou quando o gestor está ausente.",
            "etapas_gestor",
          ),
        ],
        [NAO_CANCELA],
      ),
      contratos: area([
        it(
          "Faz as etapas do jurídico: inicia e anexa o contrato e sobe as certidões. Serve para a imobiliária sem jurídico ou quando o jurídico está ausente.",
          "etapas_juridico",
        ),
        it("Dá o OK no contrato no lugar do corretor."),
        it("Escolhe como o contrato vai ser assinado e marca o contrato como assinado."),
      ]),
      ocorrencias: ADMIN_OCORRENCIAS,
      financeiro: ADMIN_FINANCEIRO,
      relatorios: ADMIN_RELATORIOS,
      leads: ADMIN_LEADS([
        it("É avisado quando a atendente de IA encontra assunto sensível em um lead da imobiliária."),
      ]),
      usuarios: area(
        [
          it(
            "Cadastra usuários e dá qualquer papel, inclusive o de Administrador.",
            "conceder_admin",
          ),
          it(
            "Cadastra, edita, troca e-mail e senha e ativa ou desativa qualquer usuário da imobiliária.",
            "cadastrar_usuarios",
          ),
          it(
            "Só outro Administrador principal pode alterar a conta de um Administrador principal.",
          ),
          it("Cria e gerencia todas as equipes e os líderes auxiliares."),
        ],
        [
          it(
            'Não dá nem tira o papel "Administrador principal": só o Administrador da plataforma.',
          ),
          it("Não altera o próprio papel."),
          it('Não "entra como" outro usuário.'),
        ],
      ),
      configuracoes: area(
        [
          it(
            "Abre Configurações (vê se as Captações exclusivas estão ligadas) e configura a Assinatura digital (Clicksign).",
          ),
          it("Dados da imobiliária, Sugestões de regiões e Unidades da captação."),
        ],
        [it("Não liga nem desliga módulos: isso é do Administrador da plataforma.")],
      ),
    },
  },
  {
    papel: "admin",
    resumo:
      "Vê e opera tudo da imobiliária, cadastra usuários e cuida dos dados e dos relatórios. Não faz as etapas de gestor e de jurídico da venda.",
    areas: {
      vendas: ADMIN_VENDAS,
      aprovacao: area(
        [],
        [
          it(
            "Na tela da venda, não tem os botões das etapas do gestor (aprovar, devolver e conferir o contrato). Isso é do Gestor, do Team leader ou do Administrador principal.",
            "etapas_gestor",
          ),
          NAO_CANCELA,
        ],
      ),
      contratos: area(
        [
          it("Dá o OK no contrato no lugar do corretor."),
          it("Escolhe como o contrato vai ser assinado e marca o contrato como assinado."),
        ],
        [
          it(
            "Não monta o contrato (isso é do Jurídico ou do Administrador principal).",
            "etapas_juridico",
          ),
        ],
      ),
      ocorrencias: ADMIN_OCORRENCIAS,
      financeiro: ADMIN_FINANCEIRO,
      relatorios: ADMIN_RELATORIOS,
      leads: ADMIN_LEADS([
        it(
          "É avisado quando a atendente de IA encontra assunto sensível, um contato que não é cliente ou um lead sem responsável.",
        ),
      ]),
      usuarios: area(
        [
          it(
            "Cadastra usuários e dá qualquer papel, menos Administrador e Administrador principal.",
            "cadastrar_usuarios",
          ),
          it(
            "Edita, troca e-mail e senha e ativa ou desativa qualquer usuário da imobiliária, menos o Administrador principal.",
          ),
          it("Cria e gerencia todas as equipes e os líderes auxiliares."),
        ],
        [
          it("Não dá nem tira o papel de Administrador.", "conceder_admin"),
          it("Não altera o próprio papel."),
          it('Não "entra como" outro usuário.'),
        ],
      ),
      configuracoes: area(
        [it("Dados da imobiliária, Sugestões de regiões e Unidades da captação.")],
        [
          it(
            "Não abre Configurações nem Assinatura digital (Clicksign): só o Administrador principal.",
          ),
        ],
      ),
    },
  },
  {
    papel: "gestor",
    resumo:
      "Comanda a linha comercial: aprova as vendas e confere os contratos das equipes que lidera, cadastra corretores e acompanha todos os leads.",
    areas: {
      vendas: area(
        [
          it("Registra venda.", "registrar_venda"),
          it(
            "Vê as vendas dos corretores das equipes que lidera, das sub-equipes delas e das equipes em que é líder auxiliar.",
          ),
          it(
            "Edita essas vendas nas etapas que estão com ele e no rascunho dos corretores que lidera.",
          ),
          it(
            "Exclui rascunho de corretor que lidera, arquiva antes da assinatura e desarquiva as vendas que lidera.",
          ),
          it("Vê as captações exclusivas dos corretores que lidera."),
        ],
        [
          it(
            "Não vê vendas de equipes que não lidera. Para ver todas as vendas, a pessoa precisa do papel de Administrador.",
          ),
        ],
      ),
      aprovacao: LIDER_APROVACAO("vendas das equipes que lidera"),
      contratos: LIDER_CONTRATOS,
      ocorrencias: LIDER_OCORRENCIAS,
      financeiro: LIDER_FINANCEIRO,
      relatorios: area(
        [
          it("Painel da Equipe (das equipes que lidera).", "painel_equipe"),
          it("Desempenho e Produção por pessoa.", "producao_desempenho"),
          it("Vendas por região e Mapa de captações."),
        ],
        [it("Não abre os relatórios financeiros.")],
      ),
      leads: area(
        [
          it("Pode ser responsável por um lead e atendê-lo.", "atender_leads"),
          it(
            "Vê todos os leads da imobiliária no Painel de leads, com telefone e e-mail.",
            "painel_leads",
          ),
          it(
            "Cria lead, atribui e redistribui (inclusive do banco), reabre lead ganho ou perdido e usa o simulador.",
          ),
          it("Gera o link do Grupo ZAP (Canal Pro) e escolhe o modelo que ajuda a IA."),
          it(
            "É avisado quando a atendente de IA encontra assunto sensível, um contato que não é cliente ou um lead sem responsável.",
          ),
        ],
        [
          it(
            "Não altera a distribuição, os prazos nem o nome e as mensagens da atendente de IA (isso é do administrador).",
          ),
        ],
      ),
      usuarios: area(
        [
          it("Cadastra corretores.", "cadastrar_usuarios"),
          it("Edita os dados de qualquer corretor da imobiliária."),
          it("Troca e-mail e senha e ativa ou desativa só os corretores das equipes que lidera."),
          it("Cria a própria equipe e gerencia as equipes e sub-equipes que lidera."),
        ],
        [
          it("Não dá nem tira papéis e não cria administrador.", "conceder_admin"),
          it("Não altera contas de outros papéis: só de corretores."),
        ],
      ),
      configuracoes: NADA_CONFIG,
    },
  },
  {
    papel: "team_leader",
    resumo:
      "Líder de equipe: tem as mesmas regras de venda do gestor, mas só nas vendas, nos leads e nos corretores da própria equipe.",
    areas: {
      vendas: area(
        [
          it("Registra venda.", "registrar_venda"),
          it("Vê as vendas dos corretores da própria equipe e das sub-equipes."),
          it(
            "Edita essas vendas nas etapas que estão com ele e no rascunho dos corretores da equipe.",
          ),
          it(
            "Exclui rascunho de corretor da equipe, arquiva antes da assinatura e desarquiva as vendas da equipe.",
          ),
          it("Vê as captações exclusivas dos corretores da equipe."),
        ],
        [it("Não vê vendas de outras equipes.")],
      ),
      aprovacao: LIDER_APROVACAO("só vendas da própria equipe"),
      contratos: LIDER_CONTRATOS,
      ocorrencias: LIDER_OCORRENCIAS,
      financeiro: LIDER_FINANCEIRO,
      relatorios: area(
        [
          it("Painel da Equipe (só a própria equipe).", "painel_equipe"),
          it("Desempenho e Produção por pessoa.", "producao_desempenho"),
          it("Vendas por região e Mapa de captações."),
        ],
        [it("Não abre os relatórios financeiros.")],
      ),
      leads: area(
        [
          it("Pode ser responsável por um lead e atendê-lo.", "atender_leads"),
          it("Vê no Painel de leads só os leads da própria equipe.", "painel_leads"),
          it("Vê telefone e e-mail dos leads da equipe só depois que o corretor aceita."),
        ],
        [
          it("Não cria, não atribui, não redistribui e não reabre lead ganho ou perdido."),
          it("Não vê leads de outras equipes."),
        ],
      ),
      usuarios: area(
        [
          it(
            "Cadastra corretores, sempre na própria equipe. Antes, um administrador precisa criar a equipe dele.",
            "cadastrar_usuarios",
          ),
          it("Edita, troca e-mail e senha e ativa ou desativa só os corretores da própria equipe."),
          it("Gerencia a própria equipe e as sub-equipes em Equipes."),
        ],
        [
          it("Não dá nem tira papéis.", "conceder_admin"),
          it("Não altera contas de outros papéis: só de corretores."),
        ],
      ),
      configuracoes: NADA_CONFIG,
    },
  },
  {
    papel: "corretor",
    resumo:
      "Registra e acompanha as próprias vendas e captações e atende os leads que recebe. Vê só o que é dele.",
    areas: {
      vendas: area(
        [
          it("Registra venda.", "registrar_venda"),
          it(
            "Vê só as vendas em que participa: as que cadastrou e aquelas em que é captador, vendedor ou recebe comissão.",
          ),
          it("Edita a venda enquanto ela está em rascunho ou devolvida para ajuste."),
          it(
            "Exclui a venda que cadastrou enquanto ela é rascunho, arquiva antes da assinatura do contrato e desarquiva a que cadastrou.",
          ),
          it(
            "Captações exclusivas, Feedback ao proprietário, Oportunidades e Minha carreira (quando o módulo está ligado), só com as captações dele.",
          ),
        ],
        [it("Não vê vendas nem captações de outros corretores.")],
      ),
      aprovacao: area(
        [it("Envia a venda ao gestor para aprovação.")],
        [it("Não aprova venda.", "etapas_gestor"), NAO_CANCELA],
      ),
      contratos: area(
        [
          it(
            "Confere o contrato feito pelo jurídico: dá o OK ou devolve ao gestor pedindo ajuste.",
          ),
          it("Anexa documentos complementares durante a conferência do contrato."),
          it("Acompanha a assinatura."),
        ],
        [it("Não monta o contrato.", "etapas_juridico"), it("Não marca o contrato como assinado.")],
      ),
      ocorrencias: area(
        [it("Vê o relatório Ocorrências concluídas (só leitura).", "ocorrencias_concluidas")],
        [
          it("Não preenche nem conclui ocorrência.", "concluir_ocorrencia"),
          it(
            "Depois que o financeiro aceita a ocorrência, a venda fica só para leitura.",
            "editar_venda_travada",
          ),
        ],
      ),
      financeiro: area(
        [],
        [SEM_FINANCEIRO, it("Não altera a divisão da comissão na tela da venda.")],
      ),
      relatorios: area(
        [it("Vendas por região e Mapa de captações.")],
        [
          it("Não abre Desempenho nem Produção por pessoa.", "producao_desempenho"),
          it("Não abre o Painel da Equipe.", "painel_equipe"),
        ],
      ),
      leads: area(
        [
          it("Recebe leads em Meus leads, quando o módulo de leads está ligado.", "atender_leads"),
          it(
            "Recebe primeiro os leads dos imóveis que captou e entra no rodízio dos demais (forma padrão de distribuição).",
          ),
          it(
            "Só vê telefone e e-mail do lead depois de aceitar. Tem um prazo para aceitar (padrão de 24 h); sem o aceite, o lead passa ao próximo do rodízio.",
          ),
          it(
            'Depois de aceitar, tem 7 dias para a 1ª interação e pode ficar até 30 dias sem interagir (prazos padrão). Passou disso, o lead volta ao banco "Leads da imobiliária".',
          ),
          it("Pega para si um lead do banco (ele já fica aceito)."),
          it(
            "Vê a conversa e o resumo da atendente de IA depois de aceitar e pode parar a IA nesse lead.",
          ),
        ],
        [
          it("Não vê leads de outros corretores e não abre o Painel de leads.", "painel_leads"),
          it("Não atribui nem redistribui leads e não reabre lead ganho ou perdido."),
        ],
      ),
      usuarios: SEM_USUARIOS,
      configuracoes: NADA_CONFIG,
    },
  },
  {
    papel: "financeiro",
    resumo:
      "Cuida do dinheiro: analisa e conclui as ocorrências e controla comissões e recebimentos de todas as vendas.",
    areas: {
      vendas: area(
        [
          it("Vê todas as vendas da imobiliária."),
          it("Edita a venda em qualquer etapa, mesmo depois de travada.", "editar_venda_travada"),
        ],
        [it("Não registra venda.", "registrar_venda")],
      ),
      aprovacao: area([], [it("Não aprova venda.", "etapas_gestor"), NAO_CANCELA]),
      contratos: area([], [it("Não monta nem confere o contrato.", "etapas_juridico")]),
      ocorrencias: area([
        it("Analisa a ocorrência e a conclui ou devolve ao gestor.", "concluir_ocorrencia"),
        it("Reabre uma ocorrência já concluída."),
        it("Na venda de lançamento, devolve ao responsável para ajuste."),
        it("Vê o relatório Ocorrências concluídas.", "ocorrencias_concluidas"),
      ]),
      financeiro: area([
        it(
          "Abre a Central financeira, os Relatórios financeiros, o Comparativo 6% e a Baixa de recebimentos.",
          "central_financeira",
        ),
        it("Edita a divisão da comissão da venda."),
      ]),
      relatorios: area(
        [
          it("Desempenho e Produção por pessoa.", "producao_desempenho"),
          it("Vendas por região e Mapa de captações."),
        ],
        [it("Não abre o Painel da Equipe.", "painel_equipe")],
      ),
      leads: SEM_LEADS,
      usuarios: SEM_USUARIOS,
      configuracoes: NADA_CONFIG,
    },
  },
  {
    papel: "juridico",
    resumo:
      "Cuida do contrato: recebe a venda aprovada pelo gestor, monta o contrato e prepara a assinatura.",
    areas: {
      vendas: area(
        [it("Vê as vendas da imobiliária a partir da aprovação do gestor.")],
        [
          it("Não registra venda.", "registrar_venda"),
          it(
            "Não vê rascunhos nem vendas ainda não aprovadas pelo gestor. A exceção é a venda que já passou pelo jurídico e voltou para ajuste.",
          ),
        ],
      ),
      aprovacao: area(
        [it("Devolve a venda ao gestor ou ao corretor quando falta alguma coisa.")],
        [it("Não aprova venda.", "etapas_gestor"), NAO_CANCELA],
      ),
      contratos: area(
        [
          it(
            "Inicia o contrato, anexa o arquivo e o envia ao gestor para conferência.",
            "etapas_juridico",
          ),
          it("Sobe as certidões."),
          it(
            "Escolhe como o contrato vai ser assinado depois do OK do corretor e sobe o contrato assinado em papel.",
          ),
        ],
        [
          it(
            "Não marca o contrato como assinado (isso é do gestor, do team leader ou do administrador).",
          ),
        ],
      ),
      ocorrencias: area(
        [it("Vê o relatório Ocorrências concluídas.", "ocorrencias_concluidas")],
        [it("Não preenche nem conclui ocorrência.", "concluir_ocorrencia")],
      ),
      financeiro: area([], [SEM_FINANCEIRO]),
      relatorios: area(
        [it("Vendas por região e Mapa de captações.")],
        [
          it(
            "Não abre Desempenho, Produção por pessoa nem o Painel da Equipe.",
            "producao_desempenho",
          ),
        ],
      ),
      leads: SEM_LEADS,
      usuarios: SEM_USUARIOS,
      configuracoes: NADA_CONFIG,
    },
  },
  {
    papel: "lancamento",
    resumo:
      "Registra vendas de lançamento (empreendimentos) num fluxo próprio, sem documentos, jurídico nem contrato.",
    areas: {
      vendas: area(
        [
          it("Registra venda de lançamento.", "registrar_lancamento"),
          it("Edita a venda de lançamento enquanto ela está em rascunho ou devolvida para ajuste."),
          it("Vê as vendas de lançamento que registrou."),
        ],
        [
          it("Não registra venda padrão: só lançamento.", "registrar_venda"),
          it("Não vê vendas de outras pessoas."),
        ],
      ),
      aprovacao: area(
        [
          it(
            "Envia a venda de lançamento direto para análise do financeiro (não passa pelo gestor).",
          ),
        ],
        [it("Não aprova venda.", "etapas_gestor"), NAO_CANCELA],
      ),
      contratos: area(
        [],
        [it("A venda de lançamento não passa por jurídico nem por contrato.", "etapas_juridico")],
      ),
      ocorrencias: area(
        [it("Vê o relatório Ocorrências concluídas.", "ocorrencias_concluidas")],
        [it("Não conclui ocorrência.", "concluir_ocorrencia")],
      ),
      financeiro: area(
        [
          it(
            "Preenche a comissão da venda de lançamento enquanto ela está em rascunho ou devolvida.",
          ),
        ],
        [SEM_FINANCEIRO],
      ),
      relatorios: area(
        [it("Vendas por região e Mapa de captações.")],
        [
          it(
            "Não abre Desempenho, Produção por pessoa nem o Painel da Equipe.",
            "producao_desempenho",
          ),
        ],
      ),
      leads: SEM_LEADS,
      usuarios: SEM_USUARIOS,
      configuracoes: NADA_CONFIG,
    },
  },
  {
    papel: "staff",
    resumo:
      "Equipe de apoio: abre as telas comuns de consulta, sem operar vendas, financeiro ou leads.",
    areas: {
      vendas: area(
        [it("Abre a lista de Vendas, mas só vê as vendas em que aparece como participante.")],
        [it("Não registra venda.", "registrar_venda")],
      ),
      aprovacao: area([], [it("Não aprova venda.", "etapas_gestor"), NAO_CANCELA]),
      contratos: area([], [it("Não monta nem confere contrato.", "etapas_juridico")]),
      ocorrencias: area(
        [],
        [
          it("Não abre o relatório Ocorrências concluídas.", "ocorrencias_concluidas"),
          it("Não preenche nem conclui ocorrência.", "concluir_ocorrencia"),
        ],
      ),
      financeiro: area([], [SEM_FINANCEIRO]),
      relatorios: area(
        [it("Vendas por região e Mapa de captações.")],
        [
          it(
            "Não abre Desempenho, Produção por pessoa nem o Painel da Equipe.",
            "producao_desempenho",
          ),
        ],
      ),
      leads: SEM_LEADS,
      usuarios: SEM_USUARIOS,
      configuracoes: NADA_CONFIG,
    },
  },
];

/** Regras gerais que valem para todos. */
export const REGRAS_GERAIS: string[] = [
  "Cada imobiliária só enxerga os próprios dados.",
  "Uma pessoa pode ter mais de um papel. Nesse caso, ela soma o que cada papel permite.",
  "Ninguém altera o próprio papel, e nenhum papel da imobiliária move um usuário para outra imobiliária.",
  "Alguns itens só aparecem quando o módulo está ligado para a imobiliária: Captações exclusivas, Feedback, Oportunidades, Mural de Conquistas, Reservar sala e Leads.",
  "Quando o financeiro aceita a ocorrência, ou depois que ela é concluída, a venda fica travada: corretor, gestor e jurídico só leem; financeiro e administradores continuam editando.",
];

/** O que acontece quando alguém está ausente (regras do banco: is_lead_of e Administrador principal). */
export const REGRAS_AUSENCIA: string[] = [
  "Gestor ausente ou imobiliária sem gestor: o Administrador principal faz sozinho as etapas de gestor da venda.",
  "Jurídico ausente ou imobiliária sem jurídico: o Administrador principal faz as etapas do jurídico.",
  "Team leader ausente: o líder auxiliar da equipe e o líder da equipe-mãe (com papel Gestor ou Team leader) também aprovam e conferem as vendas da equipe.",
  "Corretor que não aceita o lead no prazo: o lead passa para o próximo corretor do rodízio.",
  "O papel Administrador (sem ser o principal) não substitui o gestor nem o jurídico nas etapas da venda.",
];

/** Só o Administrador da plataforma (fora da imobiliária). */
export const SO_PLATAFORMA: string[] = [
  "Cadastra, edita e suspende imobiliárias.",
  "Liga e desliga os módulos de cada imobiliária.",
  'Dá ou tira o papel "Administrador principal".',
  "Cancela venda, sempre com motivo e só depois do rascunho (rascunho se exclui, não se cancela).",
  '"Entra como" outro usuário para dar suporte, mas nunca como um Administrador principal.',
  "Define o canal do WhatsApp da atendente de IA, o número do chip e os números liberados para teste.",
  "Cadastra o Link do XML da imobiliária, de onde a IA lê os imóveis.",
  "Cuida dos Usuários da plataforma e da Central de chamados.",
  "A conta do Administrador da plataforma não pode ser alterada por ninguém da imobiliária.",
];

/** Atendente de IA: não é papel e não tem login. */
export const ATENDENTE_IA: string[] = [
  "Não é um usuário: não tem login nem papel e só funciona com o módulo de leads ligado.",
  "Conversa com o lead pelo WhatsApp, entende o que ele procura e passa a conversa para o corretor responsável.",
  "O corretor só vê o resumo e a conversa depois de aceitar o lead.",
  "Assunto sensível, contato que não é cliente ou lead sem responsável: quem tem o papel Gestor ou Administrador também é avisado. No assunto sensível, o Administrador principal também (cada pessoa recebe 1 aviso só).",
  "O corretor responsável (depois de aceitar), o gestor e o administrador podem parar a IA em um lead.",
  "O nome, a mensagem de boas-vindas e o roteiro são definidos pelo administrador. O canal e os números são definidos pelo Administrador da plataforma.",
];

export function rotuloPapel(papel: ManagedRole): string {
  return ROLE_LABEL[papel as AppRole];
}

/** Itens do menu que o papel abre (mesma função do menu lateral, com todos os módulos ligados). */
export function menuDoPapel(papel: ManagedRole): string[] {
  return montarMenuLateral({
    roles: [papel],
    platformAdmin: false,
    exclusiveVisible: true,
    roomVisible: true,
    feedbackVisible: true,
    opportunitiesVisible: true,
    achievementsVisible: true,
    leadsVisible: true,
    carreiraVisible: true,
  }).flatMap((g) => g.items.filter((i) => i.show).map((i) => i.label));
}

/** Itens que todos os papéis veem (bloco "Todo mundo logado"). */
export function menuComum(): string[] {
  const listas = ALL_MANAGED_ROLES.map(menuDoPapel);
  return listas[0].filter((l) => listas.every((x) => x.includes(l)));
}

/** Papéis que este papel pode dar ao cadastrar alguém (mesma regra do servidor). */
export function papeisQueConcede(papel: ManagedRole): string[] {
  return grantableRoles([papel]).map(rotuloPapel);
}
