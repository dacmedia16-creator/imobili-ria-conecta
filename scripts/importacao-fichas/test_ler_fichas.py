"""Testes locais (sem banco, sem IA) do leitor de fichas.
Rodar: python3 scripts/importacao-fichas/test_ler_fichas.py

Usa fichas .docx SINTÉTICAS, montadas aqui, no mesmo layout do modelo "OCORRÊNCIA DE COMPRA E VENDA".
Nenhum dado real de cliente."""
import csv
import io
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from pathlib import Path
from xml.sax.saxutils import escape

sys.path.insert(0, str(Path(__file__).parent))
import ler_fichas as lf  # noqa: E402

CPF_FALSO = "123.456.789-09"
EMAIL_FALSO = "fulano.teste@exemplo.com"
FONE_FALSO = "(15) 99876-5432"
RG_FALSO = "11.222.333-4"
CONTA_FALSA = "98765-4"


def _p(texto):
    return f"<w:p><w:r><w:t xml:space=\"preserve\">{escape(texto)}</w:t></w:r></w:p>"


def _tbl(linhas):
    out = ["<w:tbl>"]
    for linha in linhas:
        out.append("<w:tr>" + "".join(f"<w:tc>{_p(c)}</w:tc>" for c in linha) + "</w:tr>")
    out.append("</w:tbl>")
    return "".join(out)


def ficha(destino: Path, **kw):
    d = dict(codigo="ID 630000001-12", tempo="45 dias", data="10/03/2026", nf="( X ) Sim   (  ) Não",
             midia="Instagram", vendedor="Fulano Vendedor Teste", comprador="Beltrana Compradora Teste",
             anunciado="R$ 500.000,00", negociado="R$ 480.000,00", pct="6%", comissao="R$ 28.800,00",
             captador=("Ana Captadora Teste", "22,5%", "R$ 6.480,00"),
             ind_cap=("Não possui", "0%", "R$ 0,00"), coord_cap=("", "0%", "R$ 0,00"),
             vend=("Bruno Vendedor Teste", "22,5%", "R$ 6.480,00"),
             ind_vend=("Não possui", "0%", "R$ 0,00"), coord_vend=("Não possui", "0%", "R$ 0,00"),
             fin="FINANCIAMENTO (  ) SIM  ( X ) NÃO obrigatório ***",
             fin_linha=("R$ 0,00", "", "", "00/00/0000"),
             parcelas=[("R$ 14.400,00", "10/04/2026", "Pix"), ("R$ 14.400,00", "10/05/2026", "TED")],
             parceria=("Não possui", "xxx.xxx.xxx-xx", "0%", "R$ 0,00"))
    d.update(kw)
    corpo = [
        _p("IMOBILIÁRIA RE/MAX ÚNICA NEGÓCIOS IMOB. LTDA"),
        _p("OCORRÊNCIA DE COMPRA E VENDA"),
        _tbl([
            ["CÓDIGO DO IMÓVEL", "TEMPO DE VENDA", "DATA DE ASSINATURA ", "NOTA FISCAL obrigatório ***", "MÍDIA"],
            [d["codigo"], d["tempo"], d["data"], d["nf"], d["midia"]],
            [f"Nome do vendedor: {d['vendedor']}", f"E-mail: {EMAIL_FALSO}"],
            [f"CPF/CNPJ: {CPF_FALSO}", f"RG: {RG_FALSO}", f"Celular: {FONE_FALSO}"],
            [""],
            [f"Nome do comprador: {d['comprador']}", f"E-mail : {EMAIL_FALSO}"],
            [f"CPF/CNPJ: {CPF_FALSO}", f"RG: {RG_FALSO}", f"Celular: {FONE_FALSO}"],
        ]),
        _p("RESUMO DA TRANSAÇÃO"),
        _tbl([
            ["VALOR ANUNCIADO", "VALOR NEGOCIADO", "PERCENTUAL", "VALOR DA COMISSÃO"],
            [d["anunciado"], d["negociado"], d["pct"], d["comissao"]],
            ["Corretor (a) /captador (a)", "Comissão %", "Comissão $"], list(d["captador"]),
            ["Corretor (a) /indicador (a)", "Comissão %", "Comissão $"], list(d["ind_cap"]),
            ["Coordenador (captador) ", "Comissão %", "Comissão $"], list(d["coord_cap"]),
            ["Corretor (a) /vendedor (a)", "Comissão %", "Comissão $"], list(d["vend"]),
            ["Corretor (a) /indicador(a)", "Comissão %", "Comissão $"], list(d["ind_vend"]),
            ["Coordenador (vendedor)", "Comissão %", "Comissão $"], list(d["coord_vend"]),
        ]),
        _p("DADOS DE FINANCIAMENTO  " + d["fin"]),
        _tbl([["FINANCIAMENTO $", "BANCO", "CORRESPONDENTE BANCÁRIO", "PREVISÃO DA LIBERAÇÃO DO CRÉDITO"],
              list(d["fin_linha"])]),
        _p("PREVISÃO DE RECEBIMENTO DA COMISSÃO"),
        _tbl(sum(([[f"{i}ª parcela", "Data", "Forma de pagamento"], list(par)]
                  for i, par in enumerate(d["parcelas"], start=1)), [])),
        _p("PARCERIA"),
        _tbl([["CORRETOR (A)/ IMOBILIÁRIA", "CPF/CNPJ", "PERCENTUAL", "VALOR DA COMISSÃO"], list(d["parceria"]),
              ["Dados bancário", "Banco", "Agência", "Conta"], ["Banco Teste", "0001", "1234", CONTA_FALSA]]),
    ]
    xml = ("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
           "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>"
           + "".join(corpo) + "</w:body></w:document>")
    with zipfile.ZipFile(destino, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", xml)
    return destino


USUARIOS = [
    {"id": "u-ana", "nome": "Ana Captadora Teste", "ativo": "true"},
    {"id": "u-bruno", "nome": "Bruno Vendedor da Silva Teste", "ativo": "true"},
    {"id": "u-outro", "nome": "Carlos Outro Nome", "ativo": "true"},
]


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def avaliar(self, usuarios=USUARIOS, vendas=None, **kw):
        f = lf.extrair(ficha(self.dir / "f.docx", **kw))
        row, probs = lf.avaliar(f, usuarios, vendas)
        return f, row, probs

    def msgs(self, probs, gravidade=None):
        return " || ".join(m for g, _, m in probs if gravidade in (None, g))


class Extracao(Base):
    def test_ficha_ok_fica_pronta(self):
        f, row, probs = self.avaliar()
        self.assertEqual(row["codigo_interno"], "630000001-12")
        self.assertEqual(row["data_assinatura"], "2026-03-10")
        self.assertEqual(row["mes_comercial"], "2026-03")
        self.assertEqual(row["valor_total_comissao"], "28800,00")
        self.assertEqual(row["modalidade"], "padrao")
        self.assertEqual(row["financiamento"], "não")
        self.assertEqual(row["nota_fiscal_obrigatoria"], "sim")
        self.assertEqual(row["corretor_captador_id"], "u-ana")
        self.assertEqual(row["saldo_imobiliaria_estimado"], "15840,00")
        self.assertEqual(row["qtd_erros"], 0, self.msgs(probs))
        # Bruno: nome curto contido no nome completo -> sugestão, pede confirmação
        self.assertEqual(row["corretor_vendedor_conferencia"], "sugestao")
        self.assertEqual(row["situacao_importacao"], "PRONTA — confirmar avisos")

    def test_tabela_de_parceria_nao_apaga_captador(self):
        f, row, _ = self.avaliar()
        self.assertEqual(f.part["captador"].nome, "Ana Captadora Teste")
        self.assertEqual(f.part["captador"].valor, 6480.0)

    def test_valores_com_zero_estranho(self):
        self.assertEqual(lf.valor_br("R$ 0.000,00"), 0.0)
        self.assertEqual(lf.valor_br("R$ 000,00"), 0.0)
        self.assertEqual(lf.valor_br("R$ 1.650,00"), 1650.0)
        self.assertEqual(lf.valor_br("R$ 75.000"), 75000.0)
        self.assertIsNone(lf.valor_br(""))

    def test_parceria(self):
        _, row, probs = self.avaliar(parceria=("Imob Parceira Teste", CPF_FALSO, "3%", "R$ 14.400,00"),
                                     parcelas=[("R$ 14.400,00", "10/04/2026", "Pix")])
        self.assertEqual(row["parceria_nome"], "Imob Parceira Teste")
        self.assertEqual(row["comissao_propria"], "14400,00")
        self.assertIn("não diz se é imobiliária externa ou RE/MAX externa", self.msgs(probs, lf.AVISO))


class Validacoes(Base):
    def test_data_com_ano_de_tres_digitos(self):
        _, row, probs = self.avaliar(data="19/06/026")
        self.assertEqual(row["data_assinatura"], "")
        self.assertIn('data "19/06/026" com ano inválido', self.msgs(probs, lf.ERRO))
        self.assertIn("talvez 19/06/2026", self.msgs(probs, lf.ERRO))

    def test_data_inexistente_e_vazia(self):
        _, _, probs = self.avaliar(data="31/02/2026")
        self.assertIn("não existe no calendário", self.msgs(probs, lf.ERRO))
        _, _, probs = self.avaliar(data="")
        self.assertIn("data de assinatura vazia", self.msgs(probs, lf.ERRO))

    def test_participantes_passam_da_comissao(self):
        _, _, probs = self.avaliar(captador=("Ana Captadora Teste", "60%", "R$ 20.000,00"),
                                   vend=("Bruno Vendedor Teste", "50%", "R$ 10.000,00"))
        self.assertIn("passa da comissão total", self.msgs(probs, lf.ERRO))

    def test_percentual_nao_bate_com_valor(self):
        _, _, probs = self.avaliar(vend=("Bruno Vendedor Teste", "55%", "R$ 6.480,00"))
        self.assertIn("vale o valor em R$", self.msgs(probs, lf.AVISO))

    def test_soma_parcelas_diferente(self):
        _, _, probs = self.avaliar(parcelas=[("R$ 10.000,00", "10/04/2026", "Pix")])
        self.assertIn("soma das parcelas (R$ 10000,00) diferente", self.msgs(probs, lf.ERRO))

    def test_parcelas_com_data_repetida(self):
        _, _, probs = self.avaliar(parcelas=[("R$ 14.400,00", "10/04/2026", "Pix"),
                                             ("R$ 14.400,00", "10/04/2026", "Pix")])
        self.assertIn("com a mesma data", self.msgs(probs, lf.AVISO))

    def test_parcela_sem_forma(self):
        _, _, probs = self.avaliar(parcelas=[("R$ 28.800,00", "10/04/2026", "")])
        self.assertIn("1ª parcela sem forma", self.msgs(probs, lf.ERRO))

    def test_corretor_desconhecido(self):
        _, row, probs = self.avaliar(captador=("Zuleica Inexistente", "22,5%", "R$ 6.480,00"))
        self.assertIn('captador "Zuleica Inexistente" não encontrado', self.msgs(probs, lf.ERRO))
        self.assertEqual(row["corretor_captador_id"], "")

    def test_codigo_invalido(self):
        _, _, probs = self.avaliar(codigo="ID 63000000112")
        self.assertIn("sem hífen", self.msgs(probs, lf.ERRO))
        _, _, probs = self.avaliar(codigo="")
        self.assertIn("código do imóvel vazio", self.msgs(probs, lf.ERRO))

    def test_obrigatorios_vazios(self):
        _, _, probs = self.avaliar(comprador="", midia="", nf="(  ) Sim   (  ) Não",
                                   fin="FINANCIAMENTO (  ) SIM  (   ) NÃO")
        e = self.msgs(probs, lf.ERRO)
        for trecho in ("nome do comprador vazio", "mídia vazia", "nota fiscal", "financiamento: nenhuma opção"):
            self.assertIn(trecho, e)

    def test_midia_com_erro_de_digitacao(self):
        _, row, probs = self.avaliar(midia="Intagram")
        self.assertEqual(row["midia"], "Instagram")
        self.assertIn("provável erro de digitação", self.msgs(probs, lf.AVISO))

    def test_lancamento_pelo_tempo_de_venda(self):
        _, row, probs = self.avaliar(tempo="LANÇAMENTO")
        self.assertEqual(row["modalidade"], "lancamento")
        self.assertIn("não tem captador nessa modalidade", self.msgs(probs, lf.AVISO))


class Duplicidade(Base):
    def vendas(self, data="2026-03-10", valor="480000.00", codigo="630000001-12"):
        return lf.preparar_vendas([{"sale_id": "s-1", "status": "ocorrencia_concluida", "codigo_interno": codigo,
                                    "data_occ": data, "valor_sale": valor}])

    def test_ja_existe(self):
        _, row, probs = self.avaliar(vendas=self.vendas())
        self.assertEqual(row["duplicidade"], "JÁ EXISTE")
        self.assertEqual(row["situacao_importacao"], "DUPLICADA — não importar")

    def test_mesmo_codigo_outra_data(self):
        _, row, probs = self.avaliar(vendas=self.vendas(data="2026-05-01"))
        self.assertEqual(row["duplicidade"], "mesmo código, outra data/valor")
        self.assertIn("confirmar se é outra venda", self.msgs(probs, lf.AVISO))

    def test_nao_existe(self):
        _, row, _ = self.avaliar(vendas=self.vendas(codigo="630000999-1"))
        self.assertEqual(row["duplicidade"], "não")

    def test_duplicada_dentro_do_lote(self):
        ficha(self.dir / "a.docx")
        ficha(self.dir / "b.docx")
        saida = self.dir / "out"
        with redirect_stdout(io.StringIO()):
            lf.main([str(self.dir), "--saida", str(saida)])
        with open(saida / "previa.csv", encoding="utf-8-sig") as fh:
            linhas = list(csv.DictReader(fh, delimiter=";"))
        self.assertEqual(sum(r["situacao_importacao"].startswith("DUPLICADA NO LOTE") for r in linhas), 1)


class LGPD(Base):
    def test_nenhum_dado_pessoal_na_saida(self):
        ficha(self.dir / "a.docx", parceria=("Imob Parceira Teste", CPF_FALSO, "3%", "R$ 14.400,00"),
              parcelas=[("R$ 14.400,00", "10/04/2026", "Pix")])
        saida = self.dir / "out"
        buf = io.StringIO()
        with redirect_stdout(buf):
            lf.main([str(self.dir / "a.docx"), "--saida", str(saida)])
        texto = buf.getvalue() + (saida / "previa.csv").read_text("utf-8-sig") + (
            saida / "problemas.csv").read_text("utf-8-sig")
        for proibido in (CPF_FALSO, "12345678909", EMAIL_FALSO, FONE_FALSO, "99876", RG_FALSO, CONTA_FALSA,
                         "Banco Teste"):
            self.assertNotIn(proibido, texto)
        self.assertIn("Fulano Vendedor Teste", texto)  # o nome continua

    def test_extrator_nao_guarda_documento(self):
        f = lf.extrair(ficha(self.dir / "a.docx"))
        self.assertNotIn(CPF_FALSO, repr(f))
        self.assertNotIn(EMAIL_FALSO, repr(f))
        self.assertNotIn(FONE_FALSO, repr(f))
        self.assertFalse(f.vendedor_juridica)  # só o tipo de pessoa é derivado

    def test_nome_com_documento_colado_e_limpo(self):
        self.assertEqual(lf.limpa_nome("Fulano de Tal 123.456.789-09"), "Fulano de Tal")
        self.assertIsNone(lf.limpa_nome("Não possui"))
        self.assertIsNone(lf.limpa_nome("Xxxx"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
