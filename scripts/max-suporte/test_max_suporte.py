"""Testes locais (sem banco) do verificador do MAX. Rodar: python3 scripts/max-suporte/test_max_suporte.py"""
import datetime as dt
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).parent))
import max_suporte as ms  # noqa: E402

SP = ZoneInfo("America/Sao_Paulo")
DIA = dt.datetime(2026, 10, 9, 10, 0, tzinfo=SP)


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.env = os.path.join(self.dir.name, "max-suporte.env")
        self.estado = os.path.join(self.dir.name, "estado.json")
        Path(self.env).write_text(
            "MAX_SUPORTE_REF=xvvymgurpchhlmbpjbgc\nMAX_SUPORTE_PGHOST=aws-0-sa-east-1.pooler.supabase.com\n"
            "MAX_SUPORTE_PGPASSWORD=segredo-de-teste\n")
        os.chmod(self.env, 0o600)

    def tearDown(self):
        self.dir.cleanup()


class Verificador(Base):
    def test_fora_do_horario_nao_consulta(self):
        with mock.patch.object(ms, "psql") as p:
            self.assertEqual(ms.verificar(self.env, self.estado, DIA.replace(hour=7, minute=59)), "fora_do_horario")
            self.assertEqual(ms.verificar(self.env, self.estado, DIA.replace(hour=20)), "fora_do_horario")
            p.assert_not_called()

    def test_sem_pendentes(self):
        with mock.patch.object(ms, "psql", return_value=[]):
            self.assertEqual(ms.verificar(self.env, self.estado, DIA), "sem_novidade")

    def test_saida_deterministica_e_ordenada(self):
        linhas = [["b" * 8 + "-0000-4000-8000-000000000002", "1002", "erro", "recebido", "2026-10-09 12:01:00+00"],
                  ["a" * 8 + "-0000-4000-8000-000000000001", "1001", "duvida", "em_analise", "2026-10-09 11:00:00+00"]]
        with mock.patch.object(ms, "psql", return_value=linhas):
            s1 = ms.verificar(self.env, self.estado, DIA)
            s2 = ms.verificar(self.env, self.estado, DIA.replace(minute=15))
        self.assertEqual(s1, s2)
        self.assertTrue(s1.startswith("chamado 1001 "))
        self.assertNotIn("segredo", s1)

    def test_tratado_some_ate_o_usuario_escrever_de_novo(self):
        tid = "a" * 8 + "-0000-4000-8000-000000000001"
        l1 = [[tid, "1001", "erro", "em_analise", "2026-10-09 11:00:00+00"]]
        with mock.patch.object(ms, "psql", return_value=l1):
            os.environ["MAX_SUPORTE_ENV"], os.environ["MAX_SUPORTE_ESTADO"] = self.env, self.estado
            try:
                self.assertEqual(ms.main(["tratado", tid]), 0)
            finally:
                del os.environ["MAX_SUPORTE_ENV"], os.environ["MAX_SUPORTE_ESTADO"]
            self.assertEqual(ms.verificar(self.env, self.estado, DIA), "sem_novidade")
        l2 = [[tid, "1001", "erro", "em_analise", "2026-10-09 13:00:00+00"]]
        with mock.patch.object(ms, "psql", return_value=l2):
            self.assertIn("chamado 1001", ms.verificar(self.env, self.estado, DIA))

    def test_chamado_que_saiu_da_fila_e_esquecido(self):
        tid = "a" * 8 + "-0000-4000-8000-000000000001"
        ms.gravar_estado(self.estado, {tid: "x"})
        with mock.patch.object(ms, "psql", return_value=[]):
            ms.verificar(self.env, self.estado, DIA)
        self.assertEqual(ms.ler_estado(self.estado), {})
        self.assertEqual(oct(os.stat(self.estado).st_mode & 0o777), "0o600")


class Credencial(Base):
    def test_recusa_env_aberto(self):
        os.chmod(self.env, 0o644)
        with self.assertRaises(ms.Erro) as e:
            ms.carregar_env(self.env)
        self.assertIn("600", str(e.exception))

    def test_env_ausente(self):
        with self.assertRaises(ms.Erro):
            ms.carregar_env(self.env + ".nao")

    def test_id_invalido(self):
        for v in ["1; DROP TABLE x", "'", "abc"]:
            with self.assertRaises(ms.Erro):
                ms.checar_id(v)

    def test_valores_vao_por_variavel_do_psql(self):
        capt = {}

        def fake_run(args, **kw):
            capt["args"], capt["input"], capt["env"] = args, kw["input"], kw["env"]
            return mock.Mock(returncode=0, stdout="respondido\n", stderr="")
        tid = "a" * 8 + "-0000-4000-8000-000000000001"
        arq = os.path.join(self.dir.name, "r.txt")
        Path(arq).write_text("Olá'); DROP TABLE x; --")
        os.environ["MAX_SUPORTE_ENV"] = self.env
        try:
            with mock.patch.object(ms.subprocess, "run", side_effect=fake_run):
                self.assertEqual(ms.main(["responder", tid, arq]), 0)
        finally:
            del os.environ["MAX_SUPORTE_ENV"]
        self.assertNotIn("DROP", capt["input"])
        self.assertIn("max_suporte_bot.xvvymgurpchhlmbpjbgc", capt["args"])
        self.assertNotIn("segredo-de-teste", " ".join(capt["args"]))
        self.assertEqual(set(capt["env"]) - {"PATH"}, {"PGPASSWORD", "PGSSLMODE", "PGCONNECT_TIMEOUT", "PGAPPNAME"})

    def test_status_proibido(self):
        tid = "a" * 8 + "-0000-4000-8000-000000000001"
        os.environ["MAX_SUPORTE_ENV"] = self.env
        try:
            with mock.patch.object(ms, "psql") as p:
                self.assertEqual(ms.main(["status", tid, "resolvido"]), 1)
                p.assert_not_called()
        finally:
            del os.environ["MAX_SUPORTE_ENV"]


if __name__ == "__main__":
    unittest.main(verbosity=1)
