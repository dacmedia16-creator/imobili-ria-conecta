#!/usr/bin/env python3
"""Leitor das fichas "OCORRÊNCIA DE COMPRA E VENDA" (.docx) -> planilha de PRÉVIA da importação.

FASE 1 — SOMENTE LEITURA. Não grava nada no ADM MAX e não usa IA: lê o XML do .docx de forma
determinística (só biblioteca padrão do Python, custo zero).

LGPD: o leitor NUNCA extrai CPF/CNPJ, RG, e-mail, celular nem dados bancários. Ele lê apenas as
células de nome, valores, datas e percentuais. Esses dados não vão para a prévia, log ou saída.

Uso
  python3 scripts/importacao-fichas/ler_fichas.py PASTA_OU_ARQUIVOS... --saida PASTA [opções]

Opções de conferência (todas somente leitura):
  --adm                 Lê usuários da Única e vendas já cadastradas direto do ADM MAX pela
                        Management API, endpoint read-only (credencial em arquivo, nunca impressa).
  --usuarios CSV        Alternativa offline: CSV com colunas id;nome;ativo.
  --vendas CSV          Alternativa offline: CSV com colunas sale_id;status;codigo;data;valor.

Saída (pasta --saida, fora do git):
  previa.csv     uma linha por venda, colunas no formato do fluxo de vendas do sistema;
  problemas.csv  uma linha por erro/aviso (arquivo, gravidade, campo, mensagem).
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import difflib
import hashlib
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
ORG_UNICA = "00000000-0000-4000-8000-000000000001"
REF_ADM = "xvvymgurpchhlmbpjbgc"
ENV_ADM = "/root/.config/max/adm-max-supabase-candidate.env"

# Mesmas opções aceitas pela constraint sales_midia_check / MIDIA_OPTIONS (src/lib/status.ts).
MIDIAS = ["Instagram", "Facebook", "Portal", "Site Remax", "Tráfego Pago", "C2S", "Indicação",
          "Placa", "Imovelweb", "Chaves na Mão", "Outro"]
# Mesmo formato da constraint sales_codigo_interno_formato.
CODIGO_RE = re.compile(r"^[0-9]{9}-[0-9]{1,3}$")
NAO_POSSUI = {"", "nao possui", "nao possui.", "nao", "n/a", "na", "-", "--", "xxx", "xxxx",
              "nenhum", "nenhuma", "sem", "nao tem"}

ERRO, AVISO = "ERRO", "AVISO"


# ----------------------------------------------------------------------------------------------
# utilitários de texto e números
# ----------------------------------------------------------------------------------------------
def sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", sem_acento(s or "").lower()).strip()


def limpa_nome(s: str | None) -> str | None:
    if s is None:
        return None
    s = re.sub(r"\s+", " ", s).strip(" :;-\t")
    if norm(s) in NAO_POSSUI or set(norm(s)) <= {"x", " ", ".", "-"}:
        return None
    # Defesa LGPD: nome nunca pode carregar número de documento, e-mail ou telefone.
    s = re.sub(r"[\w.+-]+@[\w-]+\.[\w.]+", "", s)
    s = re.sub(r"\d[\d.\-/() ]{6,}\d", "", s).strip(" :;-")
    return s or None


def valor_br(s: str | None) -> float | None:
    """'R$ 1.650,00' -> 1650.0 ; 'R$ 0.000,00' -> 0.0 ; vazio -> None."""
    if s is None:
        return None
    t = re.sub(r"[^\d,.\-]", "", s)
    if not re.search(r"\d", t):
        return None
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    elif t.count(".") > 1 or re.search(r"\.\d{3}$", t):
        t = t.replace(".", "")
    try:
        return round(float(t), 2)
    except ValueError:
        return None


def pct_br(s: str | None) -> float | None:
    if s is None or not re.search(r"\d", s):
        return None
    t = re.sub(r"[^\d,.]", "", s).replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None


@dataclass
class Data:
    bruto: str | None
    valor: dt.date | None = None
    vazio: bool = True
    problema: str | None = None
    sugestao: str | None = None


def data_br(s: str | None) -> Data:
    bruto = (s or "").strip()
    d = Data(bruto or None)
    if not bruto or re.fullmatch(r"0{1,2}/0{1,2}/0{2,4}", bruto) or set(bruto) <= {"_", " ", "/", "x", "X"}:
        return d
    d.vazio = False
    m = re.fullmatch(r"(\d{1,2})[/.\-](\d{1,2})[/.\-](\d+)", bruto)
    if not m:
        d.problema = f'data "{bruto}" fora do formato dd/mm/aaaa'
        return d
    dia, mes, ano_txt = int(m.group(1)), int(m.group(2)), m.group(3)
    if len(ano_txt) != 4:
        d.problema = f'data "{bruto}" com ano inválido ({ano_txt})'
        if len(ano_txt) == 3 and ano_txt.startswith("0"):
            d.sugestao = f"{dia:02d}/{mes:02d}/2{ano_txt}"
        elif len(ano_txt) == 2:
            d.sugestao = f"{dia:02d}/{mes:02d}/20{ano_txt}"
        return d
    try:
        d.valor = dt.date(int(ano_txt), mes, dia)
    except ValueError:
        d.problema = f'data "{bruto}" não existe no calendário'
    return d


def marcado(texto: str, rotulo: str) -> bool | None:
    """Lê '( X ) Sim  (  ) Não' -> True/False/None (nenhum ou os dois marcados)."""
    t = norm(texto)
    chk = r"(?:\(\s*[x✓✔]\s*\)|\[\s*[x✓✔]\s*\]|☒|☑)"
    sim = re.search(chk + r"\s*sim", t) is not None
    nao = re.search(chk + r"\s*nao", t) is not None
    if sim and not nao:
        return True
    if nao and not sim:
        return False
    return None


def fmt_valor(v: float | None) -> str:
    return "" if v is None else f"{v:.2f}".replace(".", ",")


def fmt_pct(v: float | None) -> str:
    return "" if v is None else (f"{v:g}".replace(".", ","))


# ----------------------------------------------------------------------------------------------
# leitura do .docx (somente o XML principal)
# ----------------------------------------------------------------------------------------------
def _texto(el) -> str:
    partes = []
    for n in el.iter():
        if n.tag == W + "t" and n.text:
            partes.append(n.text)
        elif n.tag in (W + "tab", W + "br", W + "cr"):
            partes.append(" ")
        elif n.tag == W + "p":
            partes.append(" ")
        elif n.tag == W + "sym":
            ch = n.get(W + "char", "").upper()
            if ch in ("F0FD", "F078", "F0FE", "2612", "2611"):
                partes.append("☒")
    return re.sub(r"[ \t\u00a0]+", " ", "".join(partes)).strip()


def ler_blocos(caminho: Path):
    """Retorna lista de blocos na ordem do documento: ('p', texto) ou ('t', [[celulas]])."""
    with zipfile.ZipFile(caminho) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    body = root.find(W + "body")
    blocos = []

    def visita(container):
        for el in container:
            if el.tag == W + "p":
                t = _texto(el)
                if t:
                    blocos.append(("p", t))
            elif el.tag == W + "tbl":
                linhas = []
                for tr in el.findall(W + "tr"):
                    linhas.append([_texto(tc) for tc in tr.findall(W + "tc")])
                blocos.append(("t", linhas))
            elif el.tag == W + "sdt":
                c = el.find(W + "sdtContent")
                if c is not None:
                    visita(c)

    visita(body)
    return blocos


# ----------------------------------------------------------------------------------------------
# extração dos campos (por rótulo, não por posição fixa)
# ----------------------------------------------------------------------------------------------
@dataclass
class Participante:
    nome: str | None = None
    pct: float | None = None
    valor: float | None = None


@dataclass
class Ficha:
    arquivo: str
    hash: str = ""
    titulo_ok: bool = False
    codigo_bruto: str | None = None
    tempo_venda: str | None = None
    data_assinatura: Data = field(default_factory=lambda: Data(None))
    nf: bool | None = None
    midia_bruta: str | None = None
    lancamento: bool | None = None
    lancamento_inferido: bool = False
    vendedor_nome: str | None = None
    comprador_nome: str | None = None
    vendedor_juridica: bool | None = None
    comprador_juridica: bool | None = None
    valor_anunciado: float | None = None
    valor_negociado: float | None = None
    pct_comissao: float | None = None
    valor_comissao: float | None = None
    part: dict = field(default_factory=dict)  # captador, indicador_captador, lider_captador, vendedor...
    financiamento: bool | None = None
    fin_valor: float | None = None
    fin_banco: str | None = None
    fin_correspondente: str | None = None
    fin_previsao: Data = field(default_factory=lambda: Data(None))
    parcelas: list = field(default_factory=list)  # [(n, valor, Data, forma)]
    parceria_nome: str | None = None
    parceria_pct: float | None = None
    parceria_valor: float | None = None


def _tipo_pessoa(celula_doc: str) -> bool | None:
    """True=jurídica, False=física, None=desconhecido. O documento em si é descartado."""
    dig = re.sub(r"\D", "", celula_doc or "")
    if len(dig) == 14:
        return True
    if len(dig) == 11:
        return False
    return None


def _apos_rotulo(celula: str) -> str:
    return celula.split(":", 1)[1] if ":" in celula else ""


def extrair(caminho: Path) -> Ficha:
    f = Ficha(arquivo=caminho.name)
    f.hash = hashlib.sha256(caminho.read_bytes()).hexdigest()[:16]
    blocos = ler_blocos(caminho)

    for tipo, conteudo in blocos:
        if tipo == "p":
            t = norm(conteudo)
            if "ocorrencia de compra e venda" in t:
                f.titulo_ok = True
            if "financiamento" in t and ("sim" in t or "nao" in t):
                f.financiamento = marcado(conteudo, "")
            if "lancamento" in t and ("sim" in t or "nao" in t):
                v = marcado(conteudo, "")
                if v is not None:
                    f.lancamento = v
            continue

        linhas = conteudo
        lado = None
        pendente = None  # papel do participante cujo valor vem na próxima linha
        i = 0
        while i < len(linhas):
            cel = linhas[i]
            n0 = norm(cel[0]) if cel else ""
            juntos = norm(" | ".join(cel))
            prox = linhas[i + 1] if i + 1 < len(linhas) else []

            # Cabeçalho do imóvel
            if "codigo do imovel" in juntos:
                cab = [norm(c) for c in cel]
                for j, h in enumerate(cab):
                    v = prox[j] if j < len(prox) else ""
                    if "codigo do imovel" in h:
                        f.codigo_bruto = v.strip() or None
                    elif "tempo de venda" in h:
                        f.tempo_venda = v.strip() or None
                    elif "data de assinatura" in h:
                        f.data_assinatura = data_br(v)
                    elif "nota fiscal" in h:
                        f.nf = marcado(v, "")
                    elif "midia" in h:
                        f.midia_bruta = v.strip() or None
                    elif "lancamento" in h:
                        f.lancamento = marcado(v, "")
                i += 2
                continue

            # Partes: só o NOME e o tipo de pessoa; documento/e-mail/celular são ignorados.
            if n0.startswith("nome do vendedor") or n0.startswith("nome do comprador"):
                nome = limpa_nome(_apos_rotulo(cel[0]))
                jur = None
                if prox and norm(prox[0]).startswith("cpf"):
                    jur = _tipo_pessoa(_apos_rotulo(prox[0]))
                if n0.startswith("nome do vendedor"):
                    f.vendedor_nome, f.vendedor_juridica = nome, jur
                else:
                    f.comprador_nome, f.comprador_juridica = nome, jur
                i += 1
                continue

            # Resumo da transação
            if "valor anunciado" in juntos and "valor negociado" in juntos:
                cab = [norm(c) for c in cel]
                for j, h in enumerate(cab):
                    v = prox[j] if j < len(prox) else ""
                    if "valor anunciado" in h:
                        f.valor_anunciado = valor_br(v)
                    elif "valor negociado" in h:
                        f.valor_negociado = valor_br(v)
                    elif "percentual" in h:
                        f.pct_comissao = pct_br(v)
                    elif "valor da comissao" in h:
                        f.valor_comissao = valor_br(v)
                i += 2
                continue

            # Participantes (cabeçalho "Corretor (a) /captador (a) | Comissão % | Comissão $")
            if (len(cel) >= 3 and "comissao" in norm(cel[-1]) and ("corretor" in n0 or "coordenador" in n0)
                    and "imobiliaria" not in n0):
                if "coordenador" in n0:
                    papel = "lider_vendedor" if "vendedor" in n0 else "lider_captador"
                elif "indicador" in n0:
                    papel = f"indicador_{lado or 'captador'}"
                elif "vendedor" in n0:
                    papel, lado = "vendedor", "vendedor"
                else:
                    papel, lado = "captador", "captador"
                if prox:
                    f.part[papel] = Participante(limpa_nome(prox[0]),
                                                 pct_br(prox[1]) if len(prox) > 1 else None,
                                                 valor_br(prox[2]) if len(prox) > 2 else None)
                i += 2
                continue

            # Financiamento
            if "financiamento $" in juntos or ("banco" in juntos and "correspondente" in juntos):
                cab = [norm(c) for c in cel]
                for j, h in enumerate(cab):
                    v = prox[j] if j < len(prox) else ""
                    if h.startswith("financiamento"):
                        f.fin_valor = valor_br(v)
                    elif h == "banco":
                        f.fin_banco = limpa_nome(v)
                    elif "correspondente" in h:
                        f.fin_correspondente = limpa_nome(v)
                    elif "previsao" in h:
                        f.fin_previsao = data_br(v)
                i += 2
                continue

            # Parcelas da comissão
            m = re.match(r"(\d)\s*[ªaº°]?\s*parcela", n0)
            if m and prox:
                f.parcelas.append((int(m.group(1)), valor_br(prox[0]),
                                   data_br(prox[1] if len(prox) > 1 else ""),
                                   (prox[2].strip() if len(prox) > 2 else "") or None))
                i += 2
                continue

            # Parceria: nome, %, valor. CPF/CNPJ e dados bancários são descartados.
            if "imobiliaria" in n0 and "corretor" in n0 and "percentual" in juntos:
                cab = [norm(c) for c in cel]
                for j, h in enumerate(cab):
                    v = prox[j] if j < len(prox) else ""
                    if "corretor" in h:
                        f.parceria_nome = limpa_nome(v)
                    elif "percentual" in h:
                        f.parceria_pct = pct_br(v)
                    elif "valor" in h:
                        f.parceria_valor = valor_br(v)
                i += 2
                continue
            i += 1

    if f.lancamento is None and f.tempo_venda and "lancamento" in norm(f.tempo_venda):
        f.lancamento = True
        f.lancamento_inferido = True
    return f


# ----------------------------------------------------------------------------------------------
# conferência com o ADM (somente leitura)
# ----------------------------------------------------------------------------------------------
SQL_USUARIOS = f"""
select p.id::text as id, p.nome, p.ativo
from public.profiles p
where p.organization_id = '{ORG_UNICA}' and p.nome is not null
order by p.nome
"""

SQL_VENDAS = f"""
select s.id::text as sale_id, s.status::text as status, s.modalidade,
  s.codigo_interno, s.imovel_id, o.codigo_imovel,
  o.data_assinatura as data_occ, s.data_assinatura as data_sale,
  (select (max(h.created_at) at time zone 'America/Sao_Paulo')::date
     from public.sale_status_history h where h.sale_id = s.id and h.para::text = 'contrato_assinado') as data_contrato,
  s.valor_negociado as valor_sale, o.valor_negociado as valor_occ
from public.sales s
left join public.occurrences o on o.sale_id = s.id
where s.organization_id = '{ORG_UNICA}'
"""


def consulta_adm(sql: str) -> list[dict]:
    caminho = os.environ.get("ADM_MAX_ENV", ENV_ADM)
    token = None
    for linha in Path(caminho).read_text().splitlines():
        if linha.startswith("SUPABASE_ACCESS_TOKEN="):
            token = linha.split("=", 1)[1].strip().strip("'\"")
    if not token:
        raise SystemExit("credencial do ADM não encontrada no arquivo protegido")
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{REF_ADM}/database/query/read-only",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                 "User-Agent": "max-importacao-fichas/1.0 (read-only)"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:  # nunca devolve cabeçalho nem token
        raise SystemExit(f"ADM respondeu HTTP {e.code} na consulta somente leitura") from None


def ler_csv(caminho: str) -> list[dict]:
    with open(caminho, encoding="utf-8-sig", newline="") as fh:
        amostra = fh.read(2048)
        fh.seek(0)
        sep = ";" if amostra.count(";") >= amostra.count(",") else ","
        return list(csv.DictReader(fh, delimiter=sep))


def chave_codigo(c: str | None) -> str:
    return re.sub(r"\D", "", c or "")


@dataclass
class VendaExistente:
    sale_id: str
    status: str
    codigos: set
    datas: set
    valores: list


def preparar_vendas(linhas: list[dict]) -> list[VendaExistente]:
    out = []
    for r in linhas:
        cods = {chave_codigo(r.get(k)) for k in ("codigo_interno", "imovel_id", "codigo_imovel", "codigo")}
        cods.discard("")
        datas = set()
        for k in ("data_occ", "data_sale", "data_contrato", "data"):
            v = r.get(k)
            if v:
                try:
                    datas.add(dt.date.fromisoformat(str(v)[:10]))
                except ValueError:
                    pass
        vals = []
        for k in ("valor_sale", "valor_occ", "valor"):
            v = r.get(k)
            if v not in (None, ""):
                try:
                    vals.append(float(str(v).replace(",", ".")))
                except ValueError:
                    pass
        out.append(VendaExistente(str(r.get("sale_id") or ""), str(r.get("status") or ""), cods, datas, vals))
    return out


# ----------------------------------------------------------------------------------------------
# correspondência de nomes com usuários da Única
# ----------------------------------------------------------------------------------------------
CONECTIVOS = {"de", "da", "do", "das", "dos", "e"}


def _tokens(s: str) -> list[str]:
    return [t for t in norm(s).split() if t not in CONECTIVOS]


def casar_usuario(nome: str, usuarios: list[dict]):
    """Retorna (situacao, usuario|None, score). situacao: exato | sugestao | nao_encontrado.

    exato: nome igual (sem acento/caixa). sugestao: mesmo primeiro nome e todos os sobrenomes de um
    contidos no outro, ou texto muito parecido (>= 0,85). Abaixo disso: nao_encontrado, informando o
    mais próximo só como pista (o id NÃO é preenchido)."""
    alvo_t = _tokens(nome)
    alvo = " ".join(alvo_t)
    melhor, score = None, 0.0
    for u in usuarios:
        ut = _tokens(u.get("nome") or "")
        un = " ".join(ut)
        if not un:
            continue
        if un == alvo:
            return "exato", u, 1.0
        s = difflib.SequenceMatcher(None, alvo, un).ratio()
        a, b = set(alvo_t), set(ut)
        if alvo_t and ut and alvo_t[0] == ut[0] and len(a & b) >= 2 and (a <= b or b <= a):
            s = max(s, 0.9)  # "Ana Souza" x "Ana Paula de Souza"
        ativo = str(u.get("ativo", "true")).lower() in ("true", "t", "1", "sim")
        if not ativo:
            s -= 0.05
        if s > score:
            melhor, score = u, s
    if melhor is not None and score >= 0.85:
        return "sugestao", melhor, round(score, 2)
    return "nao_encontrado", melhor, round(score, 2)


def casar_midia(bruta: str | None):
    if not bruta:
        return None, None
    alvo = norm(bruta)
    for m in MIDIAS:
        if norm(m) == alvo:
            return m, None
    aliases = {"insta": "Instagram", "face": "Facebook", "fb": "Facebook", "zap": "Portal",
               "viva real": "Portal", "olx": "Portal", "site": "Site Remax", "remax": "Site Remax",
               "trafego": "Tráfego Pago", "indicacao": "Indicação", "placa": "Placa"}
    for k, v in aliases.items():
        if alvo.startswith(k) or k in alvo:
            return v, f'mídia "{bruta}" interpretada como "{v}" — confirmar'
    prox = difflib.get_close_matches(alvo, [norm(m) for m in MIDIAS], n=1, cutoff=0.7)
    if prox:
        v = next(m for m in MIDIAS if norm(m) == prox[0])
        return v, f'mídia "{bruta}" interpretada como "{v}" (provável erro de digitação) — confirmar'
    return "Outro", f'mídia "{bruta}" não existe na lista do sistema; vai como "Outro" — confirmar'


# ----------------------------------------------------------------------------------------------
# validações + linha da prévia
# ----------------------------------------------------------------------------------------------
COLUNAS = [
    "arquivo", "hash_arquivo", "situacao_importacao", "qtd_erros", "qtd_avisos", "erros", "avisos",
    "duplicidade", "venda_existente_id",
    # sales / occurrences
    "codigo_interno", "codigo_original", "modalidade", "data_assinatura", "mes_comercial",
    "tempo_venda", "tempo_venda_dias", "nota_fiscal_obrigatoria", "midia", "midia_original",
    "vendedor_nome", "vendedor_tipo_pessoa", "comprador_nome", "comprador_tipo_pessoa",
    "valor_anunciado", "valor_negociado", "percentual_comissao", "valor_total_comissao",
    # divisão (mesmos nomes de colunas de sales)
    "corretor_captador", "corretor_captador_usuario", "corretor_captador_id", "corretor_captador_conferencia",
    "percentual_comissao_captador", "valor_comissao_captador",
    "indicador_captador", "indicador_captador_usuario", "indicador_captador_id", "valor_comissao_indicador_captador",
    "lider_captador_nome", "lider_captador_usuario", "lider_captador_id", "valor_comissao_lider_captador",
    "corretor_vendedor", "corretor_vendedor_usuario", "corretor_vendedor_id", "corretor_vendedor_conferencia",
    "percentual_comissao_vendedor", "valor_comissao_vendedor",
    "indicador_vendedor", "indicador_vendedor_usuario", "indicador_vendedor_id", "valor_comissao_indicador_vendedor",
    "lider_vendedor_nome", "lider_vendedor_usuario", "lider_vendedor_id", "valor_comissao_lider_vendedor",
    "parceria_tipo", "parceria_nome", "parceria_percentual", "parceria_valor",
    "comissao_propria", "saldo_imobiliaria_estimado",
    # sale_payment / occurrences
    "financiamento", "financiamento_valor", "financiamento_banco", "financiamento_correspondente",
    "financiamento_previsao",
    # previsão de recebimento (occurrences.prev_recebimento{,2,3}_*)
    "prev_recebimento_valor", "prev_recebimento_data", "prev_recebimento_forma",
    "prev_recebimento2_valor", "prev_recebimento2_data", "prev_recebimento2_forma",
    "prev_recebimento3_valor", "prev_recebimento3_data", "prev_recebimento3_forma",
    "soma_parcelas",
    # a preencher pelo financeiro (fase 2)
    "situacao_comissao", "recebido_em_parcela_1", "recebido_em_parcela_2", "recebido_em_parcela_3",
]

PAPEIS = [("captador", "corretor_captador"), ("indicador_captador", "indicador_captador"),
          ("lider_captador", "lider_captador"), ("vendedor", "corretor_vendedor"),
          ("indicador_vendedor", "indicador_vendedor"), ("lider_vendedor", "lider_vendedor")]
ROTULO = {"captador": "captador", "indicador_captador": "indicador do captador",
          "lider_captador": "coordenador do captador", "vendedor": "vendedor",
          "indicador_vendedor": "indicador do vendedor", "lider_vendedor": "coordenador do vendedor"}


def avaliar(f: Ficha, usuarios: list[dict] | None, vendas: list[VendaExistente] | None):
    probs: list[tuple[str, str, str]] = []  # (gravidade, campo, mensagem)

    def p(g, campo, msg):
        probs.append((g, campo, msg))

    row = {c: "" for c in COLUNAS}
    row.update(arquivo=f.arquivo, hash_arquivo=f.hash)

    if not f.titulo_ok:
        p(AVISO, "modelo", 'título "OCORRÊNCIA DE COMPRA E VENDA" não encontrado — confirme se é o modelo certo')

    # código do imóvel
    cod = None
    if not f.codigo_bruto:
        p(ERRO, "codigo_interno", "código do imóvel vazio (obrigatório)")
    else:
        m = re.search(r"\d[\d\s]*-\s*[0-9A-Za-z]{1,3}|\d{9,}", f.codigo_bruto)
        cand = re.sub(r"\s", "", m.group(0)) if m else f.codigo_bruto.strip()
        row["codigo_original"] = f.codigo_bruto
        if CODIGO_RE.fullmatch(cand):
            cod = cand
        elif re.fullmatch(r"\d{10,12}", cand):
            sug = f"{cand[:9]}-{cand[9:]}"
            p(ERRO, "codigo_interno", f'código "{f.codigo_bruto}" sem hífen; formato esperado 999999999-9 (talvez {sug})')
        else:
            p(ERRO, "codigo_interno", f'código "{f.codigo_bruto}" fora do formato do sistema (9 dígitos, hífen, 1 a 3 dígitos)')
    row["codigo_interno"] = cod or ""

    # modalidade
    modalidade = "lancamento" if f.lancamento else "padrao"
    row["modalidade"] = modalidade
    if f.lancamento_inferido:
        p(AVISO, "modalidade", f'ficha sem campo "Lançamento sim/não"; marcada como Lançamento porque o tempo de '
                               f'venda diz "{f.tempo_venda}" — confirmar')
    row["tempo_venda"] = f.tempo_venda or ""
    if f.tempo_venda and re.fullmatch(r"\d+\s*(dias?)?", norm(f.tempo_venda)):
        row["tempo_venda_dias"] = re.match(r"\d+", f.tempo_venda.strip()).group(0)

    # data de assinatura
    d = f.data_assinatura
    if d.vazio:
        p(ERRO, "data_assinatura", "data de assinatura vazia (obrigatória — define o mês da venda)")
    elif d.problema:
        p(ERRO, "data_assinatura", d.problema + (f"; talvez {d.sugestao} — confirmar" if d.sugestao else ""))
    else:
        row["data_assinatura"] = d.valor.isoformat()
        row["mes_comercial"] = d.valor.strftime("%Y-%m")
        if d.valor < dt.date(2026, 1, 1):
            p(AVISO, "data_assinatura", "assinatura antes de jan/2026 (fora do período pedido)")
        if d.valor > dt.date.today():
            p(ERRO, "data_assinatura", "data de assinatura no futuro")

    # NF e mídia
    if f.nf is None:
        p(ERRO, "nota_fiscal_obrigatoria", "nota fiscal: marque Sim ou Não (campo obrigatório)")
    else:
        row["nota_fiscal_obrigatoria"] = "sim" if f.nf else "não"
    midia, aviso_midia = casar_midia(f.midia_bruta)
    row["midia_original"] = f.midia_bruta or ""
    row["midia"] = midia or ""
    if not midia:
        p(ERRO, "midia", "mídia vazia (obrigatória para avançar a venda no sistema)")
    elif aviso_midia:
        p(AVISO, "midia", aviso_midia)

    # partes (só nome)
    row["vendedor_nome"] = f.vendedor_nome or ""
    row["comprador_nome"] = f.comprador_nome or ""
    tp = {True: "juridica", False: "fisica", None: ""}
    row["vendedor_tipo_pessoa"] = tp[f.vendedor_juridica]
    row["comprador_tipo_pessoa"] = tp[f.comprador_juridica]
    if not f.vendedor_nome:
        p(ERRO, "vendedor_nome", "nome do vendedor vazio (obrigatório)")
    if not f.comprador_nome:
        p(ERRO, "comprador_nome", "nome do comprador vazio (obrigatório)")

    # valores
    row["valor_anunciado"] = fmt_valor(f.valor_anunciado)
    row["valor_negociado"] = fmt_valor(f.valor_negociado)
    row["percentual_comissao"] = fmt_pct(f.pct_comissao)
    row["valor_total_comissao"] = fmt_valor(f.valor_comissao)
    if not f.valor_negociado:
        p(ERRO, "valor_negociado", "valor negociado vazio ou zero (obrigatório)")
    com = f.valor_comissao or 0.0
    if not com:
        if f.pct_comissao and f.valor_negociado:
            p(ERRO, "valor_total_comissao", "valor da comissão vazio; o sistema usa o valor em R$ como oficial")
        else:
            p(ERRO, "valor_total_comissao", "valor da comissão vazio (obrigatório)")
    elif f.pct_comissao and f.valor_negociado:
        calc = round(f.pct_comissao / 100 * f.valor_negociado, 2)
        if abs(calc - com) > 1.0:
            p(AVISO, "percentual_comissao",
              f"{fmt_pct(f.pct_comissao)}% de R$ {fmt_valor(f.valor_negociado)} = R$ {fmt_valor(calc)}, "
              f"mas a ficha diz R$ {fmt_valor(com)}; vale o valor em R$ (regra do sistema)")

    # participantes
    vals = {}
    for chave, col in PAPEIS:
        pt: Participante = f.part.get(chave) or Participante()
        nome = pt.nome
        valor = pt.valor or 0.0
        vals[chave] = valor
        col_nome = col if col.startswith(("corretor", "indicador")) else f"{col}_nome"
        row[col_nome] = nome or ""
        col_val = {"captador": "valor_comissao_captador", "vendedor": "valor_comissao_vendedor"}.get(
            chave, f"valor_comissao_{chave}")
        row[col_val] = fmt_valor(pt.valor) if (nome or valor) else ""
        if chave in ("captador", "vendedor"):
            row[f"percentual_comissao_{chave}"] = fmt_pct(pt.pct) if nome else ""
        if valor and not nome:
            p(ERRO, col, f"{ROTULO[chave]} com valor R$ {fmt_valor(valor)} mas sem nome")
        if nome and com and pt.pct is not None and pt.valor is not None:
            calc = round(pt.pct / 100 * com, 2)
            if abs(calc - pt.valor) > 0.05:
                real = round(pt.valor / com * 100, 2)
                p(AVISO, col, f"{ROTULO[chave]}: {fmt_pct(pt.pct)}% da comissão seria R$ {fmt_valor(calc)}, "
                              f"mas a ficha diz R$ {fmt_valor(pt.valor)} ({fmt_pct(real)}% da comissão); "
                              "vale o valor em R$ — confirmar")
        if nome:
            if usuarios is None:
                row[f"{col}_usuario"] = "(não conferido)"
            else:
                sit, u, sc = casar_usuario(nome, usuarios)
                if sit == "exato":
                    row[f"{col}_usuario"], row[f"{col}_id"] = u["nome"], u["id"]
                elif sit == "sugestao":
                    row[f"{col}_usuario"], row[f"{col}_id"] = u["nome"], u["id"]
                    p(AVISO, col, f'{ROTULO[chave]} "{nome}" não bate exatamente com um usuário da Única; '
                                  f'sugestão: "{u["nome"]}" (semelhança {sc}) — confirmar')
                else:
                    sug = f'; mais próximo: "{u["nome"]}" ({sc})' if u else ""
                    p(ERRO, col, f'{ROTULO[chave]} "{nome}" não encontrado entre os usuários da Única{sug}')
                if f"{col}_conferencia" in row:
                    row[f"{col}_conferencia"] = sit
    if not (f.part.get("captador") and f.part["captador"].nome) and not (
            f.part.get("vendedor") and f.part["vendedor"].nome):
        p(ERRO, "corretor", "nenhum corretor captador ou vendedor informado")

    # parceria
    parc = f.parceria_valor or 0.0
    if f.parceria_nome:
        row["parceria_nome"] = f.parceria_nome
        row["parceria_percentual"] = fmt_pct(f.parceria_pct)
        row["parceria_valor"] = fmt_valor(f.parceria_valor)
        p(AVISO, "parceria_tipo", "parceria: a ficha não diz se é imobiliária externa ou RE/MAX externa — informar")
        if not parc:
            p(ERRO, "parceria_valor", "parceria informada sem valor")
    elif parc:
        p(ERRO, "parceria_nome", f"parceria com valor R$ {fmt_valor(parc)} mas sem nome")

    # fechamento da comissão (mesma lógica de calcular_distribuicao_venda)
    for lado in ("captador", "vendedor"):
        if vals[f"indicador_{lado}"] - vals[lado] > 0.01:
            p(ERRO, f"indicador_{lado}", f"o indicador do {lado} ultrapassa a comissão do {lado} "
                                         f"em R$ {fmt_valor(vals[f'indicador_{lado}'] - vals[lado])}")
    propria = round(com - parc, 2)
    soma_part = vals["captador"] + vals["vendedor"] + vals["lider_captador"] + vals["lider_vendedor"]
    saldo = round(propria - soma_part, 2)
    row["comissao_propria"] = fmt_valor(propria) if com else ""
    row["saldo_imobiliaria_estimado"] = fmt_valor(saldo) if com else ""
    if com and parc - com > 0.01:
        p(ERRO, "parceria_valor", "a parceria ultrapassa a comissão total")
    if com and saldo < -0.01:
        p(ERRO, "comissao", f"comissão dos participantes (R$ {fmt_valor(soma_part)}) + parceria "
                            f"(R$ {fmt_valor(parc)}) passa da comissão total (R$ {fmt_valor(com)}) "
                            f"em R$ {fmt_valor(-saldo)}")

    # financiamento
    if f.financiamento is None:
        dica = " (valor R$ 0 e sem banco: provavelmente NÃO)" if not f.fin_valor and not f.fin_banco else ""
        p(ERRO, "financiamento", "financiamento: nenhuma opção Sim/Não marcada (campo obrigatório)" + dica)
    else:
        row["financiamento"] = "sim" if f.financiamento else "não"
        if f.financiamento and not f.fin_valor:
            p(AVISO, "financiamento_valor", "financiamento marcado como Sim mas sem valor")
    row["financiamento_valor"] = fmt_valor(f.fin_valor) if f.fin_valor else ""
    row["financiamento_banco"] = f.fin_banco or ""
    row["financiamento_correspondente"] = f.fin_correspondente or ""
    if f.fin_previsao.valor:
        row["financiamento_previsao"] = f.fin_previsao.valor.isoformat()
    elif f.fin_previsao.problema:
        p(AVISO, "financiamento_previsao", "previsão do crédito: " + f.fin_previsao.problema)

    # parcelas
    parcelas = sorted(f.parcelas, key=lambda x: x[0])
    validas = [x for x in parcelas if (x[1] or 0) > 0 or not x[2].vazio]
    if len(validas) > 3:
        p(ERRO, "parcelas", f"{len(validas)} parcelas; o sistema aceita no máximo 3")
    soma = 0.0
    datas_vistas: dict = {}
    for pos, (n, valor, data, forma) in enumerate(validas[:3], start=1):
        suf = "" if pos == 1 else str(pos)
        soma += valor or 0.0
        row[f"prev_recebimento{suf}_valor"] = fmt_valor(valor)
        row[f"prev_recebimento{suf}_forma"] = forma or ""
        if data.valor:
            row[f"prev_recebimento{suf}_data"] = data.valor.isoformat()
            datas_vistas.setdefault(data.valor, []).append(n)
        faltando = [nome for nome, ok in (("valor", (valor or 0) > 0), ("data", data.valor is not None),
                                          ("forma", bool(forma))) if not ok]
        if data.problema:
            p(ERRO, f"parcela_{n}", f"{n}ª parcela: {data.problema}")
        elif faltando:
            p(ERRO, f"parcela_{n}", f"{n}ª parcela sem {', '.join(faltando)} (o sistema exige valor, data e forma)")
    if com and not validas:
        p(ERRO, "parcelas", "nenhuma parcela de recebimento informada")
    for data, ns in datas_vistas.items():
        if len(ns) > 1:
            p(AVISO, "parcelas", f"parcelas {', '.join(f'{n}ª' for n in ns)} com a mesma data "
                                 f"({data.strftime('%d/%m/%Y')}) — confirmar")
    row["soma_parcelas"] = fmt_valor(round(soma, 2)) if validas else ""
    if com and validas and abs(round(soma, 2) - propria) > 0.01:
        p(ERRO, "parcelas", f"soma das parcelas (R$ {fmt_valor(round(soma, 2))}) diferente da comissão "
                            f"da imobiliária (R$ {fmt_valor(propria)}"
                            + (", já sem a parceria" if parc else "") + f"); diferença R$ {fmt_valor(round(propria - soma, 2))}")

    # lançamento: avisos de modelo
    if modalidade == "lancamento":
        cap, ven = f.part.get("captador"), f.part.get("vendedor")
        if cap and cap.nome:
            igual = ven and ven.nome and norm(ven.nome) == norm(cap.nome)
            p(AVISO, "modalidade",
              "lançamento: o sistema não tem captador nessa modalidade; os valores de captador e vendedor"
              + (" (mesma pessoa)" if igual else "")
              + f" entram como comissão de vendedor(es) — total R$ {fmt_valor(vals['captador'] + vals['vendedor'])}; confirmar")

    # duplicidade
    if vendas is None:
        row["duplicidade"] = "não conferida"
    elif cod:
        k = chave_codigo(cod)
        mesmos = [v for v in vendas if k in v.codigos]
        exata = [v for v in mesmos
                 if d.valor in v.datas and any(abs(x - (f.valor_negociado or -1)) < 0.01 for x in v.valores)]
        if exata:
            v = exata[0]
            row["duplicidade"] = "JÁ EXISTE"
            row["venda_existente_id"] = v.sale_id
            p(ERRO, "duplicidade", f"venda já cadastrada no ADM (mesmo código, data e valor; status {v.status}) — NÃO importar")
        elif mesmos:
            row["duplicidade"] = "mesmo código, outra data/valor"
            row["venda_existente_id"] = mesmos[0].sale_id
            p(AVISO, "duplicidade", f"já existe venda com o mesmo código ({len(mesmos)}), mas com data ou valor "
                                    "diferente — confirmar se é outra venda")
        else:
            row["duplicidade"] = "não"
    else:
        row["duplicidade"] = "não conferida (código inválido)"

    erros = [m for g, _, m in probs if g == ERRO]
    avisos = [m for g, _, m in probs if g == AVISO]
    row["qtd_erros"], row["qtd_avisos"] = len(erros), len(avisos)
    row["erros"] = " | ".join(erros)
    row["avisos"] = " | ".join(avisos)
    if row["duplicidade"] == "JÁ EXISTE":
        row["situacao_importacao"] = "DUPLICADA — não importar"
    elif erros:
        row["situacao_importacao"] = "BLOQUEADA — corrigir erros"
    elif avisos:
        row["situacao_importacao"] = "PRONTA — confirmar avisos"
    else:
        row["situacao_importacao"] = "PRONTA"
    return row, probs


def duplicadas_no_lote(linhas: list[dict], problemas: list[list]):
    vistos: dict = {}
    for r in linhas:
        if not r["codigo_interno"] or not r["data_assinatura"]:
            continue
        k = (chave_codigo(r["codigo_interno"]), r["data_assinatura"], r["valor_negociado"])
        if k in vistos:
            msg = f'mesma venda (código, data e valor) também está no arquivo "{vistos[k]}"'
            r["erros"] = (r["erros"] + " | " if r["erros"] else "") + msg
            r["qtd_erros"] += 1
            r["situacao_importacao"] = "DUPLICADA NO LOTE — não importar"
            problemas.append([r["arquivo"], ERRO, "duplicidade", msg])
        else:
            vistos[k] = r["arquivo"]


def coletar(entradas: list[str]) -> list[Path]:
    arquivos = []
    for e in entradas:
        p = Path(e)
        if p.is_dir():
            arquivos += sorted(x for x in p.rglob("*.docx") if not x.name.startswith("~$"))
        elif p.suffix.lower() == ".docx":
            arquivos.append(p)
    return arquivos


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("entradas", nargs="+")
    ap.add_argument("--saida", required=True)
    ap.add_argument("--adm", action="store_true", help="conferir usuários e duplicidade no ADM (somente leitura)")
    ap.add_argument("--usuarios")
    ap.add_argument("--vendas")
    a = ap.parse_args(argv)

    usuarios = vendas = None
    if a.adm:
        usuarios = consulta_adm(SQL_USUARIOS)
        vendas = preparar_vendas(consulta_adm(SQL_VENDAS))
    if a.usuarios:
        usuarios = ler_csv(a.usuarios)
    if a.vendas:
        vendas = preparar_vendas(ler_csv(a.vendas))

    arquivos = coletar(a.entradas)
    linhas, problemas = [], []
    for arq in arquivos:
        try:
            f = extrair(arq)
        except (zipfile.BadZipFile, KeyError, ET.ParseError) as e:
            linha = {c: "" for c in COLUNAS}
            linha.update(arquivo=arq.name, situacao_importacao="BLOQUEADA — arquivo ilegível",
                         qtd_erros=1, qtd_avisos=0, erros=f"não foi possível abrir o .docx ({type(e).__name__})")
            linhas.append(linha)
            problemas.append([arq.name, ERRO, "arquivo", linha["erros"]])
            continue
        linha, probs = avaliar(f, usuarios, vendas)
        linhas.append(linha)
        problemas += [[arq.name, g, c, m] for g, c, m in probs]
    duplicadas_no_lote(linhas, problemas)

    out = Path(a.saida)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "previa.csv", "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUNAS, delimiter=";")
        w.writeheader()
        w.writerows(linhas)
    with open(out / "problemas.csv", "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh, delimiter=";")
        w.writerow(["arquivo", "gravidade", "campo", "mensagem"])
        w.writerows(problemas)

    resumo = {}
    for r in linhas:
        resumo[r["situacao_importacao"]] = resumo.get(r["situacao_importacao"], 0) + 1
    print(json.dumps({"fichas": len(linhas), "situacao": resumo,
                      "erros": sum(1 for x in problemas if x[1] == ERRO),
                      "avisos": sum(1 for x in problemas if x[1] == AVISO),
                      "saida": str(out)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
