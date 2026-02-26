#!/usr/bin/env bash
#
# mneme setup — 一键安装并初始化 mneme 三层记忆架构
#
# 用法:
#   ./setup.sh          # 安装依赖 + 初始化
#   ./setup.sh --check  # 仅检查依赖状态
#

set -euo pipefail

# --- 颜色 ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}==>${NC} $1"; }
ok()      { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!!]${NC} $1"; }
fail()    { echo -e "${RED}[FAIL]${NC} $1"; }

# --- 检测平台 ---
OS="$(uname -s)"
ARCH="$(uname -m)"

# --- 检测命令是否存在 ---
has() { command -v "$1" &>/dev/null; }

# --- 安装 Git ---
install_git() {
    if has git; then
        ok "git $(git --version | awk '{print $3}')"
        return 0
    fi
    info "安装 git..."
    case "$OS" in
        Darwin) xcode-select --install 2>/dev/null || true ;;
        Linux)
            if has apt-get; then sudo apt-get update -qq && sudo apt-get install -y -qq git
            elif has dnf; then sudo dnf install -y git
            elif has yum; then sudo yum install -y git
            elif has pacman; then sudo pacman -S --noconfirm git
            else fail "无法自动安装 git，请手动安装"; return 1
            fi ;;
        *) fail "不支持的平台: $OS"; return 1 ;;
    esac
    ok "git 已安装"
}

# --- 安装 Dolt ---
install_dolt() {
    if has dolt; then
        ok "dolt $(dolt version | awk '{print $3}')"
        return 0
    fi
    info "安装 dolt..."
    if curl -fsSL https://github.com/dolthub/dolt/releases/latest/download/install.sh | bash; then
        ok "dolt 已安装"
    else
        fail "dolt 安装失败，请手动安装: https://github.com/dolthub/dolt"
        return 1
    fi
}

# --- 安装 bd (beads) ---
install_bd() {
    if has bd; then
        ok "bd $(bd version 2>/dev/null | head -1)"
        return 0
    fi
    info "安装 bd (beads)..."

    # 优先 brew，其次 npm，最后 install script
    if has brew; then
        info "通过 Homebrew 安装..."
        brew install beads
    elif has npm; then
        info "通过 npm 安装..."
        npm install -g @beads/bd
    else
        info "通过安装脚本安装..."
        curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash
    fi

    if has bd; then
        ok "bd 已安装"
    else
        fail "bd 安装失败，请手动安装: https://github.com/steveyegge/beads"
        return 1
    fi
}

# --- 启动 Dolt server（如果没在运行） ---
ensure_dolt_server() {
    if bd dolt test --quiet 2>/dev/null; then
        ok "dolt server 已在运行"
        return 0
    fi

    info "启动 dolt server..."
    local data_dir="${DOLT_DATA_DIR:-$HOME/.dolt/databases}"
    mkdir -p "$data_dir"
    dolt sql-server --host 127.0.0.1 --port 3307 --data-dir "$data_dir" > /tmp/dolt-server.log 2>&1 &
    local pid=$!

    # 等待 server 就绪（最多 10 秒）
    local retries=10
    while [ $retries -gt 0 ]; do
        if bd dolt test --quiet 2>/dev/null; then
            ok "dolt server 已启动 (PID: $pid)"
            return 0
        fi
        sleep 1
        retries=$((retries - 1))
    done

    fail "dolt server 启动超时，日志: /tmp/dolt-server.log"
    return 1
}

# --- 初始化 beads ---
init_beads() {
    if [ -d ".beads" ]; then
        ok ".beads/ 已存在"
        return 0
    fi
    info "初始化 beads..."
    bd init --quiet
    ok "beads 初始化完成"
}

# --- 初始化 git ---
init_git() {
    if [ -d ".git" ]; then
        ok ".git/ 已存在"
        return 0
    fi
    info "初始化 git..."
    git init -q
    ok "git 初始化完成"
}

# --- 验证 .openclaw 目录 ---
check_openclaw() {
    if [ -d ".openclaw/facts" ]; then
        local count
        count=$(find .openclaw/facts -name '*.md' | wc -l | tr -d ' ')
        ok ".openclaw/facts/ ($count 个 facts 文件)"
    else
        warn ".openclaw/facts/ 目录不存在"
        info "创建 .openclaw/facts/ 目录..."
        mkdir -p .openclaw/facts
        ok ".openclaw/facts/ 已创建"
    fi
}

# --- 验证 .opencode 目录 ---
check_opencode() {
    if [ -f ".opencode/prompt.md" ]; then
        ok ".opencode/prompt.md"
    else
        warn ".opencode/prompt.md 不存在"
    fi
}

# --- 验证 AGENTS.md ---
check_agents() {
    if [ -f "AGENTS.md" ]; then
        ok "AGENTS.md"
    else
        warn "AGENTS.md 不存在"
    fi
}

# --- 仅检查模式 ---
check_only() {
    echo ""
    info "检查 mneme 依赖状态..."
    echo ""

    echo "--- 外部依赖 ---"
    if has git; then ok "git $(git --version | awk '{print $3}')"; else fail "git 未安装"; fi
    if has dolt; then ok "dolt $(dolt version | awk '{print $3}')"; else fail "dolt 未安装"; fi
    if has bd; then ok "bd $(bd version 2>/dev/null | head -1)"; else fail "bd 未安装"; fi
    if bd dolt test --quiet 2>/dev/null; then ok "dolt server 运行中"; else warn "dolt server 未运行"; fi
    echo ""

    echo "--- 项目结构 ---"
    if [ -d ".git" ]; then ok ".git/"; else warn ".git/ 不存在"; fi
    if [ -d ".beads" ]; then ok ".beads/"; else warn ".beads/ 不存在"; fi
    check_openclaw
    check_opencode
    check_agents
    echo ""
}

# --- 主流程 ---
main() {
    if [ "${1:-}" = "--check" ]; then
        check_only
        exit 0
    fi

    echo ""
    echo "==============================="
    echo "  mneme setup"
    echo "==============================="
    echo ""

    info "平台: ${OS} ${ARCH}"
    echo ""

    echo "--- 1/3 安装依赖 ---"
    install_git
    install_dolt
    install_bd
    echo ""

    echo "--- 2/3 启动服务 ---"
    ensure_dolt_server
    echo ""

    echo "--- 3/3 初始化项目 ---"
    init_git
    init_beads
    check_openclaw
    check_opencode
    check_agents
    echo ""

    echo "==============================="
    echo -e "  ${GREEN}setup 完成${NC}"
    echo "==============================="
    echo ""
    echo "下一步:"
    echo "  bd ready          # 查看可执行任务"
    echo "  bd list           # 查看所有任务"
    echo "  ./setup.sh --check  # 随时检查状态"
    echo ""
}

main "$@"
