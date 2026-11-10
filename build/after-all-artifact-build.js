'use strict';
/**
 * 所有安装包生成完毕后清理中间产物：
 * 「*-unpacked」目录只是 electron-builder 打 nsis / portable / AppImage 时的临时解包结果，
 * 体积与最终安装包相当（几百 MB），发布用不到，构建结束直接删掉，dist 里只留可分发文件。
 *
 * 想临时保留（比如要手动跑 unpacked 里的 exe 调试），设置环境变量 LIULI_KEEP_UNPACKED=1 即可。
 */
const fs = require('fs');
const path = require('path');

const TARGETS = ['win-unpacked', 'linux-unpacked', 'mac', 'mac-arm64', 'mac-universal'];

exports.default = async function afterAllArtifactBuild(context) {
  if (process.env.LIULI_KEEP_UNPACKED === '1') return [];

  const outDir = (context && context.outDir) || path.join(__dirname, '..', 'dist');
  let saved = 0;

  for (const name of TARGETS) {
    const dir = path.join(outDir, name);
    try {
      const size = dirSize(dir);
      fs.rmSync(dir, { recursive: true, force: true });
      saved += size;
      console.log(`  • 清理中间产物：删除 ${name}，释放 ${(size / 1048576).toFixed(1)} MB`);
    } catch (_) {
      /* 不存在或占用中，跳过即可 */
    }
  }

  // electron-builder 的调试残留，发布时也没用
  for (const name of ['builder-debug.yml', 'builder-effective-config.yaml']) {
    try {
      fs.unlinkSync(path.join(outDir, name));
    } catch (_) {}
  }

  if (saved > 0) {
    console.log(`  • 中间产物共释放 ${(saved / 1048576).toFixed(1)} MB`);
  }
  return [];
};

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else {
        try {
          total += fs.statSync(p).size;
        } catch (_) {}
      }
    }
  }
  return total;
}
