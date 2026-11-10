; ============================================================
; LIULI Shell 安装器自定义脚本（electron-builder assisted installer）
;
; 能力：
;   1. 检查当前已安装版本（读卸载项的 DisplayVersion）
;   2. 升级时沿用已有安装目录，避免同一台机器出现两份安装
;   3. 升级 / 覆盖安装都不会触碰用户数据
;
; 数据位置：%APPDATA%\LIULI Shell（liulishell-data.json + 加密凭据）
;   - 安装器的 RMDir /r 只作用于安装目录 $INSTDIR
;   - package.json 里 deleteAppDataOnUninstall = false，卸载也不删数据
;   - 因此升级、重装、卸载后重装都能保留服务器配置
;
; 注意：便携版的 exe 不要放进安装目录（$INSTDIR 升级时会被整体清空）。
; ============================================================

!ifndef BUILD_UNINSTALLER

!include "LogicLib.nsh"
!include "WordFunc.nsh"
!include "WinMessages.nsh"

Var isUpgrade      ; 1 = 检测到更低版本，本次为升级
Var prevVersion    ; 已安装版本号（空表示全新安装）
Var prevDir        ; 已安装目录

; 读注册表值：先当前安装模式的根键，再 HKLM，最后 HKCU（兼容历史上装到别的模式的情况）
!macro readRegAny out keyName regKey
  ReadRegStr ${out} SHELL_CONTEXT "${regKey}" "${keyName}"
  ${If} ${out} == ""
    ReadRegStr ${out} HKLM "${regKey}" "${keyName}"
  ${EndIf}
  ${If} ${out} == ""
    ReadRegStr ${out} HKCU "${regKey}" "${keyName}"
  ${EndIf}
!macroend

!macro customInit
  StrCpy $isUpgrade "0"
  StrCpy $prevVersion ""
  StrCpy $prevDir ""

  ; ---- 1. 已安装版本 ----
  !insertmacro readRegAny $0 "DisplayVersion" "${UNINSTALL_REGISTRY_KEY}"
  StrCpy $prevVersion $0

  ; ---- 2. 已安装目录 ----
  !insertmacro readRegAny $1 "InstallLocation" "${INSTALL_REGISTRY_KEY}"
  ${If} $1 == ""
    !insertmacro readRegAny $1 "InstallLocation" "${UNINSTALL_REGISTRY_KEY}"
  ${EndIf}
  StrCpy $prevDir $1

  ; ---- 3. 决定安装目录：升级原地覆盖，全新安装默认 D:\LIULISHELL ----
  ${If} $prevDir != ""
    StrCpy $INSTDIR "$prevDir"
  ${ElseIf} ${FileExists} "D:\*.*"
    StrCpy $INSTDIR "D:\LIULISHELL"
  ${Else}
    StrCpy $INSTDIR "$PROGRAMFILES64\LIULI Shell"
  ${EndIf}

  ; ---- 4. 版本比较 ----
  ${If} $prevVersion != ""
    ${VersionCompare} "$prevVersion" "${VERSION}" $2
    ${If} $2 == 2
      ; 旧版本 -> 升级
      StrCpy $isUpgrade "1"
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONINFORMATION|MB_TOPMOST "检测到已安装 LIULI Shell $prevVersion。$\r$\n$\r$\n本次将升级到 ${VERSION}，安装位置：$\r$\n$INSTDIR$\r$\n$\r$\n服务器配置、密钥、快捷命令与外观设置都会保留。"
      ${EndIf}
    ${ElseIf} $2 == 0
      ; 同版本 -> 覆盖安装
      ${IfNot} ${Silent}
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_TOPMOST "已安装 LIULI Shell $prevVersion，与当前安装包版本相同。$\r$\n$\r$\n继续将覆盖安装，配置数据会保留。$\r$\n是否继续？" IDYES +2
        Quit
      ${EndIf}
    ${Else}
      ; 已装版本更高 -> 降级确认
      ${IfNot} ${Silent}
        MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_TOPMOST "检测到已安装更高版本 LIULI Shell $prevVersion（当前安装包 ${VERSION}）。$\r$\n$\r$\n继续安装会降级到 ${VERSION}，配置数据会保留。$\r$\n是否继续？" IDYES +2
        Quit
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; 目录选择页：升级时整页跳过（直接用已安装目录，防止装出第二份）
!macro customWelcomePage
  !define MUI_PAGE_CUSTOMFUNCTION_PRE dirPagePre
  !insertmacro MUI_PAGE_DIRECTORY
  !define MUI_PAGE_CUSTOMFUNCTION_PRE instfilesUpgradePre
!macroend

Function dirPagePre
  ${If} $isUpgrade == "1"
    Abort
  ${EndIf}
FunctionEnd

; 安装页把「安装」按钮文案改成「升级」
Function instfilesUpgradePre
  ${If} $isUpgrade == "1"
    GetDlgItem $0 $HWNDPARENT 1
    SendMessage $0 ${WM_SETTEXT} 0 "STR:升级"
  ${EndIf}
FunctionEnd

!endif

; ============================================================
; 卸载时清掉「界面缩放」偏好
;
; 缩放值刻意不写进 %APPDATA%\LIULI Shell\liulishell-data.json，
; 而是单独存 zoom.conf（优先安装目录），避免用户把界面放大到点不到设置项、
; 重装后又继承同一个错误比例。这里再把可能落在 userData 的那份也删掉。
; ============================================================
!macro customUnInstall
  Delete "$INSTDIR\zoom.conf"
  Delete "$APPDATA\LIULI Shell\zoom.conf"
!macroend
