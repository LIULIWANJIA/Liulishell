'use strict';
/* 用真实 ssh2 客户端验证 mock 服务器：exec / shell / sftp */
const { Client } = require('ssh2');

const client = new Client();

function exec(cmd) {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream.on('data', (d) => (out += d.toString()));
      stream.stderr.on('data', (d) => (out += d.toString()));
      stream.on('close', () => resolve(out));
    });
  });
}

client.on('ready', async () => {
  try {
    console.log('== exec: monitor bundle ==');
    const mon = await exec(
      "echo '@@cpu'; head -n 1 /proc/stat; echo '@@mem'; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo; echo '@@net'; cat /proc/net/dev; echo '@@disk'; df -hP; echo '@@load'; cat /proc/loadavg; echo '@@end'"
    );
    console.log(mon.split('\n').slice(0, 12).join('\n'));

    console.log('== exec: ps ==');
    console.log((await exec('ps -eo pid,pcpu,pmem,rss,comm | head -n 300')).split('\n').slice(0, 3).join('\n'));

    console.log('== sftp: readdir ==');
    const sftp = await new Promise((res, rej) => client.sftp((e, s) => (e ? rej(e) : res(s))));
    const list = await new Promise((res, rej) => sftp.readdir('/home/demo', (e, l) => (e ? rej(e) : res(l))));
    console.log(list.map((x) => `${x.filename} ${x.attrs.size}`).join(', '));

    console.log('== sftp: read file ==');
    const content = await new Promise((res, rej) => {
      const chunks = [];
      const rs = sftp.createReadStream('/home/demo/welcome.txt');
      rs.on('data', (d) => chunks.push(d));
      rs.on('end', () => res(Buffer.concat(chunks).toString()));
      rs.on('error', rej);
    });
    console.log(JSON.stringify(content));

    console.log('== sftp: write file ==');
    await new Promise((res, rej) => {
      const ws = sftp.createWriteStream('/home/demo/from-client.txt');
      ws.on('close', res);
      ws.on('error', rej);
      ws.end('uploaded by client\n');
    });
    const check = await exec("cat /home/demo/from-client.txt");
    console.log('content after write:', JSON.stringify(check.trim()));

    console.log('== shell ==');
    const sh = await new Promise((res, rej) => client.shell((e, s) => (e ? rej(e) : res(s))));
    let buf = '';
    sh.on('data', (d) => {
      buf += d.toString();
    });
    sh.write('ls\n');
    await new Promise((r) => setTimeout(r, 400));
    sh.write('exit\n');
    await new Promise((r) => setTimeout(r, 300));
    console.log(JSON.stringify(buf.slice(0, 260)));

    console.log('\nALL OK');
    client.end();
    process.exit(0);
  } catch (err) {
    console.error('FAILED:', err);
    process.exit(1);
  }
});

client.on('error', (e) => {
  console.error('conn error', e);
  process.exit(1);
});

client.connect({ host: '127.0.0.1', port: 2222, username: 'demo', password: 'x', readyTimeout: 8000 });
