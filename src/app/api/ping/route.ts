import { currentDriver, getDb } from '@/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 稼働確認。データベースまで到達できるかを見る。
 * 運用設計 07_operations.md 第2.1節の「サービスの死活」に対応する。
 */
export async function GET() {
  try {
    const db = await getDb();
    await db.execute('select 1');
    return Response.json({ ok: true, driver: currentDriver() });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        driver: currentDriver(),
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
}
