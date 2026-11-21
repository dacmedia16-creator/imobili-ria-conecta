#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_REMOTE="https://github.com/dacmedia16-creator/imobili-ria-conecta.git"
EXPECTED_BRANCH="main"
EXPECTED_WORKER="imobili-ria-conecta"
PRODUCTION_URL="https://app.somosunihub.com.br"
CHECK_ONLY=false

# Conferência logada pós-publicação (t_afb2ffe8). A configuração fica FORA do repositório (sem segredos aqui):
# um arquivo com SMOKE_SESSAO_CRIAR, SMOKE_SESSAO_ENCERRAR e PLAYWRIGHT_DIR. SMOKE_LOGADO=pular desliga.
SMOKE_ENV_FILE="${SMOKE_ENV_FILE:-/root/.config/max/deploy-smoke.env}"
SMOKE_LOGADO="${SMOKE_LOGADO:-auto}"
SMOKE_SESSAO_ARQ=""

if [[ "${1:-}" == "--check-only" ]]; then
  CHECK_ONLY=true
elif [[ $# -gt 0 ]]; then
  echo "Uso: npm run deploy:safe ou npm run deploy:check" >&2
  exit 2
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
cd "${PROJECT_DIR}"

fail() {
  echo "DEPLOY BLOQUEADO: $*" >&2
  exit 1
}

echo "[1/8] Validando projeto oficial"
[[ "${PROJECT_DIR}" != /tmp/* ]] || fail "o projeto está em uma pasta temporária (${PROJECT_DIR})."
[[ -f package.json && -f package-lock.json && -f wrangler.toml ]] || fail "arquivos do projeto oficial não encontrados."
[[ "$(git rev-parse --show-toplevel)" == "${PROJECT_DIR}" ]] || fail "execute a partir da raiz do repositório oficial."
[[ "$(git remote get-url origin)" == "${EXPECTED_REMOTE}" ]] || fail "o remote origin não é o repositório oficial."
[[ "$(git branch --show-current)" == "${EXPECTED_BRANCH}" ]] || fail "a branch atual não é ${EXPECTED_BRANCH}."
grep -Eq '^name = "imobili-ria-conecta"$' wrangler.toml || fail "o Worker configurado não é ${EXPECTED_WORKER}."

echo "[2/8] Verificando alterações locais"
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || fail "existem alterações locais sem commit. Faça commit e sincronize antes de publicar."

echo "[3/8] Sincronizando referência do GitHub"
git fetch --prune origin "${EXPECTED_BRANCH}"
LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse "origin/${EXPECTED_BRANCH}")"
[[ "${LOCAL_HEAD}" == "${REMOTE_HEAD}" ]] || fail "o código local diverge do GitHub. Local ${LOCAL_HEAD:0:8}; GitHub ${REMOTE_HEAD:0:8}."

echo "[4/8] Instalando dependências reproduzíveis"
# Usa cache local quando disponível e evita consultas de auditoria/funding que não alteram o gate.
npm ci --prefer-offline --no-audit --no-fund

echo "[5/8] Executando testes"
npm test

echo "[6/8] Gerando build único"
npm run build

echo "[7/8] Verificando funções críticas no build"
for marker in "especialistas" "perfil" "vendas" "financeiro"; do
  grep -RqsF -- "${marker}" .output/public .output/server \
    || fail "a função crítica '${marker}' não foi encontrada no build."
done

if [[ "${CHECK_ONLY}" == true ]]; then
  echo "CHECK APROVADO: commit ${LOCAL_HEAD} está pronto para publicação segura."
  exit 0
fi

encerrar_sessao_smoke() {
  if [[ -n "${SMOKE_SESSAO_ARQ}" && -f "${SMOKE_SESSAO_ARQ}" ]]; then
    ${SMOKE_SESSAO_ENCERRAR} "${SMOKE_SESSAO_ARQ}" >/dev/null 2>&1 || echo "Aviso: não consegui encerrar a sessão de teste." >&2
  fi
}
trap encerrar_sessao_smoke EXIT

SMOKE_ATIVO=false
if [[ "${SMOKE_LOGADO}" != "pular" && -f "${SMOKE_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${SMOKE_ENV_FILE}"
  SMOKE_SESSAO_ARQ="$(mktemp "${TMPDIR:-/tmp}/deploy-smoke-sessao.XXXXXX")"
  chmod 600 "${SMOKE_SESSAO_ARQ}"
  echo "Preparando a conta de teste para a conferência logada (antes de publicar)"
  # Uma 2ª tentativa cobre a falha passageira conhecida do Auth (verify 403).
  ${SMOKE_SESSAO_CRIAR} "${SMOKE_SESSAO_ARQ}" >/dev/null || ${SMOKE_SESSAO_CRIAR} "${SMOKE_SESSAO_ARQ}" >/dev/null \
    || fail "não consegui entrar com a conta de teste (nada foi publicado). Tente de novo ou use SMOKE_LOGADO=pular."
  SMOKE_ATIVO=true
elif [[ "${SMOKE_LOGADO}" == "pular" ]]; then
  echo "Aviso: conferência logada desligada por SMOKE_LOGADO=pular." >&2
else
  echo "Aviso: ${SMOKE_ENV_FILE} não existe; só a validação pública será feita." >&2
fi

echo "[8/8] Publicando commit ${LOCAL_HEAD}"
PREVIOUS_VERSION="$(npx wrangler deployments status --json 2>/dev/null | node -e '
let input=""; process.stdin.on("data", d => input += d); process.stdin.on("end", () => {
  try {
    const data=JSON.parse(input);
    const versions=data.versions || data.deployment?.versions || [];
    process.stdout.write(versions[0]?.version_id || versions[0]?.id || "");
  } catch {}
});')"

# O build já foi aprovado no passo 6. Publica exatamente esse artefato, sem recompilar.
npm run deploy:prebuilt

smoke_test() {
  # O proxy do ambiente bloqueia CONNECT para o próprio domínio público e gerava falso negativo,
  # revertendo um deploy saudável. Estes smoke tests são públicos e devem validar a rota direta.
  curl --noproxy '*' --fail --silent --show-error --location --max-time 30 "${PRODUCTION_URL}/" >/dev/null \
    && curl --noproxy '*' --fail --silent --show-error --location --max-time 30 "${PRODUCTION_URL}/especialistas" >/dev/null
}

smoke_logado() {
  [[ "${SMOKE_ATIVO}" == true ]] || return 0
  echo "Conferindo telas principais logado com a conta de teste"
  SESSAO="${SMOKE_SESSAO_ARQ}" BASE_URL="${PRODUCTION_URL}" PLAYWRIGHT_DIR="${PLAYWRIGHT_DIR}" \
    OUT_DIR="${PROJECT_DIR}/.deploy/smoke-falhas" node scripts/smoke-telas-logado.mjs
}

if ! smoke_test || ! smoke_logado; then
  echo "A validação de produção falhou." >&2
  if [[ -n "${PREVIOUS_VERSION}" ]]; then
    echo "Revertendo automaticamente para ${PREVIOUS_VERSION}." >&2
    npx wrangler rollback "${PREVIOUS_VERSION}" --name "${EXPECTED_WORKER}" --yes \
      --message "Rollback automático: smoke test falhou após ${LOCAL_HEAD}"
  else
    echo "Não foi possível identificar automaticamente a versão anterior para rollback." >&2
  fi
  exit 1
fi

mkdir -p .deploy
printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${LOCAL_HEAD}" "${PRODUCTION_URL}" >> .deploy/history.log
echo "DEPLOY APROVADO: commit ${LOCAL_HEAD} publicado e validado em ${PRODUCTION_URL}."
