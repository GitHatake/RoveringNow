/**
 * 表示用の整形
 *
 * サーバとクライアントで結果がずれないよう、タイムゾーンを固定して整形する。
 */
const TZ = 'Asia/Tokyo';

const dateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: TZ,
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

const eventFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: TZ,
  month: 'long',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(value: Date): string {
  return dateTimeFormat.format(value);
}

export function formatDate(value: Date | string): string {
  return dateFormat.format(typeof value === 'string' ? new Date(value) : value);
}

export function formatEvent(value: Date): string {
  return eventFormat.format(value);
}

/** アバターに表示する頭文字。姓の1文字目を使う */
export function initials(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) return '？';
  return Array.from(trimmed)[0] ?? '？';
}

export const GROUP_KIND_LABEL: Record<string, string> = {
  official: '公式組織',
  project: 'プロジェクト',
  event: 'イベント',
  other: 'その他',
};

export const JOIN_POLICY_LABEL: Record<string, string> = {
  invite: '招待制',
  request: '参加申請制',
  open: 'フルオープン',
};

export const GROUP_STATUS_LABEL: Record<string, string> = {
  active: '活動中',
  archived: 'アーカイブ',
  dormant: '休眠',
};
