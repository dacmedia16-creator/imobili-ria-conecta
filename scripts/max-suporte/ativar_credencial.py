#!/usr/bin/env python3
"""Liga (ou troca) a credencial própria do MAX no canal "Ajuda e sugestões".

Gera uma senha aleatória AQUI, calcula o verificador SCRAM-SHA-256 localmente e manda ao banco só o
verificador (ALTER ROLE max_suporte_bot LOGIN PASSWORD 'SCRAM-SHA-256$...'). A senha em texto só vai
para o .env do perfil do MAX, com permissão 600. Nada é impresso: nem senha, nem verificador.

  python3 scripts/max-suporte/ativar_credencial.py --alvo homolog  [--env CAMINHO]
  python3 scripts/max-suporte/ativar_credencial.py --alvo producao --aprovado-por-denis [--env CAMINHO]
  python3 scripts/max-suporte/ativar_credencial.py --alvo ... --desligar   (NOLOGIN e apaga o .env)

Canal administrativo (já existentes na VPS, fora do repositório):
  homolog   /root/.config/max/adm-max-homolog.env (psql no pooler, usuário postgres.<ref>)
  producao  /root/.config/max/adm-max-supabase-candidate.env (Management API, PAT)
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import subprocess
import sys
import urllib.request
from pathlib import Path

ALVOS = {
    "homolog": {"ref": "qvhyepwduhlgqwpgmpvh", "admin": "/root/.config/max/adm-max-homolog.env"},
    "producao": {"ref": "xvvymgurpchhlmbpjbgc", "admin": "/root/.config/max/adm-max-supabase-candidate.env"},
}
ENV_PADRAO = "/root/.hermes/profiles/max/secrets/max-suporte.env"


def ler_env(caminho: str) -> dict[str, str]:
    env = {}
    for linha in Path(caminho).read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([A-Z_]+)=(.*)$", linha.strip())
        if m:
            env[m.group(1)] = m.group(2).strip().strip("'\"")
    return env


def scram_verifier(senha: str, iteracoes: int = 4096) -> str:
    sal = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac("sha256", senha.encode(), sal, iteracoes)
    client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
    stored = hashlib.sha256(client_key).digest()
    server = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
    b64 = lambda b: base64.b64encode(b).decode()
    return f"SCRAM-SHA-256${iteracoes}:{b64(sal)}${b64(stored)}:{b64(server)}"


def admin_sql(alvo: str, sql: str) -> str:
    cfg = ALVOS[alvo]
    env = ler_env(cfg["admin"])
    if alvo == "homolog":
        if env.get("HOMOLOG_REF") != cfg["ref"]:
            raise SystemExit("credencial de homologação não confere com a ref; nada executado")
        r = subprocess.run(
            ["psql", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-h", env["HOMOLOG_POOLER_HOST"], "-p", "5432",
             "-U", env["HOMOLOG_POOLER_USER"], "-d", "postgres"],
            input=sql, capture_output=True, text=True, timeout=60,
            env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PGPASSWORD": env["HOMOLOG_DB_PASSWORD"],
                 "PGSSLMODE": "require"})
        if r.returncode != 0:
            raise SystemExit("falha no banco: " + (r.stderr.splitlines() or ["?"])[0].split("ERROR:")[-1][:200])
        return r.stdout.strip()
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{cfg['ref']}/database/query",
        data=json.dumps({"query": sql}).encode(), method="POST",
        headers={"Authorization": f"Bearer {env['SUPABASE_ACCESS_TOKEN']}", "Content-Type": "application/json",
                 "User-Agent": "max-suporte-ativar"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode()


def pooler_host(alvo: str) -> str:
    if alvo == "homolog":
        return ler_env(ALVOS["homolog"]["admin"])["HOMOLOG_POOLER_HOST"]
    host = os.environ.get("MAX_SUPORTE_PGHOST_PRODUCAO", "")
    if not re.fullmatch(r"[\w.-]+\.pooler\.supabase\.com", host):
        raise SystemExit("defina MAX_SUPORTE_PGHOST_PRODUCAO com o host do pooler (Settings > Database)")
    return host


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--alvo", choices=sorted(ALVOS), required=True)
    ap.add_argument("--env", default=ENV_PADRAO)
    ap.add_argument("--aprovado-por-denis", action="store_true")
    ap.add_argument("--desligar", action="store_true")
    a = ap.parse_args()
    if a.alvo == "producao" and not a.aprovado_por_denis and not a.desligar:
        raise SystemExit("produção só com --aprovado-por-denis (depois do ok no tópico 6238)")
    existe = admin_sql(a.alvo, "SELECT count(*) FROM pg_roles WHERE rolname = 'max_suporte_bot';")
    if '"count":1' not in existe.replace(" ", "") and existe != "1":
        raise SystemExit("papel max_suporte_bot não existe: aplique antes a migration 20261009030000")

    destino = Path(a.env)
    if a.desligar:
        admin_sql(a.alvo, "ALTER ROLE max_suporte_bot NOLOGIN PASSWORD NULL;")
        if destino.exists():
            destino.unlink()
        print("ok: credencial do MAX desligada (NOLOGIN) e .env removido")
        return

    senha = secrets.token_urlsafe(32)
    verificador = scram_verifier(senha)
    host = pooler_host(a.alvo)
    destino.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = destino.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(f"MAX_SUPORTE_REF={ALVOS[a.alvo]['ref']}\nMAX_SUPORTE_PGHOST={host}\nMAX_SUPORTE_PGPASSWORD={senha}\n")
    admin_sql(a.alvo, f"ALTER ROLE max_suporte_bot LOGIN PASSWORD '{verificador}';")
    os.chmod(tmp, 0o600)
    tmp.replace(destino)
    print(f"ok: credencial do MAX ligada em {a.alvo}; .env em {destino} (600)")


if __name__ == "__main__":
    sys.exit(main())
