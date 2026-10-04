/**
 * What the eye reads in a rendered element: a copy without the `sr-only` words (M18.7).
 *
 * Since M18.7 the explanation's `×` and `=` carry spoken words (`times`, `equals`; 05-design
 * 11.6.5) and a week's points carry `58 points this week`, so an element's `textContent` holds both
 * the visible text and the spoken one (`+58` then `58 points this week` reads `+5858`). Tests that
 * pin the visible sentence read it through these; tests that pin the spoken words query them by
 * text as before.
 */
export function withoutSrOnly(element: Element | null): HTMLElement {
  if (element === null) throw new Error('withoutSrOnly: no element');
  const clone = element.cloneNode(true) as HTMLElement;
  for (const hidden of Array.from(clone.querySelectorAll('.sr-only'))) hidden.remove();
  return clone;
}

/** {@link withoutSrOnly}'s text, as rendered (whitespace untouched). */
export function visibleText(element: Element | null): string {
  return withoutSrOnly(element).textContent ?? '';
}
