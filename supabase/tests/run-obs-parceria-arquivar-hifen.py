#!/usr/bin/env python3
"""Ensaio da migration 20261008120000 num clone LOCAL (docker, padrão adm-prod-restore).
Tudo numa transação que termina em ROLLBACK: o clone fica como estava. Nunca fala com banco remoto.

Fases (cada uma é uma transação separada e revertida):
  antes  : suíte sem a migration (regra antiga; mostra o que muda)
  depois : correção de dados dos códigos + migration + suíte
  ciclo  : fingerprint -> dados + migration -> rollback literal -> fingerprint igual -> migration de novo + suíte
Uso: python3 supabase/tests/run-obs-parceria-arquivar-hifen.py [container]
"""
import re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTAINER = sys.argv[1] if len(sys.argv) > 1 else "adm-prod-restore"
UP = (ROOT / "supabase/migrations/20261008120000_obs_parceria_arquivar_hifen.sql").read_text()
DOWN = (ROOT / "docs/sql/rollback/20261008120000_obs_parceria_arquivar_hifen.rollback.sql").read_text()
DADOS = (ROOT / "docs/sql/dados/20261008_codigo_interno_hifen.sql").read_text()
SUITE = (ROOT / "supabase/tests/obs_parceria_arquivar_hifen.sql").read_text()

strip_tx = lambda s: re.sub(r"(?m)^(BEGIN|COMMIT|ROLLBACK);\s*$", "", s)
dados = strip_tx(DADOS.split("-- REVERTER")[0])
corpo = SUITE.split("BEGIN;", 1)[1].rsplit("ROLLBACK;", 1)[0]
FP = """SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc)||':'||array_to_string(p.proconfig, ',') x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'col:'||table_name||'.'||column_name||':'||data_type FROM information_schema.columns WHERE table_schema='public'
  UNION ALL SELECT 'con:'||conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='public'::regnamespace
  UNION ALL SELECT 'pol:'||tablename||'.'||policyname||':'||md5(coalesce(qual,'')||'|'||coalesce(with_check,'')) FROM pg_policies WHERE schemaname='public') s),''));"""


def run(label, sql):
    p = subprocess.run(["docker", "exec", "-i", CONTAINER, "psql", "-h", "127.0.0.1", "-U", "postgres",
                        "-d", "postgres", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"],
                       input=sql, capture_output=True, text=True)
    out = p.stdout + p.stderr
    lines = [l for l in out.splitlines() if l.startswith(("TOTAL=", "FALHA", "FP=", "ERROR"))]
    return p.returncode, lines


def resumo(label, lines, maxf=12):
    tot = [l for l in lines if l.startswith("TOTAL=")]
    fal = [l for l in lines if l.startswith("FALHA")]
    err = [l for l in lines if l.startswith("ERROR")]
    print(f"[{label}] {tot[0] if tot else 'sem TOTAL'} falhas={len(fal)} {err[:1]}")
    for l in fal[:maxf]:
        print(f"[{label}]   {l}")


rc, l = run("antes", "\\set ON_ERROR_STOP 1\nBEGIN;\n" + corpo + "\nROLLBACK;\n")
resumo("antes (regra antiga, sem migration)", l, maxf=40)

rc, l = run("depois", "\\set ON_ERROR_STOP 1\nBEGIN;\n" + dados + UP + corpo + "\nROLLBACK;\n")
resumo("depois (dados + migration)", l, maxf=200)
ok_depois = rc == 0 and any(x.startswith("TOTAL=") for x in l) and not any(x.startswith("FALHA") for x in l)

sql = ("\\set ON_ERROR_STOP 1\nBEGIN;\n" + dados + FP + "\n" + UP + "\n" + strip_tx(DOWN) + "\n" + FP + "\n"
       + UP + "\n" + UP + "\n" + corpo + "\nROLLBACK;\n")
rc, l = run("ciclo", sql)
fps = [x for x in l if x.startswith("FP=")]
igual = len(fps) == 2 and fps[0] == fps[1]
print(f"[ciclo] rollback devolve o schema ao original: {'SIM' if igual else 'NÃO'} {fps}")
resumo("ciclo (up -> down -> up -> up idempotente)", l)
ok_ciclo = rc == 0 and igual and not any(x.startswith("FALHA") for x in l)
print("RESULTADO:", "APROVADO" if ok_depois and ok_ciclo else "REPROVADO")
sys.exit(0 if ok_depois and ok_ciclo else 1)
