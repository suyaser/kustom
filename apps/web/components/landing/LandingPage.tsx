import type { Route } from 'next';
import Link from 'next/link';
import { EntityLink } from '@/components/links/EntityLink';
import { FairnessReceipt } from '@/components/receipt';
import { RichText } from '@/components/receipt/parts';
import { Button } from '@/components/ui/button';
import type { PageGroup } from '@/lib/groups/pageGroup';
import {
  ADMINS_CAN,
  backToGroup,
  COMPANION_FACTS,
  COMPANION_INTRO,
  COMPANION_TITLE,
  COMPANION_WINDOWS,
  COUNTER_GAMES,
  COUNTER_PLAYERS,
  COUNTER_TYPED,
  COUNTERS_LABEL,
  EXAMPLE_RECEIPT_CAPTION,
  FAQ,
  FAQ_TITLE,
  FINAL_CHECKLIST,
  FINAL_TITLE,
  FREE_SIGNED_IN,
  FREE_SIGNED_OUT,
  GET_FOR_WINDOWS,
  HERO_SUB,
  HERO_TITLE_SET,
  inGroupCalibrationParts,
  liveReceiptCaption,
  openGroup,
  PROBLEM_CLOSE,
  PROBLEM_LINES,
  PROBLEM_TITLE,
  PROOF_LINES,
  PROOF_TITLE,
  SEE_REAL_GROUP,
  SEE_THIS_GAME,
  STEPS,
  STEPS_TITLE,
  TRY_BODY_AFTER_COUNT,
  TRY_TITLE,
  tryBodyNamed,
  tryGamesParts,
} from '@/lib/landing/copy';
import type { LandingAudience } from '@/lib/landing/decide';
import { EXAMPLE_NAMES, EXAMPLE_SPLITS } from '@/lib/landing/example';
import { roundedCount } from '@/lib/landing/format';
import type { LandingData } from '@/lib/landing/load';
import { groupHome, groupHref } from '@/lib/nav';
import { formatDayMonth } from '@/lib/night';
import { CALIBRATION_FOLLOW_UP, calibrationLineParts } from '@/lib/receipt/copy';
import { AudienceSwitch, AudienceText, RememberedBackBar } from './AboutIslands';
import { CreateGroupButton, PageColumn, Section, TermList } from './parts';

/**
 * The landing page, `/` and `/about` (M14.24; redesign/STRATEGY.md §2.3), section by section:
 * hero, the problem, three steps, the proof, try it, the companion, the final call, the FAQ.
 *
 * Mobile first: each section is one phone screen and the hero's buttons are above the fold at
 * 375. Everything is server-rendered real text: no scroll reveal, no part that renders empty, no
 * hidden text, and it works with JavaScript off (the FAQ and the receipt's disclosure are
 * `<details>`, the sign-in is a `<form>`). No Riot or League logo anywhere (M14.8).
 */
/**
 * Who is looking. `/` knows on the server (it is dynamic anyway, for its redirect) and passes
 * `audience` and `back`. The static `/about` passes `islands`: the page is prerendered for an
 * anonymous visitor and the client islands in `AboutIslands.tsx` draw the back bar and turn the
 * audience-dependent lines after hydration (about-static).
 */
export type LandingPageProps = { data: LandingData } & (
  | {
      audience: LandingAudience;
      /** `Back to <Group>`: the group this browser last opened, when the visitor should see it. */
      back: PageGroup | null;
      islands?: never;
    }
  | { islands: true; audience?: never; back?: never }
);

/** A known audience, or `island`: decided in the browser. */
type AudienceSource = LandingAudience | 'island';

export function LandingPage(props: LandingPageProps) {
  const { data } = props;
  const demo = data.demo;
  const audience: AudienceSource = props.islands === true ? 'island' : props.audience;
  return (
    <div className="flex-1">
      {props.islands === true ? (
        <RememberedBackBar />
      ) : props.back === null ? null : (
        <BackBar group={props.back} />
      )}
      <PageColumn>
        <Hero data={data} audience={audience} />
        <Problem />
        <Steps />
        <Proof data={data} />
        {demo === null ? null : <TryIt demo={demo} data={data} />}
        <Companion />
        <FinalCall audience={audience} />
        <Faq />
      </PageColumn>
    </div>
  );
}

/** `Create your group`, by a known audience or switched in the browser. */
function CreateGroup({ audience }: { audience: AudienceSource }) {
  if (audience !== 'island') return <CreateGroupButton audience={audience} />;
  return (
    <AudienceSwitch
      signedOut={<CreateGroupButton audience="signed-out" />}
      signedIn={<CreateGroupButton audience="signed-in" />}
    />
  );
}

function BackBar({ group }: { group: PageGroup }) {
  return (
    <div className="border-b border-border bg-card">
      <div className="mx-auto w-full max-w-7xl px-(--gutter)">
        <Link
          href={groupHome(group)}
          className="inline-flex min-h-11 items-center gap-1.5 font-bold text-primary-text underline underline-offset-3 [overflow-wrap:anywhere]"
        >
          {backToGroup(group.name)}
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}

function Hero({ data, audience }: { data: LandingData; audience: AudienceSource }) {
  const demoHome = data.demo === null ? null : groupHome(data.demo);
  return (
    <section
      aria-labelledby="hero-title"
      className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-start lg:gap-12"
    >
      <div className="flex flex-col gap-4 lg:pt-6">
        <h1
          id="hero-title"
          className="font-display text-display font-black tracking-[-0.01em] text-balance uppercase font-stretch-62% hyphens-auto [overflow-wrap:break-word]"
        >
          {HERO_TITLE_SET}
        </h1>
        <p className="max-w-[38rem] text-base text-pretty lg:text-md lg:leading-normal">{HERO_SUB}</p>
        <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap sm:items-center">
          <CreateGroup audience={audience} />
          {demoHome === null ? null : (
            <Button asChild variant="secondary">
              <Link prefetch="auto" href={demoHome}>
                {SEE_REAL_GROUP}
              </Link>
            </Button>
          )}
        </div>
      </div>
      <HeroReceipt data={data} disclosureId="landing-hero-how" />
    </section>
  );
}

/** The demo group's latest rolled game, dated, or the worked example, captioned as one. */
function HeroReceipt({
  data,
  disclosureId,
  open = false,
}: {
  data: LandingData;
  disclosureId: string;
  open?: boolean;
}) {
  const { hero, demo } = data;
  const headingLevel = open ? 'h3' : 'h2';
  if (hero.kind === 'live' && demo !== null) {
    const gameHref = groupHref(demo, { page: 'game', gameId: hero.gameId });
    return (
      <figure className="flex flex-col gap-2">
        <FairnessReceipt
          variant="finished"
          winner={hero.winner}
          splits={hero.splits}
          names={hero.names}
          headingLevel={headingLevel}
          disclosureId={disclosureId}
          defaultOpen={open}
          landmark={false}
        />
        <figcaption className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
          <span>{liveReceiptCaption(demo.name, formatDayMonth(new Date(hero.startedAt)))}</span>
          {gameHref === null ? null : (
            <EntityLink
              href={gameHref}
              className="inline-flex min-h-11 items-center font-bold text-foreground underline underline-offset-3"
            >
              {SEE_THIS_GAME}
            </EntityLink>
          )}
        </figcaption>
      </figure>
    );
  }
  return (
    <figure className="flex flex-col gap-2">
      <FairnessReceipt
        variant="balanced"
        splits={EXAMPLE_SPLITS}
        names={EXAMPLE_NAMES}
        headingLevel={headingLevel}
        disclosureId={disclosureId}
        defaultOpen={open}
        landmark={false}
      />
      <figcaption className="text-sm text-muted-foreground">{EXAMPLE_RECEIPT_CAPTION}</figcaption>
    </figure>
  );
}

function Problem() {
  return (
    <Section id="problem" title={PROBLEM_TITLE}>
      <ul className="flex flex-col gap-2.5">
        {PROBLEM_LINES.map((line, i) => (
          <li
            key={line}
            className={
              i % 2 === 0
                ? 'w-fit max-w-[22rem] rounded-card rounded-bl-chip border border-border bg-card px-4 py-2.5 text-md'
                : 'w-fit max-w-[22rem] self-end rounded-card rounded-br-chip border border-border bg-raised px-4 py-2.5 text-md sm:self-start sm:ms-12'
            }
          >
            {line}
          </li>
        ))}
      </ul>
      <p className="text-md font-bold">{PROBLEM_CLOSE}</p>
    </Section>
  );
}

function Steps() {
  return (
    <Section id="how-it-works" title={STEPS_TITLE}>
      <ol className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="flex flex-col gap-1.5 rounded-card border border-border bg-card p-(--card-pad)"
          >
            <span className="flex items-baseline gap-2.5">
              <span className="num text-md font-semibold text-muted-foreground" aria-hidden="true">
                {i + 1}
              </span>
              <span className="text-md font-bold">{step.title}</span>
            </span>
            <span className="text-pretty text-muted-foreground">{step.body}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Proof({ data }: { data: LandingData }) {
  const cal = data.calibration;
  return (
    <Section id="proof" title={PROOF_TITLE}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start lg:gap-12">
        <div className="flex flex-col gap-3">
          <HeroReceipt data={data} disclosureId="landing-proof-how" open />
          {cal === null || data.demo === null || cal.actualPct === null || cal.expectedPct === null ? null : (
            <p className="text-sm text-pretty">
              <RichText
                rich={inGroupCalibrationParts(
                  data.demo.name,
                  calibrationLineParts(cal.n, cal.favoredWon, cal.actualPct, cal.expectedPct),
                )}
              />{' '}
              <span className="text-muted-foreground">{CALIBRATION_FOLLOW_UP}</span>
            </p>
          )}
        </div>
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col gap-3">
            {PROOF_LINES.map((line) => (
              <li key={line.strong} className="border-s-[3px] border-border-strong ps-3 text-pretty">
                <b className="font-bold">{line.strong}</b>{' '}
                <span className="text-muted-foreground">{line.rest}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-pretty text-muted-foreground">{ADMINS_CAN}</p>
        </div>
      </div>
    </Section>
  );
}

function TryIt({ demo, data }: { demo: PageGroup; data: LandingData }) {
  const games = roundedCount(data.demoGames);
  const counters = data.counters;
  const refereed = roundedCount(counters?.games);
  const rated = roundedCount(counters?.players);
  const showCounters = refereed !== null && rated !== null;
  return (
    <Section id="try-it" title={TRY_TITLE}>
      <p className="max-w-[40rem] text-pretty">
        {/* With the counters showing, the demo group's count would say the same thing twice. */}
        {games === null || showCounters ? (
          tryBodyNamed(demo.name)
        ) : (
          <>
            <RichText rich={tryGamesParts(demo.name, games)} /> {TRY_BODY_AFTER_COUNT}
          </>
        )}
      </p>
      <Button asChild variant="secondary" className="w-full sm:w-fit">
        <Link href={groupHome(demo)}>{openGroup(demo.name)}</Link>
      </Button>
      {!showCounters ? null : (
        <dl aria-label={COUNTERS_LABEL} className="grid grid-cols-3 gap-2">
          <Counter value={refereed ?? ''} label={COUNTER_GAMES} />
          <Counter value={rated ?? ''} label={COUNTER_PLAYERS} />
          <Counter value="0" label={COUNTER_TYPED} />
        </dl>
      )}
    </Section>
  );
}

function Counter({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse justify-end gap-0.5 rounded-card border border-border bg-card px-3 py-3 md:px-(--card-pad)">
      <dt className="text-xs text-pretty text-muted-foreground md:text-sm">{label}</dt>
      <dd className="num text-md font-semibold [overflow-wrap:anywhere] md:text-lg">{value}</dd>
    </div>
  );
}

function Companion() {
  return (
    <Section id="companion" title={COMPANION_TITLE}>
      <div className="flex max-w-[44rem] flex-col gap-4">
        <p className="text-md text-pretty">{COMPANION_INTRO}</p>
        <TermList items={COMPANION_FACTS} />
        <p className="text-pretty">{COMPANION_WINDOWS}</p>
        <Link
          href={'/download' as Route}
          className="inline-flex min-h-11 w-fit items-center font-bold text-primary-text underline underline-offset-3"
        >
          {GET_FOR_WINDOWS}
        </Link>
      </div>
    </Section>
  );
}

function FinalCall({ audience }: { audience: AudienceSource }) {
  return (
    <Section
      id="start"
      title={FINAL_TITLE}
      className="rounded-card border border-border-strong bg-card p-(--card-pad) lg:p-8"
    >
      <ol className="flex flex-col gap-2">
        {FINAL_CHECKLIST.map((item, i) => (
          <li key={item} className="flex items-baseline gap-2.5 text-md">
            <span className="num font-semibold text-muted-foreground" aria-hidden="true">
              {i + 1}
            </span>
            {item}
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2 sm:w-fit">
        <CreateGroup audience={audience} />
        {audience === 'island' ? (
          <AudienceText
            signedIn={FREE_SIGNED_IN}
            signedOut={FREE_SIGNED_OUT}
            className="text-sm text-muted-foreground"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {audience === 'signed-in' ? FREE_SIGNED_IN : FREE_SIGNED_OUT}
          </p>
        )}
      </div>
    </Section>
  );
}

function Faq() {
  return (
    <Section id="faq" title={FAQ_TITLE}>
      <div className="flex max-w-[44rem] flex-col rounded-card border border-border bg-card">
        {FAQ.map((item) => (
          <details key={item.q} className="group border-t border-border first:border-t-0">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-(--card-pad) py-3 font-bold [&::-webkit-details-marker]:hidden">
              {item.q}
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                aria-hidden="true"
                className="shrink-0 transition-transform duration-(--dur-base) group-open:rotate-180"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </summary>
            <p className="px-(--card-pad) pb-4 text-pretty text-muted-foreground">{item.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
