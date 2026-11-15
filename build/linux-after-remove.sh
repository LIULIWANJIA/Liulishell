#!/bin/bash

# dpkg 先删除程序文件再执行 postrm，update-alternatives 找不到候选项时会打印
# “候选项不存在 / 链接未决”警告；卸载结果不受影响，这里静默并清理残留链接。
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}' 2>/dev/null || true
else
    rm -f '/usr/bin/${executable}'
fi

for link in '/usr/bin/${executable}' '/etc/alternatives/${executable}'; do
    if [ -L "$link" ] && [ ! -e "$link" ]; then
        rm -f "$link"
    fi
done

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi