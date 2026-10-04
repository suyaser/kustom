import type { PageGroup } from '../groups/pageGroup';

/**
 * Tab titles and link-preview titles (M14.42, scene-walk gap 9; quality sweep A8). Every group page's
 * `<title>` names its group, so a tab, a bookmark and a pasted link all say whose page it is, and
 * the product comes last: `<page bits> · <Group> · Kustom`.
 */

export const PRODUCT_NAME = 'Kustom';
const SEPARATOR = ' · ';

/** `This week · Board · Customs Night · Kustom`. With no parts: `Customs Night · Kustom`. */
export function groupPageTitle(group: Pick<PageGroup, 'name'>, ...parts: readonly string[]): string {
  return [...parts, group.name, PRODUCT_NAME].join(SEPARATOR);
}

/** Tonight's link preview: `Customs Night tonight · Kustom`. [NEW COPY] */
export function tonightShareTitle(group: Pick<PageGroup, 'name'>): string {
  return `${group.name} tonight${SEPARATOR}${PRODUCT_NAME}`;
}

/** A live invite's link preview: `Join Customs Night on Kustom`. [NEW COPY] */
export function joinShareTitle(groupName: string): string {
  return `Join ${groupName} on ${PRODUCT_NAME}`;
}
