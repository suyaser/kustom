import { BareShell } from '@/components/shell/BareShell';
import { StatusPage } from '@/components/shell/StatusPage';
import { BACK_TO_KUSTOM_LABEL, NOT_FOUND_GROUP_REASON, NOT_FOUND_TITLE } from '@/lib/shellCopy';

/** `/g/<a slug nobody has>` (M14.7, 05-design.md 5.8): no group is known, so the bare shell. */
export default function UnknownGroup() {
  return (
    <BareShell>
      <StatusPage
        title={NOT_FOUND_TITLE}
        reason={NOT_FOUND_GROUP_REASON}
        primary={{ label: BACK_TO_KUSTOM_LABEL, href: '/' }}
      />
    </BareShell>
  );
}
