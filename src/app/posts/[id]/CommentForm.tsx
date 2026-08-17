'use client';

import { useState, useTransition } from 'react';
import { createComment } from '@/server/actions/posts';
import { ERROR_MESSAGES } from '@/lib/result';

export function CommentForm({ postId }: { postId: string }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await createComment(postId, body);
          if (result.ok) {
            setBody('');
          } else {
            setError(result.message || ERROR_MESSAGES[result.code]);
          }
        });
      }}
    >
      <label className="field">
        <span className="label">コメントを書く</span>
        <textarea
          className="textarea"
          style={{ minHeight: 88 }}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={2000}
        />
      </label>
      {error ? <p className="hint hint-error">{error}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={pending || body.trim() === ''}>
        送信
      </button>
    </form>
  );
}
