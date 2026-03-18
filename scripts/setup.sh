#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# CodePilot 一键部署脚本
# 自动检查环境、安装依赖、构建并启动应用
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# ── 颜色定义 ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ── 工具函数 ──────────────────────────────────────────────────
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()    { echo -e "${RED}[FAIL]${NC}  $*"; }
step()    { echo -e "\n${BOLD}${CYAN}── $* ──${NC}"; }

# 比较版本号: version_ge "20.0.0" "18.0.0" → true
version_ge() {
  [ "$(printf '%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
}

# ── 全局变量 ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MIN_NODE_VERSION="18.0.0"
MIN_NPM_VERSION="9.0.0"
ERRORS=()        # 收集致命错误
WARNINGS=()      # 收集非致命警告
AUTO_FIX=${AUTO_FIX:-1}   # 设为 0 可跳过自动安装

# ── 帮助信息 ──────────────────────────────────────────────────
show_help() {
  cat <<'EOF'
CodePilot 一键部署脚本

用法:
  ./scripts/setup.sh [选项]

选项:
  --web           仅启动浏览器模式 (npm run dev)
  --desktop       启动完整桌面应用 (electron:dev)
  --check-only    只检查环境，不启动应用
  --skip-install  跳过 npm install（依赖已安装时加速启动）
  --no-auto-fix   不自动安装缺失的工具
  --port PORT     指定 dev server 端口（默认 3000）
  -h, --help      显示此帮助信息

环境变量:
  AUTO_FIX=0      等同于 --no-auto-fix
  PORT=3001       等同于 --port 3001

示例:
  ./scripts/setup.sh                   # 检查环境 + 安装依赖 + 启动浏览器模式
  ./scripts/setup.sh --desktop         # 检查环境 + 安装依赖 + 启动桌面应用
  ./scripts/setup.sh --check-only      # 只检查环境是否就绪
EOF
  exit 0
}

# ── 解析参数 ──────────────────────────────────────────────────
MODE="web"          # web | desktop | check
SKIP_INSTALL=0
PORT="${PORT:-3000}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --web)          MODE="web";     shift ;;
    --desktop)      MODE="desktop"; shift ;;
    --check-only)   MODE="check";   shift ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    --no-auto-fix)  AUTO_FIX=0;     shift ;;
    --port)         PORT="$2";      shift 2 ;;
    -h|--help)      show_help ;;
    *)              warn "未知参数: $1"; shift ;;
  esac
done

# ══════════════════════════════════════════════════════════════
# 阶段 1: 环境检查
# ══════════════════════════════════════════════════════════════
step "1/5 检查系统环境"

OS="$(uname -s)"
ARCH="$(uname -m)"
info "系统: $OS $ARCH"

# ── 检查 Node.js ──────────────────────────────────────────────
check_node() {
  if ! command -v node &>/dev/null; then
    fail "未找到 Node.js"
    if [[ "$AUTO_FIX" == "1" ]]; then
      info "尝试自动安装 Node.js ..."
      install_node
    else
      ERRORS+=("Node.js 未安装。请前往 https://nodejs.org/ 下载 LTS 版本（>= $MIN_NODE_VERSION）")
      return
    fi
  fi

  local node_ver
  node_ver="$(node --version | sed 's/^v//')"
  if version_ge "$node_ver" "$MIN_NODE_VERSION"; then
    success "Node.js $node_ver (>= $MIN_NODE_VERSION)"
  else
    fail "Node.js $node_ver 版本过低（需要 >= $MIN_NODE_VERSION）"
    ERRORS+=("Node.js 版本过低: $node_ver，需要 >= $MIN_NODE_VERSION。请升级: https://nodejs.org/")
  fi
}

install_node() {
  # 尝试常见的包管理器
  if command -v nvm &>/dev/null; then
    info "通过 nvm 安装 Node.js 18 ..."
    nvm install 18 && nvm use 18
  elif command -v fnm &>/dev/null; then
    info "通过 fnm 安装 Node.js 18 ..."
    fnm install 18 && fnm use 18
  elif command -v brew &>/dev/null; then
    info "通过 Homebrew 安装 Node.js ..."
    brew install node@18
  elif command -v apt-get &>/dev/null; then
    info "通过 apt 安装 Node.js ..."
    # 使用 NodeSource 仓库
    if command -v curl &>/dev/null; then
      curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
      sudo apt-get install -y nodejs
    else
      ERRORS+=("无法自动安装 Node.js（缺少 curl）。请手动安装: https://nodejs.org/")
    fi
  elif command -v yum &>/dev/null; then
    info "通过 yum 安装 Node.js ..."
    if command -v curl &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
      sudo yum install -y nodejs
    else
      ERRORS+=("无法自动安装 Node.js（缺少 curl）。请手动安装: https://nodejs.org/")
    fi
  else
    ERRORS+=("无法自动安装 Node.js，未检测到支持的包管理器。请手动安装: https://nodejs.org/")
  fi
}

# ── 检查 npm ──────────────────────────────────────────────────
check_npm() {
  if ! command -v npm &>/dev/null; then
    fail "未找到 npm"
    ERRORS+=("npm 未安装。通常随 Node.js 一起安装，请重新安装 Node.js")
    return
  fi

  local npm_ver
  npm_ver="$(npm --version)"
  if version_ge "$npm_ver" "$MIN_NPM_VERSION"; then
    success "npm $npm_ver (>= $MIN_NPM_VERSION)"
  else
    fail "npm $npm_ver 版本过低（需要 >= $MIN_NPM_VERSION）"
    if [[ "$AUTO_FIX" == "1" ]]; then
      info "升级 npm ..."
      npm install -g npm@latest && success "npm 已升级到 $(npm --version)"
    else
      ERRORS+=("npm 版本过低: $npm_ver，需要 >= $MIN_NPM_VERSION。运行: npm install -g npm@latest")
    fi
  fi
}

# ── 检查 Git ──────────────────────────────────────────────────
check_git() {
  if ! command -v git &>/dev/null; then
    fail "未找到 Git"
    if [[ "$AUTO_FIX" == "1" ]]; then
      install_git
    else
      ERRORS+=("Git 未安装。请安装: https://git-scm.com/")
    fi
  else
    success "Git $(git --version | awk '{print $3}')"
  fi
}

install_git() {
  if command -v brew &>/dev/null; then
    brew install git
  elif command -v apt-get &>/dev/null; then
    sudo apt-get install -y git
  elif command -v yum &>/dev/null; then
    sudo yum install -y git
  else
    ERRORS+=("无法自动安装 Git。请手动安装: https://git-scm.com/")
  fi
}

# ── 检查 C++ 编译工具（better-sqlite3 需要）──────────────────
check_build_tools() {
  case "$OS" in
    Darwin)
      if xcode-select -p &>/dev/null; then
        success "Xcode Command Line Tools 已安装"
      else
        warn "未检测到 Xcode Command Line Tools（better-sqlite3 编译需要）"
        if [[ "$AUTO_FIX" == "1" ]]; then
          info "安装 Xcode Command Line Tools ..."
          xcode-select --install 2>/dev/null || true
          warn "请在弹出窗口中确认安装，安装完成后重新运行此脚本"
          ERRORS+=("需要安装 Xcode Command Line Tools，请在弹窗中确认后重新运行脚本")
        else
          ERRORS+=("缺少 Xcode Command Line Tools。运行: xcode-select --install")
        fi
      fi
      ;;
    Linux)
      local missing_tools=()
      if ! command -v gcc &>/dev/null && ! command -v cc &>/dev/null; then
        missing_tools+=("gcc/cc")
      fi
      if ! command -v make &>/dev/null; then
        missing_tools+=("make")
      fi
      if ! command -v python3 &>/dev/null && ! command -v python &>/dev/null; then
        missing_tools+=("python3")
      fi

      if [[ ${#missing_tools[@]} -eq 0 ]]; then
        success "C++ 编译工具已就绪 (gcc, make, python3)"
      else
        fail "缺少编译工具: ${missing_tools[*]}"
        if [[ "$AUTO_FIX" == "1" ]]; then
          info "安装编译工具 ..."
          if command -v apt-get &>/dev/null; then
            sudo apt-get update && sudo apt-get install -y build-essential python3
          elif command -v yum &>/dev/null; then
            sudo yum groupinstall -y "Development Tools" && sudo yum install -y python3
          elif command -v pacman &>/dev/null; then
            sudo pacman -S --noconfirm base-devel python
          else
            ERRORS+=("无法自动安装编译工具。请手动安装 gcc, make, python3")
          fi
          # 验证安装结果
          if command -v gcc &>/dev/null && command -v make &>/dev/null; then
            success "编译工具安装完成"
          fi
        else
          ERRORS+=("缺少编译工具: ${missing_tools[*]}。Debian/Ubuntu: sudo apt-get install build-essential python3")
        fi
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      # Windows 环境下的检查较为复杂，给出提示即可
      warn "Windows 环境请确保已安装 Visual Studio Build Tools (C++ 桌面开发)"
      ;;
  esac
}

# ── 检查 Claude Code CLI ─────────────────────────────────────
check_claude_cli() {
  if ! command -v claude &>/dev/null; then
    warn "未找到 Claude Code CLI"
    if [[ "$AUTO_FIX" == "1" ]]; then
      info "安装 Claude Code CLI ..."
      npm install -g @anthropic-ai/claude-code
      if command -v claude &>/dev/null; then
        success "Claude Code CLI $(claude --version 2>/dev/null || echo '已安装')"
        warn "请稍后运行 'claude login' 完成认证"
        WARNINGS+=("Claude Code CLI 已安装但尚未认证，启动应用前请运行: claude login")
      else
        WARNINGS+=("Claude Code CLI 安装失败，这不影响基本功能，但代码对话功能需要它。手动安装: npm install -g @anthropic-ai/claude-code")
      fi
    else
      WARNINGS+=("Claude Code CLI 未安装。代码对话功能需要它: npm install -g @anthropic-ai/claude-code && claude login")
    fi
  else
    local claude_ver
    claude_ver="$(claude --version 2>/dev/null || echo 'unknown')"
    success "Claude Code CLI $claude_ver"
  fi
}

# 执行所有检查
check_node
check_npm
check_git
check_build_tools
check_claude_cli

# ── 检查结果汇总 ──────────────────────────────────────────────
if [[ ${#ERRORS[@]} -gt 0 ]]; then
  step "环境检查未通过"
  for err in "${ERRORS[@]}"; do
    fail "$err"
  done
  echo ""
  fail "请修复以上问题后重新运行此脚本"
  exit 1
fi

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo ""
  for w in "${WARNINGS[@]}"; do
    warn "$w"
  done
fi

success "环境检查全部通过"

if [[ "$MODE" == "check" ]]; then
  echo ""
  success "环境就绪，可以启动 CodePilot！"
  echo -e "  浏览器模式: ${CYAN}./scripts/setup.sh --web${NC}"
  echo -e "  桌面模式:   ${CYAN}./scripts/setup.sh --desktop${NC}"
  exit 0
fi

# ══════════════════════════════════════════════════════════════
# 阶段 2: 安装项目依赖
# ══════════════════════════════════════════════════════════════
step "2/5 安装项目依赖"
cd "$PROJECT_DIR"

if [[ "$SKIP_INSTALL" == "1" ]]; then
  if [[ -d "node_modules" ]]; then
    info "跳过 npm install (--skip-install)"
  else
    warn "node_modules 不存在，忽略 --skip-install 并执行安装"
    SKIP_INSTALL=0
  fi
fi

if [[ "$SKIP_INSTALL" == "0" ]]; then
  info "运行 npm install（首次可能需要 3~5 分钟）..."
  if npm install 2>&1 | tail -5; then
    success "依赖安装完成"
  else
    fail "npm install 失败"
    echo ""
    info "常见原因及解决方法:"
    echo "  1. better-sqlite3 编译失败 → 安装编译工具后重试"
    echo "  2. 网络问题 → 检查代理设置，或使用国内镜像: npm config set registry https://registry.npmmirror.com"
    echo "  3. 权限问题 → 避免使用 sudo 运行 npm install"
    exit 1
  fi
fi

# ══════════════════════════════════════════════════════════════
# 阶段 3: 验证依赖完整性
# ══════════════════════════════════════════════════════════════
step "3/5 验证依赖完整性"

verify_dependency() {
  local pkg="$1"
  local desc="$2"
  if [[ -d "node_modules/$pkg" ]]; then
    success "$desc ($pkg)"
    return 0
  else
    fail "缺失: $desc ($pkg)"
    return 1
  fi
}

DEPS_OK=1
# 核心依赖检查
verify_dependency "next"                      "Next.js 框架"          || DEPS_OK=0
verify_dependency "react"                     "React"                 || DEPS_OK=0
verify_dependency "electron"                  "Electron"              || DEPS_OK=0
verify_dependency "better-sqlite3"            "SQLite 数据库"          || DEPS_OK=0
verify_dependency "@anthropic-ai/claude-code" "Claude Code SDK"       || DEPS_OK=0
verify_dependency "concurrently"              "并发任务管理"            || DEPS_OK=0
verify_dependency "wait-on"                   "端口等待工具"            || DEPS_OK=0
verify_dependency "esbuild"                   "Electron 构建工具"      || DEPS_OK=0

# 检查 better-sqlite3 原生模块是否编译成功
if [[ -d "node_modules/better-sqlite3" ]]; then
  if node -e "require('better-sqlite3')" 2>/dev/null; then
    success "better-sqlite3 原生模块加载正常"
  else
    fail "better-sqlite3 原生模块加载失败（可能需要重新编译）"
    if [[ "$AUTO_FIX" == "1" ]]; then
      info "尝试重新编译 better-sqlite3 ..."
      npm rebuild better-sqlite3 2>&1 | tail -3
      if node -e "require('better-sqlite3')" 2>/dev/null; then
        success "better-sqlite3 重新编译成功"
      else
        DEPS_OK=0
        fail "better-sqlite3 重新编译仍然失败，请检查编译工具是否安装完整"
      fi
    else
      DEPS_OK=0
    fi
  fi
fi

if [[ "$DEPS_OK" == "0" ]]; then
  warn "部分依赖缺失，尝试重新安装 ..."
  npm install
  success "依赖补全完成"
fi

# ══════════════════════════════════════════════════════════════
# 阶段 4: 构建 Electron 主进程
# ══════════════════════════════════════════════════════════════
step "4/5 构建 Electron 主进程"

if [[ "$MODE" == "desktop" ]] || [[ ! -f "dist-electron/main.js" ]]; then
  info "编译 electron/main.ts → dist-electron/main.js ..."
  if node scripts/build-electron.mjs; then
    success "Electron 主进程构建完成"
  else
    if [[ "$MODE" == "desktop" ]]; then
      fail "Electron 主进程构建失败"
      exit 1
    else
      warn "Electron 主进程构建失败（浏览器模式不影响使用）"
    fi
  fi
else
  info "dist-electron/main.js 已存在，跳过构建"
fi

# ── Linux: 处理 Electron sandbox 问题 ─────────────────────────
if [[ "$MODE" == "desktop" && "$OS" == "Linux" ]]; then
  SANDBOX="$PROJECT_DIR/node_modules/electron/dist/chrome-sandbox"
  if [[ -f "$SANDBOX" ]]; then
    SANDBOX_OWNER="$(stat -c '%U' "$SANDBOX" 2>/dev/null || echo 'unknown')"
    SANDBOX_PERM="$(stat -c '%a' "$SANDBOX" 2>/dev/null || echo '0')"
    if [[ "$SANDBOX_OWNER" != "root" || "$SANDBOX_PERM" != "4755" ]]; then
      warn "Electron sandbox 权限未配置（Linux 桌面模式需要）"
      info "你可以选择："
      echo "  1) sudo 修复权限（更安全）"
      echo "  2) 禁用 sandbox 启动（仅限开发环境）"
      echo ""
      read -rp "请选择 [1/2]（默认 2）: " sandbox_choice
      sandbox_choice="${sandbox_choice:-2}"
      if [[ "$sandbox_choice" == "1" ]]; then
        sudo chown root:root "$SANDBOX"
        sudo chmod 4755 "$SANDBOX"
        success "Sandbox 权限已修复"
      else
        export ELECTRON_DISABLE_SANDBOX=1
        info "已设置 ELECTRON_DISABLE_SANDBOX=1"
      fi
    fi
  fi
fi

# ══════════════════════════════════════════════════════════════
# 阶段 5: 启动应用
# ══════════════════════════════════════════════════════════════
step "5/5 启动 CodePilot"

# 检查端口占用
if command -v lsof &>/dev/null && lsof -i ":$PORT" &>/dev/null; then
  warn "端口 $PORT 已被占用"
  # 尝试找一个空闲端口
  for try_port in 3001 3002 3003 3004 3005; do
    if ! lsof -i ":$try_port" &>/dev/null; then
      PORT="$try_port"
      info "自动切换到端口 $PORT"
      break
    fi
  done
fi

echo ""
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo -e "${BOLD}  CodePilot v$(node -p "require('./package.json').version")${NC}"
echo -e "${BOLD}═══════════════════════════════════════════${NC}"
echo ""

case "$MODE" in
  web)
    info "启动浏览器模式 ..."
    echo -e "  访问地址: ${CYAN}http://localhost:${PORT}${NC}"
    echo -e "  停止服务: ${YELLOW}Ctrl+C${NC}"
    echo ""
    PORT="$PORT" exec npm run dev
    ;;
  desktop)
    info "启动桌面应用 ..."
    echo -e "  Next.js:  ${CYAN}http://localhost:${PORT}${NC}"
    echo -e "  停止服务: ${YELLOW}Ctrl+C${NC}"
    echo ""
    PORT="$PORT" exec npm run electron:dev
    ;;
esac
