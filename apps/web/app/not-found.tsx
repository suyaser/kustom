import { BareShell } from '@/components/shell/BareShell';
import { StatusPage } from '@/components/shell/StatusPage';
import { BACK_TO_KUSTOM_LABEL, NOT_FOUND_SITE_REASON, NOT_FOUND_TITLE } from '@/lib/shellCopy';

/** Any path nothing answers (M14.7, 05-design.md 5.8). Kustom-level, so the bare shell. */
export default function NotFound() {
  return (
    <BareShell>
      <StatusPage
        title={NOT_FOUND_TITLE}
        reason={NOT_FOUND_SITE_REASON}
        primary={{ label: BACK_TO_KUSTOM_LABEL, href: '/' }}
      />
    </BareShell>
  );
}
