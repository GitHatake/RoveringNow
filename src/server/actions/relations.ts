'use server';

/**
 * つながり・ブロック・プロフィールカードに関する操作
 *
 * 業務ルールは src/server/relation-service.ts にある。
 */
import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { fail, type Result } from '@/lib/result';
import { getActor } from '@/lib/session';
import {
  blockUserService,
  exchangeCardService,
  releaseConnectionService,
  rotateCardQrTokenService,
  unblockUserService,
  updateProfileCardService,
  type ExchangeResult,
  type ProfileCardInput,
} from '@/server/relation-service';

export async function exchangeCard(qrToken: string): Promise<Result<ExchangeResult>> {
  const actor = await getActor();
  if (!actor) return fail('UNAUTHENTICATED', 'ログインが必要です。');
  const result = await exchangeCardService(await getDb(), actor, qrToken);
  if (result.ok) {
    revalidatePath('/collection');
    revalidatePath('/', 'layout');
  }
  return result;
}

export async function releaseConnection(counterpartUserId: string): Promise<Result<null>> {
  const actor = await getActor();
  if (!actor) return fail('UNAUTHENTICATED', 'ログインが必要です。');
  const result = await releaseConnectionService(await getDb(), actor, counterpartUserId);
  if (result.ok) revalidatePath('/collection');
  return result;
}

export async function blockUser(targetUserId: string): Promise<Result<null>> {
  const actor = await getActor();
  if (!actor) return fail('UNAUTHENTICATED', 'ログインが必要です。');
  const result = await blockUserService(await getDb(), actor, targetUserId);
  if (result.ok) {
    revalidatePath('/collection');
    revalidatePath('/settings');
  }
  return result;
}

export async function unblockUser(targetUserId: string): Promise<Result<null>> {
  const actor = await getActor();
  if (!actor) return fail('UNAUTHENTICATED', 'ログインが必要です。');
  const result = await unblockUserService(await getDb(), actor, targetUserId);
  if (result.ok) revalidatePath('/settings');
  return result;
}

export async function updateProfileCard(input: ProfileCardInput): Promise<Result<null>> {
  const actor = await getActor();
  if (!actor) return fail('UNAUTHENTICATED', 'ログインが必要です。');
  const result = await updateProfileCardService(await getDb(), actor, input);
  if (result.ok) {
    revalidatePath('/mypage');
    revalidatePath('/collection');
    revalidatePath('/', 'layout');
  }
  return result;
}

export async function rotateCardQrToken(): Promise<Result<{ qrToken: string }>> {
  const actor = await getActor();
  if (!actor) return fail('UNAUTHENTICATED', 'ログインが必要です。');
  const result = await rotateCardQrTokenService(await getDb(), actor);
  if (result.ok) revalidatePath('/mypage');
  return result;
}
