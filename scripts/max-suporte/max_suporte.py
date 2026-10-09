#!/usr/bin/env python3
"""MAX no canal "Ajuda e sugestões" do ADM MAX (migration 20261009030000).

Usa SÓ a credencial própria do papel max_suporte_bot (nunca service_role, nunca chave de IA).
A credencial fica num .env com permissão 600 fora do repositório (padrão abaixo); o script recusa
arquivo com permissão mais aberta e nunca imprime senha, host completo ou dados do .env.

Subcomandos
  verificar            Verificador BARATO, sem IA, para o cron a cada 15 min (monitor do Hermes).
                       Saída determinística: se nada mudou, sai igual à anterior e a IA não acorda.
                       Fora das 8h–20h (America/Sao_Paulo) imprime "fora_do_horario" e não consulta.
  ler ID               Chamado + conversa (JSON) para a IA decidir.
  responder ID ARQ [--status respondido|em_analise]
                       Posta o texto do arquivo ARQ como MAX (assinatura "— MAX" automática).
  status ID em_analise|respondido
  tratado ID           Marca localmente que a última mensagem do usuário neste chamado já foi
                       tratada (ex.: encaminhada a Denis). O verificador deixa de mostrá-la até o
                       usuário escrever de novo.

Variáveis do .env: MAX_SUPORTE_REF, MAX_SUPORTE_PGHOST, MAX_SUPORTE_PGPASSWORD
(usuário = max_suporte_bot.<REF> no pooler compartilhado).
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import stat
import subprocess
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

ENV_PADRAO = "/root/.hermes/profiles/max/secrets/max-suporte.env"
ESTADO_PADRAO = "/root/.hermes/profiles/max/state/max-suporte-tratados.json"
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
HORARIO = (8, 20)  # das 8h às 20h, America/Sao_Paulo
SEP = "\x1f"


class Erro(Exception):
    pass


def carregar_env(caminho: str) -> dict[str, str]:
    p = Path(caminho)
    if not p.is_file():
        raise Erro(f"credencial ausente ({p.name}); o MAX segue desligado")
    modo = stat.S_IMODE(p.stat().st_mode)
    if modo & 0o077:
        raise Erro(f"{p.name} precisa de permissão 600 (está {oct(modo)}); nada executado")
    env: dict[str, str] = {}
    for linha in p.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([A-Z_]+)=(.*)$", linha.strip())
        if m:
            env[m.group(1)] = m.group(2).strip().strip("'\"")
    ref = env.get("MAX_SUPORTE_REF", "")
    host = env.get("MAX_SUPORTE_PGHOST", "")
    if not re.fullmatch(r"[a-z]{20}", ref) or not re.fullmatch(r"[\w.-]+\.supabase\.(com|co)", host) \
            or not env.get("MAX_SUPORTE_PGPASSWORD"):
        raise Erro("credencial incompleta ou inválida; nada executado")
    return env


def psql(env: dict[str, str], sql: str, variaveis: dict[str, str] | None = None) -> list[list[str]]:
    """Roda SQL como max_suporte_bot. Valores entram por variável do psql (:'x'), nunca concatenados."""
    host = env["MAX_SUPORTE_PGHOST"]
    usuario = f"max_suporte_bot.{env['MAX_SUPORTE_REF']}" if "pooler" in host else "max_suporte_bot"
    args = [os.environ.get("MAX_SUPORTE_PSQL", "psql"), "-X", "-q", "-At", "-F", SEP, "-v", "ON_ERROR_STOP=1",
            "-h", host, "-p", "5432", "-U", usuario, "-d", "postgres"]
    for k, v in (variaveis or {}).items():
        args += ["-v", f"{k}={v}"]
    penv = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PGPASSWORD": env["MAX_SUPORTE_PGPASSWORD"],
            "PGSSLMODE": "require", "PGCONNECT_TIMEOUT": "10", "PGAPPNAME": "max-suporte"}
    r = subprocess.run(args, input=sql, env=penv, capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        # Só a primeira linha do erro do banco (mensagens das funções são em português e sem dados).
        msg = next((l for l in r.stderr.splitlines() if "ERROR" in l or "FATAL" in l), "falha de conexão")
        raise Erro(re.sub(r"^.*?(ERROR|FATAL):\s*", "", msg)[:200])
    return [l.split(SEP) for l in r.stdout.splitlines() if l]


def ler_estado(caminho: str) -> dict[str, str]:
    try:
        return json.loads(Path(caminho).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def gravar_estado(caminho: str, estado: dict[str, str]) -> None:
    p = Path(caminho)
    p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(estado, sort_keys=True, indent=0), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(p)


def no_horario(agora: dt.datetime | None = None) -> bool:
    agora = agora or dt.datetime.now(ZoneInfo("America/Sao_Paulo"))
    return HORARIO[0] <= agora.hour < HORARIO[1]


SQL_PENDENTES = ("SELECT id, numero, tipo, status, ultima_msg_usuario_em "
                 "FROM max_suporte.pendentes(NULL, 50);")


def verificar(env_path: str, estado_path: str, agora: dt.datetime | None = None) -> str:
    if not no_horario(agora):
        return "fora_do_horario"
    env = carregar_env(env_path)
    linhas = psql(env, SQL_PENDENTES)
    tratados = ler_estado(estado_path)
    abertos = {l[0] for l in linhas}
    # Esquece marcações de chamados que já saíram da fila (respondidos/resolvidos).
    limpo = {k: v for k, v in tratados.items() if k in abertos}
    if limpo != tratados:
        gravar_estado(estado_path, limpo)
    novos = [l for l in linhas if limpo.get(l[0]) != l[4]]
    if not novos:
        return "sem_novidade"
    # Determinístico: ordenado por número; só id, número, tipo, status e horário (sem texto/nome).
    out = [f"chamado {l[1]} id={l[0]} tipo={l[2]} status={l[3]} ultima_msg_usuario={l[4]}"
           for l in sorted(novos, key=lambda x: int(x[1]))]
    return "\n".join(out)


def checar_id(valor: str) -> str:
    if not UUID.match(valor):
        raise Erro("id de chamado inválido")
    return valor


def main(argv: list[str]) -> int:
    env_path = os.environ.get("MAX_SUPORTE_ENV", ENV_PADRAO)
    estado_path = os.environ.get("MAX_SUPORTE_ESTADO", ESTADO_PADRAO)
    if not argv:
        print(__doc__)
        return 2
    cmd, args = argv[0], argv[1:]
    try:
        if cmd == "verificar":
            print(verificar(env_path, estado_path))
        elif cmd == "ler" and len(args) == 1:
            r = psql(carregar_env(env_path), "SELECT max_suporte.chamado(:'t'::uuid);", {"t": checar_id(args[0])})
            print(json.dumps(json.loads(r[0][0]), ensure_ascii=False, indent=1))
        elif cmd == "responder" and len(args) in (2, 4):
            status = "respondido"
            if len(args) == 4:
                if args[2] != "--status":
                    raise Erro("uso: responder ID ARQUIVO [--status respondido|em_analise]")
                status = args[3]
            if status not in ("respondido", "em_analise"):
                raise Erro("status permitido: respondido ou em_analise")
            texto = Path(args[1]).read_text(encoding="utf-8").strip()
            if not 1 <= len(texto) <= 3900:
                raise Erro("texto deve ter de 1 a 3.900 caracteres")
            r = psql(carregar_env(env_path), "SELECT max_suporte.responder(:'t'::uuid, :'x', :'s');",
                     {"t": checar_id(args[0]), "x": texto, "s": status})
            print(f"ok {r[0][0]}")
        elif cmd == "status" and len(args) == 2:
            if args[1] not in ("respondido", "em_analise"):
                raise Erro("status permitido: respondido ou em_analise")
            r = psql(carregar_env(env_path), "SELECT max_suporte.mudar_status(:'t'::uuid, :'s');",
                     {"t": checar_id(args[0]), "s": args[1]})
            print(f"ok {r[0][0]}")
        elif cmd == "tratado" and len(args) == 1:
            tid = checar_id(args[0])
            linhas = {l[0]: l[4] for l in psql(carregar_env(env_path), SQL_PENDENTES)}
            if tid not in linhas:
                raise Erro("chamado não está pendente")
            estado = ler_estado(estado_path)
            estado[tid] = linhas[tid]
            gravar_estado(estado_path, estado)
            print("ok tratado")
        else:
            print(__doc__)
            return 2
    except Erro as e:
        # Saída curta e estável: o monitor acorda a IA uma vez e ela avisa Denis.
        print(f"erro: {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
