import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Frame } from '@/components/ui/frame';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { KitDialog } from './KitDialog';
import { KitThemeToggle } from './KitThemeToggle';

/**
 * The Kustom 2.0 component kit (M14.1): every token and primitive of docs/05-design.md in its
 * states, under whichever theme <html> carries. Development only: a production build answers 404.
 * Copy here is placeholder; real copy comes from redesign/STRATEGY.md with each page.
 */
export const metadata: Metadata = { title: 'Kit · Kustom', robots: { index: false, follow: false } };

const SWATCHES: readonly { name: string; note: string; on?: string; hatch?: boolean }[] = [
  { name: 'background', note: 'page, level 0' },
  { name: 'card', note: 'level 1' },
  { name: 'raised', note: 'level 2 (= muted, secondary, accent)' },
  { name: 'foreground', note: 'text, names, ratings, ring' },
  { name: 'muted-foreground', note: 'labels, meta' },
  { name: 'border', note: 'every card' },
  { name: 'border-strong', note: 'receipt, dashed states' },
  { name: 'primary', note: 'the one action', on: 'primary-foreground' },
  { name: 'primary-text', note: 'amber as text: live, you' },
  { name: 'primary-fill', note: 'Live tag, YOU', on: 'on-primary-fill' },
  { name: 'destructive', note: 'admin only' },
  { name: 'team-blue', note: 'side 100, solid', on: 'on-team' },
  { name: 'team-red', note: 'side 200, hatched', on: 'on-team', hatch: true },
  { name: 'team-blue-tint', note: '12% over card' },
  { name: 'team-red-tint', note: '12% over card' },
  { name: 'you-wash', note: 'the viewer’s row' },
];

const TYPE: readonly { token: string; className: string; sample: string; face: string }[] = [
  {
    token: 'display',
    className: 'font-display text-display font-black uppercase tracking-[-0.01em] font-stretch-62%',
    sample: 'Teams are set',
    face: 'Archivo 62% 900',
  },
  {
    token: 'xl',
    className: 'font-display text-xl font-black uppercase tracking-[0.02em] font-stretch-62%',
    sample: 'Blue',
    face: 'Archivo 62% 900',
  },
  { token: 'lg', className: 'text-lg font-bold', sample: 'Basically a coin flip.', face: 'Atkinson 700' },
  {
    token: 'md',
    className: 'text-md font-bold',
    sample: 'Used2BeATahmMain  H4RDC0R33  1sec',
    face: 'Atkinson 700',
  },
  {
    token: 'base',
    className: 'font-text text-base',
    sample: 'Split by rating and role. Nobody picked the teams.',
    face: 'Atkinson 400',
  },
  {
    token: 'sm',
    className: 'text-sm text-muted-foreground',
    sample: 'Next best: swap the bot lane players.',
    face: 'Atkinson 400',
  },
  {
    token: 'xs',
    className: 'text-xs text-muted-foreground',
    sample: '94 games · 58W 36L',
    face: 'Atkinson 400',
  },
  {
    token: '2xs',
    className: 'font-mono text-2xs font-medium tracking-[0.04em] font-stretch-75%',
    sample: 'top jungle mid adc support',
    face: 'Martian 75% 500',
  },
  {
    token: 'md mono',
    className: 'num text-md font-semibold font-stretch-88%',
    sample: '1560  +33  −38  51%',
    face: 'Martian 88% 600',
  },
];

export default function KitPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="min-h-svh bg-page">
      <main className="mx-auto flex max-w-6xl flex-col gap-12 px-(--gutter) py-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-xl font-black uppercase tracking-[0.02em] font-stretch-62%">
              Kustom 2.0 kit
            </h1>
            <p className="text-sm text-muted-foreground">
              Floodlit Slate tokens and primitives (docs/05-design.md). Development only.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="/kit/receipt"
              className="inline-flex min-h-11 items-center font-bold text-primary-text underline underline-offset-[3px]"
            >
              Fairness receipt
            </a>
            <KitThemeToggle />
          </div>
        </header>

        <Section title="Colour tokens">
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {SWATCHES.map((swatch) => (
              <li key={swatch.name} className="flex flex-col gap-1.5">
                <div
                  data-side-fill={swatch.hatch ? '' : undefined}
                  className="grid h-16 place-items-center rounded-control border border-border font-bold"
                  style={{
                    backgroundColor: `var(--${swatch.name})`,
                    backgroundImage: swatch.hatch ? 'var(--hatch)' : undefined,
                    color: swatch.on ? `var(--${swatch.on})` : undefined,
                  }}
                >
                  {swatch.on ? 'Aa 51%' : null}
                </div>
                <code className="text-xs font-semibold [overflow-wrap:anywhere]">--{swatch.name}</code>
                <span className="text-xs text-muted-foreground">{swatch.note}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Type scale">
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border bg-card">
            {TYPE.map((step) => (
              <li
                key={step.token}
                className="flex flex-col gap-1 p-(--card-pad) md:flex-row md:items-baseline md:gap-6"
              >
                <span className="num w-32 shrink-0 text-2xs text-muted-foreground">
                  {step.token} · {step.face}
                </span>
                <span className={`${step.className} [overflow-wrap:anywhere]`}>{step.sample}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Radius">
          <div className="flex flex-wrap gap-4">
            {(['card 8', 'control 6', 'chip 4'] as const).map((label, index) => (
              <div
                key={label}
                className={[
                  'grid size-24 place-items-center border border-border-strong bg-raised text-xs',
                  ['rounded-card', 'rounded-control', 'rounded-chip'][index],
                ].join(' ')}
              >
                {label}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Button">
          <div className="flex flex-col gap-4">
            <Row label="variants">
              <Button>Roll teams</Button>
              <Button variant="secondary">See all time</Button>
              <Button variant="outline">Refresh</Button>
              <Button variant="ghost">Cancel</Button>
              <Button variant="link">How ratings work</Button>
              <Button variant="destructive">Remove admin</Button>
            </Row>
            <Row label="pending (aria-disabled, focusable)">
              <Button pending>Rolling…</Button>
              <Button variant="secondary" pending>
                Saving…
              </Button>
            </Row>
            <Row label="icon (44)">
              <Button variant="outline" size="icon" aria-label="Refresh">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path
                    d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Button>
            </Row>
            <Row label="long label wraps">
              <div className="w-48">
                <Button variant="secondary" className="w-full">
                  Switch to your side yourself if the client doesn’t
                </Button>
              </div>
            </Row>
          </div>
        </Section>

        <Section title="Chip">
          <div className="flex flex-col gap-4">
            <Row label="static">
              <Chip>
                Rating gap <b className="num font-semibold text-foreground font-stretch-78%">45 pts</b>
              </Chip>
              <Chip variant="you">You</Chip>
              <Chip variant="settling">settling 8/30</Chip>
              <Chip variant="off-role">off-role</Chip>
              <Chip>In play</Chip>
            </Row>
            <Row label="side (label on fill)">
              <Chip variant="side" side="blue" />
              <Chip variant="side" side="red" />
              <Chip variant="side" side="red">
                51% Red
              </Chip>
            </Row>
            <Row label="toggle (button, aria-pressed, 44)">
              <Chip pressed={false}>top</Chip>
              <Chip pressed>jungle</Chip>
            </Row>
          </div>
        </Section>

        <Section title="Card">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Top of the board</CardTitle>
                <CardDescription>This week, by rating.</CardDescription>
                <CardAction>
                  <Chip variant="you">You</Chip>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p>
                  Ramzyinhović <span className="num font-semibold">2638</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  94 games · 58W 36L · <span className="num">+33</span>
                </p>
              </CardContent>
              <CardFooter>
                <Button variant="secondary">Full board</Button>
              </CardFooter>
            </Card>
            <div className="rounded-card border border-dashed border-border-strong p-(--card-pad)">
              <p>No games this week yet.</p>
              <div className="mt-3">
                <Button variant="secondary">See all time</Button>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Input and select">
          <div className="grid gap-6 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="kit-name">Riot ID</Label>
              <Input id="kit-name" placeholder="Name#TAG…" autoComplete="off" spellCheck={false} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="kit-code">Lobby code</Label>
              <Input
                id="kit-code"
                defaultValue="12ab"
                inputMode="numeric"
                aria-invalid
                aria-describedby="kit-code-error"
              />
              <p id="kit-code-error" className="text-sm text-destructive">
                Couldn’t use that code: it is 6 digits.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="kit-window">Window</Label>
              <NativeSelect id="kit-window" defaultValue="week">
                <NativeSelectOption value="night">Tonight</NativeSelectOption>
                <NativeSelectOption value="week">This week</NativeSelectOption>
                <NativeSelectOption value="all">All time</NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="kit-disabled">Disabled</Label>
              <Input id="kit-disabled" defaultValue="Not editable" disabled />
            </div>
            <div className="flex flex-col gap-2 md:col-span-2">
              <Label htmlFor="kit-note">Note for the group</Label>
              <Textarea id="kit-note" placeholder="Anything the bot should know tonight…" rows={3} />
            </div>
          </div>
        </Section>

        <Section title="Reserved frame (loading, no pulse)">
          <div className="grid gap-4 md:grid-cols-2">
            <Frame
              rows={5}
              rowClassName="h-(--seat-min-h)"
              className="pt-(--thead-h) [&>div:first-child]:border-t"
            />
            <div className="flex flex-col gap-3">
              <Frame className="h-(--row-min-h)" />
              <Frame className="h-(--row-min-h)" />
              <p className="text-sm text-muted-foreground">
                Team card frame: 54px header + 5 × 64px seats. Leaderboard rows: 56px.
              </p>
            </div>
          </div>
        </Section>

        <Section title="Table (admin, 768 and up)">
          <Card>
            <Table>
              <TableCaption className="px-(--card-pad) pb-3">Companion tokens.</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead className="text-end">Games</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-bold">Raafat</TableCell>
                  <TableCell>admin</TableCell>
                  <TableCell className="num text-xs">kst_9f3a2c71d0e4b8a6f15c93e0</TableCell>
                  <TableCell className="num text-end">212</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-bold">TheSHADOWREAPER</TableCell>
                  <TableCell>member</TableCell>
                  <TableCell className="num text-xs">kst_4b1e0d9a77c2f3e58a01b6d2</TableCell>
                  <TableCell className="num text-end">9</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
        </Section>

        <Section title="AlertDialog and separator">
          <div className="flex flex-col gap-4">
            <Row label="destructive confirm (opens)">
              <KitDialog />
            </Row>
            <Separator />
            <p className="text-sm text-muted-foreground">
              Banned, by design: toasts, tooltips, popovers, Radix Select, accordions (use native details),
              skeleton shimmer, avatars.
            </p>
            <details className="rounded-card border border-border bg-card">
              <summary className="flex min-h-11 cursor-pointer items-center px-(--card-pad) font-bold text-primary-text">
                How the bot decided
              </summary>
              <p className="px-(--card-pad) pb-(--card-pad) text-sm text-muted-foreground">
                Native details: no JavaScript, announced natively.
              </p>
            </details>
          </div>
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
