'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { COPIED_LABEL } from '@/lib/groups/pageCopy';

/**
 * Copy a value, and say so in place (05-design 5.0: no toast; the label becomes `Copied` for 2 s and
 * a polite status region reads it). Used by the pairing code (`Copy`) and the invite card
 * (`Copy link`). A browser that refuses the clipboard leaves the label as it was: the value is on
 * screen, selectable, right beside it.
 */
export function CopyButton({
  value,
  label,
  copiedLabel = COPIED_LABEL,
  variant = 'secondary',
  className,
}: {
  value: string;
  label: string;
  copiedLabel?: string;
  variant?: 'secondary' | 'outline' | 'default';
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={() => void copy()}>
        {copied ? copiedLabel : label}
      </Button>
      <span role="status" className="sr-only">
        {copied ? copiedLabel : ''}
      </span>
    </>
  );
}
