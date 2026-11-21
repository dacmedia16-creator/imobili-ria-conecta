// Pré-visualização do editor: TODOS os dados são fictícios, independentemente da imobiliária ativa.
import {
  camposIniciais,
  montarTextoModelo,
  type LocacaoBase,
  type Montagem,
} from "./locacao-montagem";
import { chaveBaseModelo, type ModeloContrato } from "./locacao-modelos";

export function textoTesteModelo(
  modelo: ModeloContrato,
  tipo: "residencial" | "comercial",
): string[] {
  const chave = chaveBaseModelo(modelo.chave);
  const dados = {
    prop_nome: "LOCADORA FICTÍCIA",
    prop_cpf: "CPF FICTÍCIO",
    prop_rg: "RG FICTÍCIO",
    prop_nacionalidade: "brasileira",
    prop_estado_civil: "solteira",
    prop_profissao: "professora",
    prop_endereco: "Rua Fictícia, 1",
    loc_nome: "LOCATÁRIO FICTÍCIO",
    loc_cpf: "CPF FICTÍCIO",
    loc_rg: "RG FICTÍCIO",
    loc_nacionalidade: "brasileiro",
    loc_estado_civil: "solteiro",
    loc_profissao: "professor",
    loc_endereco: "Rua Fictícia, 2",
    fia_nome: "FIADOR FICTÍCIO",
    fia_cpf: "CPF FICTÍCIO",
    fia_rg: "RG FICTÍCIO",
    fia_nacionalidade: "brasileiro",
    fia_estado_civil: "solteiro",
    fia_profissao: "professor",
    fia_endereco: "Rua Fictícia, 3",
    fia_matricula: "MATRÍCULA FICTÍCIA",
    fia_cartorio: "CARTÓRIO FICTÍCIO",
    imv_vagas: "uma",
    imv_inscricao: "INSCRIÇÃO FICTÍCIA",
    imv_energia: "ENERGIA FICTÍCIA",
    imv_agua: "ÁGUA FICTÍCIA",
    imv_gas: "GÁS FICTÍCIO",
    inicio: "2027-01-01",
    prazo_meses: "30",
    dia_vencimento: "10",
    cau_tipo: chave === "caucao_imovel" ? "imovel" : "dinheiro",
    cau_valor: "3000",
    cau_meses: "1",
    cau_forma: "depósito fictício",
    cau_favorecido: "IMOBILIÁRIA FICTÍCIA",
    cauc_nome: "CAUCIONANTE FICTÍCIO",
    cauc_cpf: "CPF FICTÍCIO",
    cauc_rg: "RG FICTÍCIO",
    cauc_nacionalidade: "brasileiro",
    cauc_estado_civil: "solteiro",
    cauc_profissao: "professor",
    cauc_endereco: "Rua Fictícia, 4",
    cauc_imovel_descricao: "imóvel fictício",
    cauc_imovel_matricula: "MATRÍCULA FICTÍCIA",
    cauc_imovel_cartorio: "CARTÓRIO FICTÍCIO",
    seg_seguradora: chave.startsWith("seguro_") ? chave.slice(7) : "",
    seg_apolice: "",
    loft_numero: "REFERÊNCIA FICTÍCIA",
  };
  const garantia =
    chave === "fiador"
      ? "fiador"
      : chave === "loft"
        ? "loft"
        : chave.startsWith("seguro_")
          ? "seguro_fianca"
          : "caucao";
  const base: LocacaoBase = {
    codigo: "CONTRATO-FICTÍCIO",
    endereco: "Rua Fictícia, 99",
    aluguel: 3000,
    taxaAdm: modelo.chave.endsWith("_intermediacao") ? 0 : 10,
    semAdministracao: modelo.chave.endsWith("_intermediacao"),
    tipo,
    garantia,
    ficha: { imovelId: "IMÓVEL FICTÍCIO", proprietario: { nome: dados.prop_nome } },
  };
  const m: Montagem = {
    campos: {
      prop_sexo: "feminino",
      loc_sexo: "masculino",
      fia_sexo: "masculino",
      fia_imovel_endereco: "Rua Fictícia, 3",
    },
    contrato: dados,
    administradora: {
      nome: "IMOBILIÁRIA FICTÍCIA",
      cnpj: "CNPJ FICTÍCIO",
      creci: "CRECI FICTÍCIO",
      cidade: "CIDADE FICTÍCIA",
      uf: "XX",
    },
  };
  const c = { ...camposIniciais(base, m), data: "2027-01-01" };
  return montarTextoModelo(base, m, c, modelo);
}
