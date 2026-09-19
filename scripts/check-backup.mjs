import { sources, read, rel, report } from './lib.mjs';

// 每个数据域都必须进备份。见 system/backup.js 顶上那段。
//
// 漏一个不会报错、不会变慢，导出看着也成功 —— 只有换台设备恢复时才发现
// 那一域是空的，而那时候原始数据往往已经没了。这种错只能靠机器盯。

const listOf = (text, re) => {
  const m = text.match(re);
  return m ? [...m[1].matchAll(/'([^']+)'|(\b[a-zA-Z_$][\w$]*)\b/g)]
    .map(x => x[1] || x[2]).filter(Boolean) : null;
};

export function check() {
  const files = [...sources(['.js'])];
  const dbFile = files.find(f => rel(f) === 'src/system/db/index.js');
  const bkFile = files.find(f => rel(f) === 'src/system/backup.js');
  if (!dbFile || !bkFile) return ['找不到 db/index.js 或 backup.js'];

  const inDb = listOf(read(dbFile), /const COLLECTIONS = \{([^}]+)\}/);
  const inBackup = listOf(read(bkFile), /const COLLECTIONS = \[([\s\S]*?)\]/);
  if (!inDb || !inBackup) return ['COLLECTIONS 的写法变了，这条检查要跟着改'];

  const problems = [];
  inDb.forEach(name => {
    if (!inBackup.includes(name)) {
      problems.push(`数据域 ${name} 没进备份。`
        + '在 src/system/backup.js 的 COLLECTIONS 里补上，否则换台设备恢复时它是空的');
    }
  });
  inBackup.forEach(name => {
    if (!inDb.includes(name)) {
      problems.push(`备份里列了 ${name}，但库里没有这个数据域。改名或删域时忘了同步`);
    }
  });
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(report('备份完整性', check()));
}
