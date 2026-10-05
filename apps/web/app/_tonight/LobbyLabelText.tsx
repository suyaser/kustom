/**
 * A lobby label with a break chance before `'s lobby` (05-design.md 14.4), so a long host name wraps
 * there and not after its apostrophe. No hooks: the switcher, the panel's bar and the full page share it.
 */
export function LobbyLabelText({ label }: { label: string }) {
  const at = label.lastIndexOf("'s lobby");
  if (at <= 0) return label;
  return (
    <>
      {label.slice(0, at)}
      <wbr />
      {label.slice(at)}
    </>
  );
}
