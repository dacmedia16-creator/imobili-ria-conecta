#!/usr/bin/env python3
"""Ensaio da migration 20261008130000 num clone LOCAL (docker, padrão adm-prod-restore).
Cada fase é uma transação que termina em ROLLBACK: o clone fica como estava. Nunca fala com banco remoto.

Fases:
  antes  : suíte sem a migration (mostra o que muda)
  depois : migration + suíte
  ciclo  : fingerprint -> migration -> rollback literal -> fingerprint igual -> migration 2x (idempotente) + suíte
Uso: python3 supabase/tests/run-midia-obrigatoria.py [container]
"""
import re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTAINER = sys.argv[1] if len(sys.argv) > 1 else "adm-prod-restore"
UP = (ROOT / "supabase/migrations/20261008130000_midia_obrigatoria_ao_avancar.sql").read_text()
DOWN = (ROOT / "docs/sql/rollback/20261008130000_midia_obrigatoria_ao_avancar.rollback.sql").read_text()
SUITE = (ROOT / "supabase/tests/midia_obrigatoria_ao_avancar.sql").read_text()

strip_tx = lambda s: re.sub(r"(?m)^(BEGIN|COMMIT|ROLLBACK);\s*$", "", s)
corpo = SUITE.split("BEGIN;", 1)[1].rsplit("ROLLBACK;", 1)[0]
FP = """SELECT 'FP=' || md5(coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:'||p.oid::regprocedure::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc) x
    FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  UNION ALL SELECT 'tg:'||tgrelid::regclass::text||':'||tgname FROM pg_trigger WHERE NOT tgisinternal
  UNION ALL SELECT 'mig:'||version FROM supabase_migrations.schema_migrations) s),''));"""


def run(sql):
    p = subprocess.run(["docker", "exec", "-i", CONTAINER, "psql", "-h", "127.0.0.1", "-U", "postgres",
                        "-d", "postgres", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"],
                       input=sql, capture_output=True, text=True)
    out = p.stdout + p.stderr
    return p.returncode, [l for l in out.splitlines() if l.startswith(("TOTAL=", "FALHA", "FP=", "ERROR"))]


def resumo(label, lines, maxf=40):
    tot = [l for l in lines if l.startswith("TOTAL=")]
    fal = [l for l in lines if l.startswith("FALHA")]
    err = [l for l in lines if l.startswith("ERROR")]
    print(f"[{label}] {tot[0] if tot else 'sem TOTAL'} falhas={len(fal)} {err[:1]}")
    for l in fal[:maxf]:
        print(f"[{label}]   {l}")


rc, l = run("\\set ON_ERROR_STOP 1\nBEGIN;\n" + corpo + "\nROLLBACK;\n")
resumo("antes (sem migration)", l)

rc, l = run("\\set ON_ERROR_STOP 1\nBEGIN;\n" + UP + corpo + "\nROLLBACK;\n")
resumo("depois (migration)", l)
ok_depois = rc == 0 and any(x.startswith("TOTAL=") for x in l) and not any(x.startswith("FALHA") for x in l)

sql = ("\\set ON_ERROR_STOP 1\nBEGIN;\n" + FP + "\n" + UP + "\n" + strip_tx(DOWN) + "\n" + FP + "\n"
       + UP + "\n" + UP + "\n" + corpo + "\nROLLBACK;\n")
rc, l = run(sql)
fps = [x for x in l if x.startswith("FP=")]
igual = len(fps) == 2 and fps[0] == fps[1]
print(f"[ciclo] rollback devolve o schema ao original: {'SIM' if igual else 'NÃO'}")
resumo("ciclo (up -> down -> up -> up idempotente)", l)
ok_ciclo = rc == 0 and igual and not any(x.startswith("FALHA") for x in l)
print("RESULTADO:", "APROVADO" if ok_depois and ok_ciclo else "REPROVADO")
sys.exit(0 if ok_depois and ok_ciclo else 1)
