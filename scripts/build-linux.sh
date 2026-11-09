#!/usr/bin/env bash
# ============================================================
# LIULI Shell Linux 构建脚本（x64 / arm64 自动识别）
#
# 用法：
#   bash scripts/build-linux.sh                # 交互式：识别系统 → 装依赖 → 选包类型 → 打包 → 询问安装
#   bash scripts/build-linux.sh deb            # 直接打 .deb（非交互）
#   bash scripts/build-linux.sh appimage       # 直接打 AppImage（非交互）
#   bash scripts/build-linux.sh both           # deb + AppImage 都打
#   bash scripts/build-linux.sh tar            # 只打 tar.gz
#   bash scripts/build-linux.sh deps           # 只安装 / 补全系统依赖
#   bash scripts/build-linux.sh repair         # 修复打包环境（dpkg 中断、依赖破损、npm 缓存等）
#   bash scripts/build-linux.sh check          # 只体检：打印系统信息与依赖缺失情况，不改动系统
#
# 常用开关（可加在命令后面）：
#   --yes  | -y       安装前不再询问
#   --no-install      打完包不安装
#   --no-deps         跳过系统依赖安装
#
# 说明：
#   - 自动识别发行版 / 版本 / 架构，按版本决定包名（Ubuntu 24.04+、Debian 13+ 的 *t64 命名）。
#   - 每个依赖先检测是否已装，只装缺的；装失败会自动回退到 t64 包名 / 备用包名。
#   - deb 安装：调用 apt install，并创建桌面应用图标。
#   - AppImage 安装：放到 ~/Applications/LIULI-Shell/（含图标），并创建应用菜单与桌面图标。
# ============================================================
set -uo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
cd "$(dirname "$SCRIPT_PATH")/.." || exit 1
PROJECT_DIR="$(pwd)"

# ---------------- 输出 ----------------
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_INFO=$'\033[36m'; C_WARN=$'\033[33m'; C_ERR=$'\033[31m'
  C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_OK=; C_INFO=; C_WARN=; C_ERR=; C_DIM=; C_BOLD=; C_OFF=
fi
log()  { printf '%s[liuli]%s %s\n' "$C_INFO" "$C_OFF" "$*"; }
ok()   { printf '%s[  ok ]%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s[liuli]%s %s\n' "$C_WARN" "$C_OFF" "$*"; }
bad()  { printf '%s[liuli]%s %s\n' "$C_ERR" "$C_OFF" "$*"; }
die()  { bad "$*"; exit 1; }
dim()  { printf '%s%s%s\n' "$C_DIM" "$*" "$C_OFF"; }
hr()   { printf '%s\n' "────────────────────────────────────────────────────────"; }

# ---------------- 参数 ----------------
CMD=""
ASSUME_YES=0
DO_INSTALL=1
SKIP_DEPS=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes)        ASSUME_YES=1 ;;
    --no-install)    DO_INSTALL=0 ;;
    --no-deps)       SKIP_DEPS=1 ;;
    -h|--help|help)  sed -n '2,29p' "$0"; exit 0 ;;
    -*)              die "未知参数：$arg（用 --help 查看用法）" ;;
    *)               CMD="$arg" ;;
  esac
done
CMD="${CMD:-}"

# ---------------- 基本环境 ----------------
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
fi
ensure_privilege() { # 需要 root 时才提示，check / 打包不需要
  if [ "$(id -u)" -ne 0 ] && [ -z "$SUDO" ]; then
    bad "安装系统依赖需要 root 权限：请用 sudo 重新运行，或直接用 root 执行"
    return 1
  fi
  return 0
}

# 交互能力：只有真正的终端才询问
INTERACTIVE=0
[ -t 0 ] && [ -t 1 ] && INTERACTIVE=1
# 调试 / 测试用：没有终端时也可强制走交互流程
[ "${LIULI_FORCE_TTY:-0}" = "1" ] && INTERACTIVE=1

ask() { # ask <提示> <默认值 y/n>
  local prompt="$1" def="${2:-n}" ans=""
  # 非交互（CI / 管道）一律返回 no，避免自动化流程里擅自改动系统
  if [ "$INTERACTIVE" != "1" ]; then printf 'n'; return; fi
  if [ "$def" = "y" ]; then
    read -r -p "$(printf '%s[?]%s %s [Y/n] ' "$C_WARN" "$C_OFF" "$prompt")" ans || ans=""
    ans="${ans:-y}"
  else
    read -r -p "$(printf '%s[?]%s %s [y/N] ' "$C_WARN" "$C_OFF" "$prompt")" ans || ans=""
    ans="${ans:-n}"
  fi
  case "$ans" in [yY]*) printf 'y' ;; *) printf 'n' ;; esac
}

# ---------------- 系统识别 ----------------
DISTRO_ID=""; DISTRO_NAME=""; DISTRO_VER=""; DISTRO_LIKE=""; DISTRO_CODENAME=""
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  DISTRO_ID="${ID:-}"; DISTRO_VER="${VERSION_ID:-}"; DISTRO_LIKE="${ID_LIKE:-}"
  DISTRO_NAME="${PRETTY_NAME:-${NAME:-$DISTRO_ID}}"
  DISTRO_CODENAME="${VERSION_CODENAME:-}"
fi
[ -n "$DISTRO_NAME" ] || DISTRO_NAME="未知发行版"

PKG_MGR=""
for pm in apt-get dnf yum pacman zypper apk; do
  if command -v "$pm" >/dev/null 2>&1; then PKG_MGR="$pm"; break; fi
done

GLIBC_VER="$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}')"
[ -n "$GLIBC_VER" ] || GLIBC_VER="?"

# 架构：x86_64 → x64，aarch64 → arm64
case "$(uname -m)" in
  x86_64|amd64)  HOST_ARCH="x64" ;;
  aarch64|arm64) HOST_ARCH="arm64" ;;
  armv7l)        HOST_ARCH="armv7l" ;;
  *)             HOST_ARCH="$(uname -m)" ;;
esac
ARCH="${ARCH:-$HOST_ARCH}"

ver_ge() { # ver_ge 24.04 24.04  → 版本比较（只比数值段）
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]
}

# Ubuntu 24.04+ / Debian 13+ / Mint 22+ 使用 *t64 包名
PREFER_T64=0
case "$DISTRO_ID:$DISTRO_LIKE" in
  *ubuntu*|*debian*|*linuxmint*|*pop*|*deepin*|*kali*|*raspbian*)
    case "$DISTRO_ID" in
      debian)
        [ -n "$DISTRO_VER" ] && ver_ge "$DISTRO_VER" "13" && PREFER_T64=1 ;;
      linuxmint|pop)
        [ -n "$DISTRO_VER" ] && ver_ge "$DISTRO_VER" "22" && PREFER_T64=1 ;;
      *)
        [ -n "$DISTRO_VER" ] && ver_ge "$DISTRO_VER" "24.04" && PREFER_T64=1 ;;
    esac
    ;;
esac

banner() {
  hr
  printf '%sLIULI Shell · Linux 构建向导%s\n' "$C_BOLD" "$C_OFF"
  printf '  系统   : %s\n' "$DISTRO_NAME"
  printf '  内核   : %s (%s)\n' "$(uname -r)" "$HOST_ARCH"
  printf '  glibc  : %s\n' "$GLIBC_VER"
  printf '  包管理 : %s%s\n' "${PKG_MGR:-未识别}" "$([ "$PREFER_T64" = 1 ] && echo '（t64 命名）')"
  printf '  目录   : %s\n' "$PROJECT_DIR"
  hr
}

# ---------------- 包管理封装 ----------------
pkg_installed() { # pkg_installed <name>
  case "$PKG_MGR" in
    apt-get) dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed" ;;
    dnf|yum|zypper) rpm -q "$1" >/dev/null 2>&1 ;;
    pacman)  pacman -Q "$1" >/dev/null 2>&1 ;;
    apk)     apk info -e "$1" >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

pkg_install_quiet() { # pkg_install_quiet <name> → 成功返回 0
  case "$PKG_MGR" in
    apt-get) $SUDO apt-get install -y --no-install-recommends "$1" >/dev/null 2>&1 ;;
    dnf)     $SUDO dnf install -y "$1" >/dev/null 2>&1 ;;
    yum)     $SUDO yum install -y "$1" >/dev/null 2>&1 ;;
    zypper)  $SUDO zypper --non-interactive install "$1" >/dev/null 2>&1 ;;
    pacman)  $SUDO pacman -S --needed --noconfirm "$1" >/dev/null 2>&1 ;;
    apk)     $SUDO apk add --no-cache "$1" >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

# 装一个包，失败自动尝试 “同名 + t64” 等变体
install_one() { # install_one <name> [<label>]
  local name="$1" label="${2:-$1}" v
  if pkg_installed "$name"; then ok "$label 已安装"; return 0; fi
  if [ "$PREFER_T64" = 1 ] && pkg_installed "${name}t64"; then ok "$label 已安装（${name}t64）"; return 0; fi

  local variants
  if [ "$PREFER_T64" = 1 ]; then variants="${name}t64 $name"; else variants="$name ${name}t64"; fi
  for v in $variants; do
    if pkg_install_quiet "$v"; then
      ok "$label 安装完成（$v）"
      return 0
    fi
  done
  bad "$label 安装失败（已尝试：$variants）"
  return 1
}

# ---------------- 依赖清单 ----------------
# 基础构建工具
BASE_APT=(git curl ca-certificates build-essential python3 fakeroot dpkg-dev)
# Electron 运行时库（打包与运行都需要，缺了打包能过但启动会崩）
LIBS_APT=(
  libnss3 libgbm1 libxss1 libxtst6 libx11-xcb1 libxcb-dri3-0 libxshmfence1
  libdrm2 libcairo2 libpango-1.0-0 libxrandr2 libxcomposite1 libxdamage1
  libxfixes3 libxkbcommon0 libbsd0 libexpat1
  libasound2 libgtk-3-0 libatk-bridge2.0-0 libatk1.0-0 libcups2
  libnotify4 libatspi2.0-0 libsecret-1-0 libglib2.0-0 libgdk-pixbuf-2.0-0
)
BASE_DNF=(git curl ca-certificates gcc-c++ make python3 rpm-build)
LIBS_DNF=(
  nss gtk3 alsa-lib libXScrnSaver libXtst libxkbcommon at-spi2-atk cups-libs
  libsecret libnotify mesa-libgbm libdrm
)
BASE_PACMAN=(base-devel git curl python)
LIBS_PACMAN=(
  nss gtk3 alsa-lib libxss libxtst libxkbcommon at-spi2-core cups libsecret
  libnotify mesa fuse2
)
BASE_ZYPPER=(git curl gcc-c++ make python3 rpm-build)
LIBS_ZYPPER=(
  mozilla-nss gtk3 alsa-lib libXScrnSaver libXtst6 libxkbcommon at-spi2-core
  cups-libs libsecret-1-0 libnotify mesa-libgbm
)

FAILED_PKGS=()

install_group() { # install_group <label> <pkg...>
  local label="$1"; shift
  local p
  log "$label"
  for p in "$@"; do
    install_one "$p" "$p" || FAILED_PKGS+=("$p")
  done
}

refresh_repo_meta() {
  case "$PKG_MGR" in
    apt-get) log "刷新 apt 索引"; $SUDO apt-get update -y >/dev/null 2>&1 || warn "apt-get update 失败（稍后可运行 repair 尝试修复源）" ;;
    dnf)     $SUDO dnf makecache -y >/dev/null 2>&1 || warn "dnf makecache 失败" ;;
    pacman)  $SUDO pacman -Sy --noconfirm >/dev/null 2>&1 || warn "pacman -Sy 失败" ;;
    zypper)  $SUDO zypper --non-interactive refresh >/dev/null 2>&1 || warn "zypper refresh 失败" ;;
  esac
}

install_system_deps() {
  local mgr="$PKG_MGR"
  ensure_privilege || return 1
  if [ -z "$mgr" ]; then
    case "$DISTRO_ID$DISTRO_LIKE" in
      *ubuntu*|*debian*) mgr="apt-get" ;;
      *fedora*|*rhel*|*centos*) mgr="dnf" ;;
      *arch*) mgr="pacman" ;;
      *suse*) mgr="zypper" ;;
      *) warn "未识别包管理器，跳过系统依赖安装"; return 0 ;;
    esac
    PKG_MGR="$mgr"
  fi

  refresh_repo_meta
  case "$mgr" in
    apt-get)
      install_group "基础工具（apt）" "${BASE_APT[@]}"
      install_group "Electron 运行时库（apt）" "${LIBS_APT[@]}"
      install_one libfuse2 "libfuse2（AppImage 运行支持）" || true
      ;;
    dnf|yum)
      install_group "基础工具（dnf）" "${BASE_DNF[@]}"
      install_group "Electron 运行时库（dnf）" "${LIBS_DNF[@]}"
      ;;
    pacman)
      install_group "基础工具（pacman）" "${BASE_PACMAN[@]}"
      install_group "Electron 运行时库（pacman）" "${LIBS_PACMAN[@]}"
      ;;
    zypper)
      install_group "基础工具（zypper）" "${BASE_ZYPPER[@]}"
      install_group "Electron 运行时库（zypper）" "${LIBS_ZYPPER[@]}"
      ;;
    *) warn "暂不支持的包管理器：$mgr" ;;
  esac
}

install_node() {
  local major=0
  if command -v node >/dev/null 2>&1; then
    major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  fi
  if [ "${major:-0}" -ge 18 ] 2>/dev/null; then
    ok "Node $(node -v) / npm $(npm -v 2>/dev/null || echo '?') 可用"
    return 0
  fi

  warn "未检测到可用 Node（需要 ≥ 18），尝试安装 Node 20"
  case "$PKG_MGR" in
    apt-get)
      if curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh 2>/dev/null; then
        $SUDO bash /tmp/nodesource_setup.sh >/dev/null 2>&1 || warn "NodeSource 源配置失败，尝试发行版自带 nodejs"
        $SUDO apt-get install -y nodejs >/dev/null 2>&1 || true
      fi
      if ! command -v node >/dev/null 2>&1; then
        $SUDO apt-get install -y nodejs npm >/dev/null 2>&1 || true
      fi
      ;;
    dnf|yum) pkg_install_quiet nodejs || true; pkg_install_quiet npm || true ;;
    pacman)  pkg_install_quiet nodejs || true; pkg_install_quiet npm || true ;;
    zypper)  pkg_install_quiet nodejs20 || pkg_install_quiet nodejs || true ;;
    *)
      if command -v curl >/dev/null 2>&1; then
        log "尝试用 nvm 安装 Node 20"
        curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh 2>/dev/null | bash >/dev/null 2>&1 || true
        # shellcheck disable=SC1091
        [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" && nvm install 20 >/dev/null 2>&1 && nvm use 20 >/dev/null 2>&1 || true
      fi
      ;;
  esac

  if ! command -v npm >/dev/null 2>&1; then
    bad "仍然找不到 npm，请手动安装 Node.js 20 后重试"
    return 1
  fi
  major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  [ "$major" -ge 18 ] || { warn "当前 Node $(node -v) 低于 18，electron-builder 可能报错"; return 1; }
  ok "Node $(node -v) 就绪"
}

install_deps() {
  log "开始检测并补全构建依赖（只安装缺失的包）"
  FAILED_PKGS=()
  install_system_deps
  install_node || FAILED_PKGS+=("node")
  if [ "${#FAILED_PKGS[@]}" -gt 0 ]; then
    warn "以下依赖没能装上：${FAILED_PKGS[*]}"
    if [ "$(ask '是否尝试自动修复系统环境后重试？' y)" = "y" ]; then
      repair_env
      refresh_repo_meta
      install_system_deps
      install_node || true
    fi
  else
    ok "依赖检查完成，环境就绪"
  fi
}

# ---------------- 修复系统环境 ----------------
repair_env() {
  log "开始修复打包环境（可重复执行，不会删除个人数据）"
  ensure_privilege || return 1
  case "$PKG_MGR" in
    apt-get)
      if command -v fuser >/dev/null 2>&1 && fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; then
        warn "检测到 apt/dpkg 正被其他进程占用，请先等待它结束（或重启终端）"
      fi
      log "修复被中断的 dpkg 配置"
      $SUDO dpkg --configure -a >/dev/null 2>&1 || warn "dpkg --configure -a 有报错（通常可忽略）"
      log "修复破损依赖（apt-get -f install）"
      $SUDO apt-get -f install -y >/dev/null 2>&1 || warn "apt-get -f install 未完成，可能需要手动更换软件源"
      log "清理无用的残留包"
      $SUDO apt-get autoremove -y >/dev/null 2>&1 || true
      log "刷新 apt 索引"
      $SUDO apt-get update -y >/dev/null 2>&1 || warn "apt 索引刷新失败：请检查 /etc/apt/sources.list 与网络"
      ;;
    dnf|yum)
      $SUDO dnf clean all >/dev/null 2>&1 || true
      $SUDO dnf makecache -y >/dev/null 2>&1 || warn "dnf 元数据刷新失败"
      ;;
    pacman)
      $SUDO pacman -Sy --noconfirm >/dev/null 2>&1 || warn "pacman 同步失败，可尝试更换镜像：sudo pacman-mirrors -c China"
      ;;
    zypper)
      $SUDO zypper --non-interactive refresh >/dev/null 2>&1 || warn "zypper 刷新失败"
      ;;
  esac

  # npm / Electron 缓存
  if command -v npm >/dev/null 2>&1; then
    local reg
    reg="$(npm config get registry 2>/dev/null || echo '')"
    log "当前 npm 源：${reg:-默认}"
    if ! curl -fsS --max-time 6 "$(npm config get registry 2>/dev/null || echo https://registry.npmjs.org/)" >/dev/null 2>&1; then
      warn "npm 源不可达，临时切换到 npmmirror"
      npm config set registry https://registry.npmmirror.com >/dev/null 2>&1 || true
    fi
    npm cache verify >/dev/null 2>&1 || true
  fi

  # Electron 二进制损坏（下载不完整 / 解压失败）
  if [ -d node_modules/electron ] && [ ! -x node_modules/electron/dist/electron ]; then
    warn "检测到 Electron 二进制缺失，重新安装 electron 包"
    rm -rf node_modules/electron
    npm install electron --no-save >/dev/null 2>&1 || warn "electron 重装失败，请检查网络（可设置 ELECTRON_MIRROR）"
  fi

  # 构建产物权限
  [ -d dist ] && chmod -R u+rwX dist 2>/dev/null || true

  ok "环境修复流程结束"
}

# ---------------- 体检 ----------------
show_env_check() {
  banner
  printf '%s依赖检查%s（缺失项会在正式构建前自动安装）\n' "$C_BOLD" "$C_OFF"
  [ -n "${GLIBC_VER:-}" ] && [ "$GLIBC_VER" != "?" ] || warn "未能读取 glibc 版本"
  local list=() p
  case "$PKG_MGR" in
    apt-get) list=("${BASE_APT[@]}" "${LIBS_APT[@]}" libfuse2) ;;
    dnf|yum) list=("${BASE_DNF[@]}" "${LIBS_DNF[@]}") ;;
    pacman)  list=("${BASE_PACMAN[@]}" "${LIBS_PACMAN[@]}") ;;
    zypper)  list=("${BASE_ZYPPER[@]}" "${LIBS_ZYPPER[@]}") ;;
    *) warn "未识别包管理器，跳过依赖检查" ;;
  esac
  local missing=0
  for p in "${list[@]:-}"; do
    [ -n "$p" ] || continue
    if pkg_installed "$p" || { [ "$PREFER_T64" = 1 ] && pkg_installed "${p}t64"; }; then
      printf '  %s✓%s %s\n' "$C_OK" "$C_OFF" "$p"
    else
      printf '  %s✗%s %s\n' "$C_ERR" "$C_OFF" "$p"
      missing=$((missing + 1))
    fi
  done
  hr
  printf '缺失 %d 个 · Node: %s · npm: %s\n' "$missing" \
    "$(command -v node >/dev/null 2>&1 && node -v || echo '未安装')" \
    "$(command -v npm >/dev/null 2>&1 && npm -v || echo '未安装')"
  printf '运行 %sbash scripts/build-linux.sh%s 自动补齐并构建。\n' "$C_BOLD" "$C_OFF"
}

# ---------------- 选择包类型 ----------------
# 注意：结果直接写入全局 TARGET，不要写成 TARGET="$(choose_target)"，
# 否则菜单文字会被命令替换捕获，屏幕上只剩一行空的输入提示。
choose_target() {
  TARGET="deb"
  if [ "$INTERACTIVE" != "1" ]; then
    dim "非交互环境（CI / 管道），默认打包 .deb；要指定请用脚本参数，如 build-linux.sh appimage"
    return 0
  fi

  hr
  printf '%s请选择要打包的产物类型：%s\n\n' "$C_BOLD" "$C_OFF"
  printf '  %s1)%s .deb 安装包      —— %s用 apt/dpkg 安装，自动进应用菜单（默认）%s\n' "$C_OK" "$C_OFF" "$C_DIM" "$C_OFF"
  printf '  %s2)%s AppImage 便携包  —— %s单个文件免安装，chmod +x 直接运行%s\n' "$C_OK" "$C_OFF" "$C_DIM" "$C_OFF"
  printf '  %s3)%s 两种都要        —— %s同时产出 .deb 与 AppImage%s\n\n' "$C_OK" "$C_OFF" "$C_DIM" "$C_OFF"
  printf '  %s直接回车 = 选 1（.deb）；不支持的系统请选 2 或 3。%s\n' "$C_DIM" "$C_OFF"

  local a=""
  read -r -p "$(printf '%s输入 1 / 2 / 3 后回车：%s ' "$C_BOLD" "$C_OFF")" a || a=""
  case "$a" in
    ""|1) TARGET="deb" ;;
    2)    TARGET="appimage" ;;
    3)    TARGET="both" ;;
    *)    warn "输入「$a」无法识别，按默认处理：.deb"
          TARGET="deb" ;;
  esac
  ok "已选择：$(targets_for "$TARGET")"
}

targets_for() {
  case "$1" in
    deb)      echo "deb" ;;
    appimage) echo "AppImage" ;;
    both)     echo "deb AppImage" ;;
    all)      echo "AppImage deb tar.gz" ;;
    tar)      echo "tar.gz" ;;
    *) die "未知目标：$1（可选 deb / appimage / both / tar / all）" ;;
  esac
}

# ---------------- 构建 ----------------
build() {
  local target="$1" targets
  targets="$(targets_for "$target")"

  command -v npm >/dev/null 2>&1 || die "缺少 npm，请先运行：bash scripts/build-linux.sh deps"

  if [ ! -d node_modules ]; then
    log "安装 npm 依赖"
    npm ci --no-audit --no-fund || npm install --no-audit --no-fund || die "npm 依赖安装失败"
  fi
  log "准备前端资源（xterm → src/renderer/vendor）"
  npm run vendor || die "npm run vendor 失败"

  log "开始打包：--linux ${targets} --${ARCH}"
  local errlog; errlog="$(mktemp -t liuli-build-XXXX.log)"
  if npx electron-builder --linux ${targets} --"${ARCH}" 2>&1 | tee "$errlog"; then
    rm -f "$errlog"
  else
    warn "打包失败，尝试使用国内镜像重试一次"
    local mirrors=(
      "ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/"
      "ELECTRON_BUILDER_BINARIES_MIRROR=https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
    )
    if env "${mirrors[@]}" npx electron-builder --linux ${targets} --"${ARCH}" 2>&1 | tee "$errlog"; then
      rm -f "$errlog"
    else
      bad "打包仍然失败，以下是最后 30 行日志："
      tail -n 30 "$errlog"
      printf '\n常见处理：\n'
      printf '  - 依赖缺失 → bash scripts/build-linux.sh repair && bash scripts/build-linux.sh deps\n'
      printf '  - Electron 下载失败 → export ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/\n'
      printf '  - Node 版本过低 → 升级到 20 LTS 后删除 node_modules 重试\n'
      rm -f "$errlog"
      return 1
    fi
  fi

  log "产物目录：${PROJECT_DIR}/dist"
  ls -lh dist/*.AppImage dist/*.deb dist/*.tar.gz 2>/dev/null || true
  return 0
}

# ---------------- 桌面图标 ----------------
desktop_dir() {
  local d=""
  if command -v xdg-user-dir >/dev/null 2>&1; then d="$(xdg-user-dir DESKTOP 2>/dev/null || true)"; fi
  [ -z "$d" ] && d="$HOME/Desktop"
  [ -d "$d" ] || d="$HOME/桌面"
  mkdir -p "$d" 2>/dev/null || true
  printf '%s' "$d"
}

mark_trusted() { # 让 GNOME 桌面把 .desktop 当应用而不是文本文件
  local f="$1"
  chmod +x "$f" 2>/dev/null || true
  if command -v gio >/dev/null 2>&1; then
    gio set "$f" metadata::trusted true >/dev/null 2>&1 || true
    gio set "$f" metadata::xfce-exe-checksum "$(sha256sum "$f" 2>/dev/null | awk '{print $1}')" >/dev/null 2>&1 || true
  fi
}

refresh_app_menu() {
  local appdir="$HOME/.local/share/applications"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$appdir" >/dev/null 2>&1 || true
}

# deb 安装后：系统已生成 desktop 文件，复制一份到桌面
desktop_shortcut_for_deb() {
  local src=""
  for p in /usr/share/applications/*liuli*.desktop /usr/share/applications/*LIULI*.desktop; do
    [ -e "$p" ] && { src="$p"; break; }
  done
  if [ -z "$src" ]; then
    warn "没找到系统里的 desktop 文件，跳过桌面图标"
    return 0
  fi
  local dd; dd="$(desktop_dir)"
  local dest="$dd/liuli-shell.desktop"
  cp -f "$src" "$dest" 2>/dev/null || { warn "复制桌面图标失败（$dest）"; return 0; }
  mark_trusted "$dest"
  ok "已创建桌面图标：$dest"
}

# AppImage 安装：放到 ~/Applications/LIULI-Shell/，图标与启动器一起生成
install_appimage() {
  local src="$1"
  local appdir="$HOME/Applications/LIULI-Shell"
  local target="$appdir/LIULI-Shell.AppImage"
  local icondir="$appdir/icons"

  log "安装 AppImage 到 $appdir"
  mkdir -p "$appdir" "$icondir"
  cp -f "$src" "$target" || die "复制 AppImage 失败"
  chmod +x "$target"

  # 图标：优先用仓库内 build/icon.png，其次从 AppImage 里解出来
  local icon="$appdir/liuli-shell.png"
  if [ -f build/icon.png ]; then
    cp -f build/icon.png "$icon"
  else
    ( cd /tmp && "$target" --appimage-extract '*.png' >/dev/null 2>&1 && cp -f /tmp/squashfs-root/*.png "$icon" 2>/dev/null ) || true
  fi
  [ -f "$icon" ] || { warn "没取到图标，桌面图标将使用系统默认图标"; }

  # 应用菜单项
  local appdir_entry="$HOME/.local/share/applications/liuli-shell.desktop"
  mkdir -p "$(dirname "$appdir_entry")"
  cat > "$appdir_entry" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=LIULI Shell
Name[zh_CN]=LIULI Shell
Comment=跨平台 SSH 终端与服务器管理工具
Comment[zh_CN]=SSH 终端、SFTP 文件管理与服务器监控
Exec="$target" %U
Icon=$icon
Terminal=false
Categories=Development;System;Network;
Keywords=ssh;sftp;terminal;server;
StartupNotify=true
StartupWMClass=LIULI Shell
EOF
  chmod +x "$appdir_entry"
  refresh_app_menu
  ok "已注册应用菜单：$appdir_entry"

  # 桌面图标
  local dd; dd="$(desktop_dir)"
  cp -f "$appdir_entry" "$dd/liuli-shell.desktop" 2>/dev/null && mark_trusted "$dd/liuli-shell.desktop" \
    && ok "已创建桌面图标：$dd/liuli-shell.desktop"

  # 终端里能直接敲 liuli-shell
  local bindir="$HOME/.local/bin"
  mkdir -p "$bindir"
  if ln -sf "$target" "$bindir/liuli-shell" 2>/dev/null; then
    ok "已创建命令链接：$bindir/liuli-shell"
  else
    printf '#!/bin/sh\nexec "%s" "$@"\n' "$target" > "$bindir/liuli-shell" \
      && chmod +x "$bindir/liuli-shell" \
      && ok "已创建启动脚本：$bindir/liuli-shell"
  fi
  case ":$PATH:" in
    *":$bindir:"*) ;;
    *) warn "提示：$bindir 不在 PATH 里，想直接敲 liuli-shell 请把它加进 ~/.bashrc" ;;
  esac

  printf '\n  程序位置：%s\n  图标位置：%s\n' "$target" "$icon"
  printf '  卸载：rm -rf "%s" "%s" "%s/liuli-shell.desktop"\n' "$appdir" "$appdir_entry" "$dd"
}

find_deb() { ls -t dist/*.deb 2>/dev/null | head -1; }
find_appimage() { ls -t dist/*.AppImage 2>/dev/null | head -1; }

install_deb() {
  local deb; deb="$(find_deb)"
  [ -n "$deb" ] || { bad "没找到 .deb 产物，先打包再安装"; return 1; }
  ensure_privilege || return 1
  log "安装 $deb"
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get install -y "$deb" || { warn "apt 安装失败，回退 dpkg -i"; $SUDO dpkg -i "$deb" || return 1; $SUDO apt-get -f install -y >/dev/null 2>&1 || true; }
  else
    $SUDO dpkg -i "$deb" || { warn "dpkg 报错，尝试修复依赖"; $SUDO apt-get -f install -y >/dev/null 2>&1 || true; }
  fi
  ok "已安装 .deb：$(dpkg-deb -f "$deb" Package 2>/dev/null || basename "$deb")"
  desktop_shortcut_for_deb
  printf '\n  启动方式：应用菜单里搜索 “LIULI Shell”，或在终端执行 liuli-shell\n'
  printf '  卸载：sudo apt remove liuli-shell\n'
}

install_by_target() { # install_by_target deb|appimage
  case "$1" in
    deb) install_deb ;;
    appimage)
      local img; img="$(find_appimage)"
      [ -n "$img" ] || { bad "没找到 AppImage 产物"; return 1; }
      install_appimage "$img"
      ;;
  esac
}

# 打包完成后的安装询问
maybe_install() { # maybe_install <target>
  local target="$1"
  [ "$DO_INSTALL" = 1 ] || return 0
  local built=""
  case "$target" in
    deb) built="deb" ;;
    appimage) built="appimage" ;;
    both|all)
      local has_deb="" has_img=""
      [ -n "$(find_deb)" ] && has_deb=1
      [ -n "$(find_appimage)" ] && has_img=1
      if [ -n "$has_deb" ] && [ -n "$has_img" ]; then built="pick"; else
        [ -n "$has_deb" ] && built="deb"
        [ -z "$built" ] && [ -n "$has_img" ] && built="appimage"
      fi
      ;;
    tar) log "tar.gz 无需安装，解压即可运行"; return 0 ;;
  esac

  if [ "$INTERACTIVE" != "1" ]; then
    dim "（非交互环境，跳过安装询问；需要安装请加 --yes 或手动运行安装命令）"
    return 0
  fi

  hr
  if [ "$ASSUME_YES" != "1" ]; then
    [ "$(ask '是否现在安装刚打好的包？' n)" = "y" ] || { dim "已跳过安装"; return 0; }
  fi

  if [ "$built" = "pick" ]; then
    hr
    printf '%s两种产物都已生成，选择要安装的：%s\n\n' "$C_BOLD" "$C_OFF"
    printf '  %s1)%s .deb 安装包  —— %s用 apt 安装，自动进应用菜单（默认）%s\n' "$C_OK" "$C_OFF" "$C_DIM" "$C_OFF"
    printf '  %s2)%s AppImage     —— %s复制到 ~/Applications，并建桌面图标%s\n\n' "$C_OK" "$C_OFF" "$C_DIM" "$C_OFF"
    local a=""
    read -r -p "$(printf '%s输入 1 / 2 后回车：%s ' "$C_BOLD" "$C_OFF")" a || a=""
    case "$a" in
      2) built="appimage" ;;
      *) built="deb" ;;
    esac
    ok "准备安装：$built"
  fi
  install_by_target "$built"
}

# ---------------- 主流程 ----------------
main() {
  case "$CMD" in
    help) exit 0 ;;
    check) show_env_check; exit 0 ;;
    deps) banner; install_deps; exit 0 ;;
    repair) banner; repair_env; exit 0 ;;
    deb|appimage|both|tar|all) TARGET="$CMD" ;;
    "")
      banner
      choose_target
      ;;
    *) die "未知命令：$CMD（可选 deb / appimage / both / tar / all / deps / repair / check）" ;;
  esac

  [ "$CMD" = "" ] || [ "$CMD" = "deps" ] || banner
  if [ "$SKIP_DEPS" != "1" ]; then
    install_deps
  else
    warn "已跳过依赖安装（--no-deps）"
  fi
  if [ "$CMD" = "deps" ]; then exit 0; fi

  log "目标产物：$(targets_for "$TARGET")"
  build "$TARGET" || die "构建失败，未产出安装包"

  hr
  ok "构建完成，产物在上面的 dist/ 目录"
  maybe_install "$TARGET"
  hr
}

# 作为脚本执行时才跑主流程（便于 source 后单独测试某个函数）
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main
fi
