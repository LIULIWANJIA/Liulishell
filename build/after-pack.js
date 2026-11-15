'use strict';
/**
 * 打包后精简体积（仅 Windows）：
 * dxcompiler.dll 是 Chromium Dawn / WebGPU 的 HLSL 编译器，约 25MB。
 * 本项目只用终端 + SFTP + 图表，不启用 WebGPU，删掉后启动与渲染都走 ANGLE(D3D11) 不受影响。
 * 若以后要支持 WebGPU / 需要在网页里跑 3D，把这里清空即可恢复。
 */
const fs = require('fs');
const path = require('path');

const DROP = ['dxcompiler.dll'];

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const dir = context.appOutDir;
  let saved = 0;
  for (const name of DROP) {
    const file = path.join(dir, name);
    try {
      const st = fs.statSync(file);
      fs.unlinkSync(file);
      saved += st.size;
    } catch (_) {
      /* 不存在就跳过 */
    }
  }
  if (saved > 0) {
    console.log(`  • 体积精简：移除未使用的 ${DROP.join(', ')}，节省 ${(saved / 1048576).toFixed(1)} MB`);
  }
};
