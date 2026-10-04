import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OPS_TITLE } from '@/lib/admin/sectionCopy';
import { listOpsGroups } from '@/lib/ops/groups';
import { currentOperator } from '@/lib/ops/operator';
import { getServiceClient } from '@/lib/supabase';
import { OpsView } from './OpsView';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `${OPS_TITLE} · Kustom`,
  robots: { index: false, follow: false },
};

/**
 * `/ops` (M13.14, M14.23): the operator's list of every group. **A 404 for everyone else** -- signed
 * out, signed in and not on `SUPER_ADMIN_USER_IDS`, or the list unset -- so nobody learns the page
 * exists (M14.19's `currentOperator`, checked on the server for every request).
 */
export default async function OpsPage() {
  const operator = await currentOperator();
  if (!operator.ok) notFound();
  return <OpsView groups={await listOpsGroups(getServiceClient())} />;
}
