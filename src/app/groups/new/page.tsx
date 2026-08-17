import Link from 'next/link';
import { redirect } from 'next/navigation';
import { GroupForm } from './GroupForm';
import { getActor } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** グループ作成（S-09） */
export default async function NewGroupPage() {
  const actor = await getActor();
  if (!actor) redirect('/');

  return (
    <>
      <header className="header">
        <Link href="/groups" className="btn btn-ghost btn-sm" aria-label="戻る">
          ←
        </Link>
        <h1>グループを作る</h1>
      </header>
      <div className="content">
        <GroupForm />
      </div>
    </>
  );
}
