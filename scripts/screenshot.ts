/**
 * 画面の撮影と、適用されている色の実測
 *
 *   npx tsx scripts/screenshot.ts [ベースURL]
 *
 * 見た目の確認だけでなく、ブラウザが実際に計算した色（getComputedStyle）を
 * 取り出して記録する。「CSS は正しいのに画面が変わらない」という状況を
 * 推測ではなく実測で切り分けるために用いる。
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3100';
const OUT = join(process.cwd(), '.screenshots');
const DEV_USER_COOKIE = 'rn_dev_user';

type Shot = { name: string; path: string; user?: 'member' | 'admin'; dark?: boolean };

const SHOTS: Shot[] = [
  { name: '01-timeline-member', path: '/', user: 'member' },
  { name: '02-post-detail', path: '', user: 'member' }, // パスは実行時に決める
  { name: '03-post-new-admin', path: '/posts/new', user: 'admin' },
  { name: '04-collection-stamps', path: '/collection', user: 'member' },
  { name: '05-collection-cards', path: '/collection?tab=cards', user: 'member' },
  { name: '06-groups', path: '/groups', user: 'member' },
  { name: '07-group-new', path: '/groups/new', user: 'member' },
  { name: '08-mypage', path: '/mypage', user: 'member' },
  // ボタンの序列（主要／副次／破壊的）が同時に並ぶ画面
  { name: '10-group-detail', path: '', user: 'member' },
  { name: '09-timeline-dark', path: '/', user: 'member', dark: true },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

/** 開発バーの選択肢から利用者IDを拾う */
const probe = await browser.newPage();
await probe.goto(BASE, { waitUntil: 'networkidle' });
const users = await probe.$$eval('#dev-user option', (options) =>
  options
    .map((option) => ({
      id: (option as HTMLOptionElement).value,
      name: option.textContent?.trim() ?? '',
    }))
    .filter((user) => user.id !== ''),
);
await probe.close();

const member = users.find((user) => user.name.includes('海野'));
const admin = users.find((user) => user.name.includes('梶'));
if (!member || !admin) {
  throw new Error(`利用者が見つかりません。npm run db:seed を実行してください: ${JSON.stringify(users)}`);
}

const host = new URL(BASE).hostname;

async function shoot(shot: Shot): Promise<void> {
  const user = shot.user === 'admin' ? admin! : member!;
  const context = await browser.newContext({
    viewport: { width: 420, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: shot.dark ? 'dark' : 'light',
  });
  await context.addCookies([
    { name: DEV_USER_COOKIE, value: user.id, domain: host, path: '/' },
  ]);

  const page = await context.newPage();
  await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(OUT, `${shot.name}.png`), fullPage: true });

  console.log(`  ${shot.name}.png  (${user.name}${shot.dark ? ' / ダーク' : ''})`);
  await context.close();
}

// グループ詳細のパスも、タイムラインの1件目のグループから取得する
// 連絡詳細のパスは、タイムラインの1件目から取得する
const linkContext = await browser.newContext();
await linkContext.addCookies([
  { name: DEV_USER_COOKIE, value: member.id, domain: host, path: '/' },
]);
const linkPage = await linkContext.newPage();
await linkPage.goto(BASE, { waitUntil: 'networkidle' });
const postHref = await linkPage.$eval('a.post-link', (a) => (a as HTMLAnchorElement).pathname);
const groupHref = await linkPage.$eval('a.post-group', (a) => (a as HTMLAnchorElement).pathname);
await linkContext.close();

console.log('撮影:');
const resolved: Record<string, string> = {
  '02-post-detail': postHref,
  '10-group-detail': groupHref,
};
for (const shot of SHOTS) {
  const path = resolved[shot.name];
  await shoot(path ? { ...shot, path } : shot);
}

/* ------------------------------------------------------------------ *
 * ブラウザが実際に計算した色を取り出す
 * ------------------------------------------------------------------ */
const check = await browser.newContext({ viewport: { width: 420, height: 900 } });
await check.addCookies([{ name: DEV_USER_COOKIE, value: admin.id, domain: host, path: '/' }]);
const page = await check.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });

// esbuild が関数に注入するヘルパーがブラウザ側に無いため、文字列として渡す
const computed = (await page.evaluate(`(() => {
  const root = getComputedStyle(document.documentElement);
  const tok = {};
  for (const name of ['--c-bg','--c-surface','--c-accent','--c-text-strong','--c-on-accent','--c-foil']) {
    tok[name] = root.getPropertyValue(name).trim();
  }
  const pairs = [
    ['body の背景', 'body', 'background-color'],
    ['ヘッダーの背景', '.header', 'background-color'],
    ['連絡カードの背景', '.post', 'background-color'],
    ['連絡カードの角丸', '.post', 'border-radius'],
    ['グループ名の文字色', '.post-group', 'color'],
    ['主要ボタンの背景', '.btn-primary', 'background-color'],
    ['主要ボタンの文字色', '.btn-primary', 'color'],
    ['スキャンタブの円', '.tabbar .scan .icon', 'background-color'],
    ['認証バッジの背景', '.badge-certified', 'background-color'],
  ];
  const app = {};
  for (const [label, selector, prop] of pairs) {
    const el = document.querySelector(selector);
    app[label] = el ? getComputedStyle(el).getPropertyValue(prop) : '(要素なし)';
  }
  return { tokens: tok, applied: app };
})()`)) as { tokens: Record<string, string>; applied: Record<string, string> };

console.log('\nブラウザが計算した値:');
console.log('  [トークン]');
for (const [key, value] of Object.entries(computed.tokens)) console.log(`    ${key.padEnd(16)} ${value}`);
console.log('  [実際に適用された値]');
for (const [key, value] of Object.entries(computed.applied)) console.log(`    ${key.padEnd(18)} ${value}`);

await check.close();
await browser.close();
console.log(`\n出力先: ${OUT}`);
