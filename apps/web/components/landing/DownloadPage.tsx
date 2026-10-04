import { RichText } from '@/components/receipt/parts';
import { Button } from '@/components/ui/button';
import {
  COMPANION_FACTS,
  COMPANION_TITLE,
  DOWNLOAD_BUTTON,
  DOWNLOAD_BUTTON_NOTE,
  DOWNLOAD_LEAD,
  DOWNLOAD_REQUIREMENTS,
  DOWNLOAD_REQUIREMENTS_TITLE,
  DOWNLOAD_SETUP,
  DOWNLOAD_SETUP_TITLE,
  DOWNLOAD_SMARTSCREEN,
  DOWNLOAD_TITLE,
} from '@/lib/landing/copy';
import { RELEASES_URL } from '@/lib/nav';
import { PageColumn, Section, TermList } from './parts';

/**
 * `/download`, "Get Kustom" (M14.24; STRATEGY §2.6): what the app reads and never touches,
 * Windows only, how setup goes (install, link with a code, it updates itself; M17.12, Kustom 1.0), and
 * the link to the release. The link is the GitHub releases
 * **page**, never the `.exe` itself: this page is read on phones, and a 90MB download started on
 * a phone is a bug (`lib/nav.ts`). Riot's notice is in the footer, as on every page.
 */
export function DownloadPage() {
  return (
    <div className="flex-1">
      <PageColumn className="*:max-w-3xl">
        <header className="flex flex-col gap-4">
          <h1 className="text-xl font-bold text-balance">{DOWNLOAD_TITLE}</h1>
          <p className="text-md text-pretty">{DOWNLOAD_LEAD}</p>
          <div className="flex flex-col gap-2">
            <Button asChild className="w-full sm:w-fit">
              <a href={RELEASES_URL} target="_blank" rel="noreferrer noopener">
                {DOWNLOAD_BUTTON}
              </a>
            </Button>
            <p className="text-sm text-pretty text-muted-foreground">{DOWNLOAD_BUTTON_NOTE}</p>
            <p className="text-sm text-pretty text-muted-foreground">
              {/* The two button names bold in the foreground (design round 2). */}
              <RichText rich={DOWNLOAD_SMARTSCREEN} />
            </p>
          </div>
        </header>

        <Section id="what-it-does" title={COMPANION_TITLE}>
          <TermList items={COMPANION_FACTS} />
        </Section>

        <Section id="setup" title={DOWNLOAD_SETUP_TITLE}>
          <TermList items={DOWNLOAD_SETUP} />
        </Section>

        <Section id="requirements" title={DOWNLOAD_REQUIREMENTS_TITLE}>
          <ul className="flex list-disc flex-col gap-2 ps-5">
            {DOWNLOAD_REQUIREMENTS.map((line) => (
              <li key={line} className="text-pretty">
                {line}
              </li>
            ))}
          </ul>
        </Section>
      </PageColumn>
    </div>
  );
}
