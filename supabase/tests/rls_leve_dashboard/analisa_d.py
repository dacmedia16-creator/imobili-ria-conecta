#!/usr/bin/env python3
"""analisa_d.py antes.json dry.json -> igualdade do painel + tempos por papel (antes x depois) + outras telas"""
import json, re, sys
from collections import defaultdict
def load(p):
    msg = json.load(open(p))["message"]
    m = re.search(r"RESULTADO_JSON:(.*?)\n(CONTEXT|$)", msg, re.S)
    return json.loads(m.group(1))
a, d = load(sys.argv[1]), load(sys.argv[2])
print("leve_existe antes/dry:", a["leve_existe"], d["leve_existe"])
print("outras funcoes iguais (hash):", a["outras_md5"] == d["outras_md5"])
ra = {(r["user_id"], r["func"]): r for r in a["rows"]}
rd = {(r["user_id"], r["func"]): r for r in d["rows"]}
dash = [r for r in d["rows"] if r["func"] == "dashboard"]
dif = [r for r in dash if not r["igual"]]
err = [r for r in d["rows"] if r["erro_v"] or r["erro_n"]]
print(f"painel: {len(dash)} usuarios, iguais leve x por_rls: {len(dash)-len(dif)}, dif: {len(dif)}, com erro: {len(err)}")
# painel atual (antes) x painel novo (dry): mesmo hash?
mesmo = sum(1 for r in dash if ra[(r["user_id"], "dashboard")]["md5_nova"] == r["md5_nova"])
print(f"painel antes (prod hoje) x depois (novo): {mesmo}/{len(dash)} iguais")
for r in err[:10]: print("  ERR", r["role"], r["func"], r["erro_v"], r["erro_n"])
outras_dif = [k for k in ra if k[1] != "dashboard" and ra[k]["md5_nova"] != rd[k]["md5_nova"]]
print("outras telas: resultados diferentes:", len(outras_dif), outras_dif[:5])
# tempos por papel
t = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0, 0.0]))
for k, r in rd.items():
    role = r["role"]; f = k[1]
    t[role][f][0] += float(ra[k]["ms_nova"]); t[role][f][1] += float(r["ms_nova"]); t[role][f][2] += 1
print("\nPAINEL (ms, max por papel antes -> depois; e por usuario)")
pior = []
for role in sorted(t):
    us = [r for r in dash if r["role"] == role]
    pares = [(float(ra[(r["user_id"], "dashboard")]["ms_nova"]), float(r["ms_nova"])) for r in us]
    print(f"  {role:16s} " + "  ".join(f"{x:6.1f}->{y:6.1f}" for x, y in pares))
    for x, y in pares:
        if y > x * 1.2 and y - x > 5: pior.append((role, x, y))
print("PAINEL piorou (>20% e >5ms):", pior)
print("\nOUTRAS TELAS (soma ms por papel, antes -> depois; nao mudaram de texto)")
for role in sorted(t):
    print(f"  {role:16s} " + "  ".join(f"{f}:{v[0]:6.1f}->{v[1]:6.1f}" for f, v in sorted(t[role].items()) if f not in ("dashboard", "somas")))
print("\nSOMAS VGV/comissao/qtd iguais antes x depois:", all(ra[k]["md5_nova"] == rd[k]["md5_nova"] for k in ra if k[1] == "somas"))
for r in d["rows"]:
    if r["func"] == "somas" and r["role"] in ("super_admin", "admin", "corretor_teste"): print("  ", r["role"], r["user_id"][:8], r["md5_nova"])
