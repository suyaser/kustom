import type { RoleValue } from '@customs/db';
import { RoleIcon } from '../_icons/RoleIcon';

/**
 * Icon and word, always both (05-design.md, "Iconography"). Off-role turns the pair `brand`
 * and dots the word's underline — colour is never the only signal, and the stored explanation
 * names them in a sentence anyway.
 */
export function RoleCell({ role, offRole = false }: { role: RoleValue | null; offRole?: boolean }) {
  if (role === null) return <span className="cn-num cn-seat-role" />;

  return (
    <span className={offRole ? 'cn-num cn-seat-role cn-off' : 'cn-num cn-seat-role'}>
      <RoleIcon role={role} />
      {role}
    </span>
  );
}
