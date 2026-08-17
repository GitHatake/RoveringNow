/**
 * テーマが固定されていることの検査
 *
 *   npm run theme:check
 *
 * ライト指定とダーク指定で、ブラウザが計算した色が完全に一致することを確かめる。
 * 決定 T-79（テーマを白ベースに固定する）の回帰検査であり、
 * どこかに `prefers-color-scheme` の上書きが混ざったら失敗する。
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3100';

/** 端末設定に追随してはならない値 */
const TOKENS = [
  '--c-bg',
  '--c-surface',
  '--c-accent',
  '--c-text',
  '--c-text-strong',
  '--c-on-accent',
  '--c-paper',
  '--c-foil',
  '--c-border',
];

const browser = await chromium.launch();

const probe = await browser.newPage();
await probe.goto(BASE, { waitUntil: 'networkidle' });
// 連絡が届いている利用者を選ぶ。運営アカウントは所属がなく、カードが描かれない
const users = await probe.$$eval('#dev-user option[value]:not([value=""])', (options) =>
  options.map((option) => ({
    id: (option as HTMLOptionElement).value,
    name: option.textContent?.trim() ?? '',
  })),
);
const userId = (users.find((user) => user.name.includes('海野')) ?? users[0])?.id;
if (!userId) {
  throw new Error('利用者が見つかりません。npm run db:seed を実行してください');
}
await probe.close();

const host = new URL(BASE).hostname;
const script = `(() => {
  const root = getComputedStyle(document.documentElement);
  const out = {};
  for (const name of ${JSON.stringify(TOKENS)}) {
    out[name] = root.getPropertyValue(name).trim();
  }
  out['color-scheme'] = root.getPropertyValue('color-scheme').trim();
  out['body の背景'] = getComputedStyle(document.body).backgroundColor;
  out['body の文字'] = getComputedStyle(document.body).color;
  const post = document.querySelector('.post');
  out['カードの背景'] = post ? getComputedStyle(post).backgroundColor : '(要素なし)';
  const mono = document.querySelector('.monogram');
  out['モノグラムの背景'] = mono ? getComputedStyle(mono).backgroundColor : '(要素なし)';
  return out;
})()`;

const measured: Record<string, Record<string, string>> = {};
for (const scheme of ['light', 'dark'] as const) {
  const context = await browser.newContext({
    colorScheme: scheme,
    viewport: { width: 420, height: 900 },
  });
  await context.addCookies([{ name: 'rn_dev_user', value: userId, domain: host, path: '/' }]);
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  measured[scheme] = (await page.evaluate(script)) as Record<string, string>;
  await context.close();
}
await browser.close();

const light = measured.light!;
const dark = measured.dark!;
let mismatches = 0;

console.log('| 項目 | ライト指定 | ダーク指定 | 一致 |');
console.log('|---|---|---|---|');
for (const key of Object.keys(light)) {
  const a = light[key]!;
  const b = dark[key]!;
  const same = a === b;
  if (!same) mismatches += 1;
  console.log(`| ${key} | ${a} | ${b} | ${same ? '✅' : '❌'} |`);
}

console.log(`\n不一致: ${mismatches} 件`);
if (mismatches > 0) {
  console.error('テーマが端末設定に追随しています（決定 T-79 に違反）');
  process.exit(1);
}
process.exit(0);
