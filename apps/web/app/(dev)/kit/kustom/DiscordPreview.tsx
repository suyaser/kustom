import type { ReactNode } from 'react';
import type { Embed, WebhookPayload } from '@/lib/discord/embeds';

/**
 * Dev-only: a Discord-like rendering of a webhook payload (M18.7's kit), so the designer can read
 * the result and Sunday posts beside the pages they mirror. Not Discord's own renderer: it shows the
 * stack, the colour bar, the author, title, description, fields and footer with `**bold**` and
 * `` `code` `` set, and nothing else. The payload is the production builder's, unchanged.
 */
export function DiscordPreview({ payload, label }: { payload: WebhookPayload; label: string }) {
  return (
    <section aria-label={label} className="flex flex-col gap-1 rounded-card bg-[#313338] p-4 text-[#dbdee1]">
      <p className="text-sm">
        <span className="font-bold text-white">{payload.username}</span>{' '}
        <span className="rounded bg-[#5865f2] px-1 text-[0.625rem] font-bold text-white">APP</span>
      </p>
      {payload.embeds.map((embed, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed stack, in order.
        <EmbedCard key={index} embed={embed} />
      ))}
    </section>
  );
}

function EmbedCard({ embed }: { embed: Embed }) {
  const color = `#${embed.color.toString(16).padStart(6, '0')}`;
  return (
    <div
      className="flex max-w-[32rem] flex-col gap-1.5 rounded bg-[#2b2d31] py-2.5 ps-3 pe-4 text-sm"
      style={{ borderInlineStart: `4px solid ${color}` }}
    >
      {embed.author ? <p className="text-xs font-bold text-white">{embed.author.name}</p> : null}
      {embed.title ? <p className="font-bold text-[#00a8fc]">{embed.title}</p> : null}
      {embed.description ? <Markdown text={embed.description} /> : null}
      {embed.fields?.map((field) => (
        <div key={field.name}>
          <p className="font-bold text-white">
            <Markdown text={field.name} inline />
          </p>
          <Markdown text={field.value} />
        </div>
      ))}
      {embed.footer ? <p className="text-xs text-[#b5bac1]">{embed.footer.text}</p> : null}
    </div>
  );
}

function Markdown({ text, inline = false }: { text: string; inline?: boolean }) {
  const lines = text.split('\n');
  const body = lines.map((line, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: lines of one fixed string.
    <span key={index} className={inline ? undefined : 'block min-h-[1.25em]'}>
      {inlineMarks(line)}
    </span>
  ));
  return inline ? <>{body}</> : <div className="leading-snug">{body}</div>;
}

function inlineMarks(line: string): ReactNode[] {
  return line.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((piece, index) => {
    if (piece.startsWith('**') && piece.endsWith('**')) {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: pieces of one fixed line.
        <strong key={index} className="text-white">
          {piece.slice(2, -2)}
        </strong>
      );
    }
    if (piece.startsWith('`') && piece.endsWith('`')) {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: pieces of one fixed line.
        <code key={index} className="rounded bg-[#1e1f22] px-1 text-[0.8125rem]">
          {piece.slice(1, -1)}
        </code>
      );
    }
    return piece;
  });
}
