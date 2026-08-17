'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { checkName, createGroup, type NameCheckResult } from '@/server/actions/groups';
import { ERROR_MESSAGES } from '@/lib/result';
import type { GroupKind, JoinPolicy } from '@/db/schema';

/** 種別に応じた既定値。多くの利用者が種別を選ぶだけで作成できる（決定 T-56） */
const DEFAULTS: Record<GroupKind, { policy: JoinPolicy; expires: boolean; help: string }> = {
  official: {
    policy: 'request',
    expires: false,
    help: '団・地区・県連盟などの恒久的な組織です。認証バッジの対象になります。',
  },
  project: {
    policy: 'invite',
    expires: true,
    help: '実行委員会など、期間を区切った集まりです。',
  },
  event: {
    policy: 'open',
    expires: true,
    help: '単発の催しです。参加者が自由に入れます。',
  },
  other: { policy: 'request', expires: false, help: '有志の集まりや勉強会など。' },
};

const POLICY_HELP: Record<JoinPolicy, string> = {
  invite: '管理者が招待した人だけが参加できます。',
  request: '参加を申請してもらい、管理者が承認します。',
  open: '誰でもそのまま参加できます。',
};

/** 名前の重複判定は入力停止から 400ms 後に行う（デザインシステム 第6.7節） */
const CHECK_DELAY_MS = 400;

export function GroupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<GroupKind>('official');
  const [policy, setPolicy] = useState<JoinPolicy>('request');
  const [description, setDescription] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  /** どの入力に対する判定結果かを持ち、入力が変わったら自動的に無効になる */
  const [check, setCheck] = useState<{ name: string; result: NameCheckResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const showExpires = DEFAULTS[kind].expires;
  const nameCheck = check?.name === name ? check.result : null;

  useEffect(() => {
    if (name.trim() === '') return;
    const timer = setTimeout(() => {
      void checkName(name, ['東京第1地区', 'すみだ', String(new Date().getFullYear())]).then(
        (result) => setCheck({ name, result }),
      );
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [name]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await createGroup({
            name,
            kind,
            joinPolicy: policy,
            description,
            expiresAt: showExpires && expiresAt ? new Date(expiresAt).toISOString() : null,
          });
          if (result.ok) router.push(`/groups/${result.data.groupId}`);
          else setError(result.message || ERROR_MESSAGES[result.code]);
        });
      }}
    >
      <label className="field">
        <span className="label">グループ名</span>
        <input
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          placeholder="例：すみだローバースカウト協議会"
        />
        {/* 重複はエラーとして赤くしない。利用者の間違いではないため（決定 T-33） */}
        {nameCheck?.state === 'taken' ? (
          <>
            <span className="hint">この名前はすでに使われています。</span>
            {nameCheck.suggestions.length > 0 ? (
              <div style={{ marginTop: 'var(--sp-2)' }}>
                <span className="hint">こちらはいかがですか</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', marginTop: 4 }}>
                  {nameCheck.suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setName(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : nameCheck?.state === 'invalid' ? (
          <span className="hint hint-error">{nameCheck.reason}</span>
        ) : nameCheck?.state === 'available' ? (
          <span className="hint">✓ この名前は使えます</span>
        ) : (
          <span className="hint">グループ名は全国で1つだけの名前になります。</span>
        )}
      </label>

      <label className="field">
        <span className="label">種別</span>
        <select
          className="select"
          value={kind}
          onChange={(event) => {
            const next = event.target.value as GroupKind;
            setKind(next);
            // 種別を選んだだけで作成できるよう、参加方式の既定も合わせる（決定 T-56）
            setPolicy(DEFAULTS[next].policy);
          }}
        >
          <option value="official">公式組織</option>
          <option value="project">プロジェクト</option>
          <option value="event">イベント</option>
          <option value="other">その他</option>
        </select>
        <span className="hint">{DEFAULTS[kind].help}</span>
      </label>

      <label className="field">
        <span className="label">参加方式</span>
        <select
          className="select"
          value={policy}
          onChange={(event) => setPolicy(event.target.value as JoinPolicy)}
        >
          <option value="invite">招待制</option>
          <option value="request">参加申請制</option>
          <option value="open">フルオープン</option>
        </select>
        <span className="hint">{POLICY_HELP[policy]}</span>
      </label>

      {showExpires ? (
        <label className="field">
          <span className="label">期限（任意）</span>
          <input
            type="date"
            className="input"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
          <span className="hint">
            期限を過ぎるとアーカイブされます。過去の連絡とスタンプは残ります。
          </span>
        </label>
      ) : null}

      <label className="field">
        <span className="label">説明（任意）</span>
        <textarea
          className="textarea"
          style={{ minHeight: 88 }}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={500}
        />
      </label>

      {error ? <p className="hint hint-error">{error}</p> : null}

      <button
        type="submit"
        className="btn btn-primary"
        disabled={pending || name.trim() === '' || nameCheck?.state === 'taken' || nameCheck?.state === 'invalid'}
      >
        作成する
      </button>
    </form>
  );
}
