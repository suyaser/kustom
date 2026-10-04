import { GroupNotFound } from '@/components/shell/GroupNotFound';

/**
 * A 404 inside a known group (M14.7): an unknown game, an unknown player, any other path. It renders
 * inside the group's shell, and names what was missing from the path (`GroupNotFound`).
 */
export default function GroupPageNotFound() {
  return <GroupNotFound />;
}
