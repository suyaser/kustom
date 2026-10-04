import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { championRegionMap, championRegionNames } from '@/lib/champs/championFacts';
import { listChampions } from '@/lib/champs/names';
import { FEARLESS_SEARCH_EMPTY } from '@/lib/fearless/copy';
import type { FearlessChampion } from '@/lib/fearless/types';
import { ORIGINAL_GROUP } from '@/lib/groups/pageGroup';
import type { ModeCardView } from '@/lib/mode/cardView';
import { demoPool } from '../_tonight/fixtures';
import { BannedChip, OpenChip } from './ChampChip';
import { FearlessPool } from './FearlessPool';
import { ModeCard } from './ModeCard';
import { ModePanelBody } from './ModePanelBody';

/**
 * M20.5 (05-design.md 8.15): region tags on champion chips. Display only: a second line of words,
 * part of the chip's accessible name, never a filter.
 */

/**
 * What a screen reader reads for a chip: its text with every `aria-hidden` part dropped (a list
 * item takes no author name, 8.15.5, so this is the name from content), whitespace collapsed.
 */
function spoken(element: Element | null): string {
  if (element === null) throw new Error('no element');
  const clone = element.cloneNode(true) as Element;
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const chip = (name: string, scope: HTMLElement = document.body) =>
  within(scope).getByText(name, { selector: 'span' }).closest('li');

const REGIONS = championRegionMap(listChampions().map((champion) => champion.id));

describe('the chip carries its regions (acceptance 2, 3)', () => {
  it('Jinx reads Zaun, Vi Piltover and Zaun, Zaahen Shurima, Vex both, Bard no tag', () => {
    render(
      <ul>
        <OpenChip id={222} name="Jinx" regions={championRegionNames(222)} />
        <OpenChip id={254} name="Vi" regions={championRegionNames(254)} />
        <OpenChip id={904} name="Zaahen" regions={championRegionNames(904)} />
        <OpenChip id={711} name="Vex" regions={championRegionNames(711)} />
        <OpenChip id={105} name="Fizz" regions={championRegionNames(105)} />
        <OpenChip id={432} name="Bard" regions={championRegionNames(432)} />
      </ul>,
    );
    expect(spoken(chip('Jinx'))).toBe('Jinx, Zaun');
    expect(spoken(chip('Vi'))).toBe('Vi, Piltover and Zaun');
    expect(spoken(chip('Zaahen'))).toBe('Zaahen, Shurima');
    expect(spoken(chip('Vex'))).toBe('Vex, Shadow Isles and Bandle City');
    expect(spoken(chip('Fizz'))).toBe('Fizz, Bilgewater and Bandle City');
    expect(spoken(chip('Bard'))).toBe('Bard');
  });

  it('shows the dot between two regions, aria-hidden, with no-break spaces inside names and before it', () => {
    render(
      <ul>
        <OpenChip id={711} name="Vex" regions={championRegionNames(711)} />
      </ul>,
    );
    const tag = chip('Vex')?.querySelector('[data-slot="region-tag"]');
    const visible = (tag?.cloneNode(true) as Element) ?? null;
    for (const sr of visible.querySelectorAll('.sr-only')) sr.remove();
    expect(visible.textContent).toBe('Shadow Isles · Bandle City');
    const dot = Array.from(tag?.querySelectorAll('[aria-hidden="true"]') ?? []).map((el) => el.textContent);
    expect(dot).toEqual([' · ']);
  });

  it('an unaffiliated champion or an unknown id leaves no empty element', () => {
    render(
      <ul>
        <OpenChip id={432} name="Bard" regions={[]} />
        <OpenChip id={99_999} name="Champion 99999" />
      </ul>,
    );
    for (const name of ['Bard', 'Champion 99999']) {
      const li = chip(name);
      expect(li?.querySelector('[data-slot="region-tag"]')).toBeNull();
      expect(li?.querySelector('.sr-only')).toBeNull();
    }
  });

  it('the tag is muted text 400 13 at 16px, card on a hit, never an opacity', () => {
    render(
      <ul>
        <OpenChip id={222} name="Jinx" regions={['Zaun']} />
        <OpenChip id={254} name="Vi" regions={['Piltover', 'Zaun']} hit />
        <BannedChip id={64} name="Lee Sin" regions={['Ionia']} />
        <BannedChip id={5} name="Xin Zhao" regions={['Demacia', 'Ionia']} hit />
      </ul>,
    );
    const tag = (name: string) => chip(name)?.querySelector('[data-slot="region-tag"]');
    for (const name of ['Jinx', 'Lee Sin']) {
      expect(tag(name)).toHaveClass('text-2xs', 'leading-4', 'font-normal', 'text-muted-foreground');
    }
    for (const name of ['Vi', 'Xin Zhao']) {
      expect(tag(name)).toHaveClass('text-card');
      expect(tag(name)).not.toHaveClass('text-muted-foreground');
    }
    for (const name of ['Jinx', 'Vi', 'Lee Sin', 'Xin Zhao']) {
      expect(tag(name)?.className).not.toMatch(/opacity/);
      expect(tag(name)?.className).not.toMatch(/uppercase|font-mono|tracking/);
    }
    expect(spoken(chip('Xin Zhao'))).toBe('Xin Zhao, Demacia and Ionia');
  });
});

describe('the Fearless pool (acceptance 4: filter and sort exactly as before)', () => {
  const BANNED: FearlessChampion[] = [
    { id: 64, name: 'Lee Sin', role: 'jungle' },
    { id: 203, name: 'Kindred', role: 'jungle' },
  ];

  it('tags open and banned chips from the map it is given', () => {
    render(<FearlessPool banned={BANNED} initialLane="jungle" viewerLane={null} regions={REGIONS} />);
    const jungle = screen.getByRole('region', { name: 'jungle' });
    expect(spoken(chip('Vi', jungle))).toBe('Vi, Piltover and Zaun');
    expect(spoken(chip('Lee Sin', jungle))).toBe('Lee Sin, Ionia');
    expect(spoken(chip('Kindred', jungle))).toBe('Kindred');
  });

  it('lists the same chips in the same order with or without tags', () => {
    const names = () => screen.getAllByRole('listitem').map((li) => spoken(li).split(', ')[0]);
    const plain = render(<FearlessPool banned={BANNED} initialLane="all" viewerLane={null} />);
    const before = names();
    plain.unmount();
    render(<FearlessPool banned={BANNED} initialLane="all" viewerLane={null} regions={REGIONS} />);
    expect(names()).toEqual(before);
  });

  it('typing a region name matches nothing new', () => {
    render(<FearlessPool banned={BANNED} initialLane="all" viewerLane={null} regions={REGIONS} />);
    fireEvent.change(screen.getByLabelText('Find a champion'), { target: { value: 'Zaun' } });
    expect(screen.getByRole('status')).toHaveTextContent(FEARLESS_SEARCH_EMPTY);
    expect(screen.queryAllByRole('listitem')).toEqual([]);
  });

  it('the find hit keeps the answer line and shows the tag on the inverted chip', () => {
    render(<FearlessPool banned={BANNED} initialLane="all" viewerLane={null} regions={REGIONS} />);
    fireEvent.change(screen.getByLabelText('Find a champion'), { target: { value: 'Vi' } });
    expect(screen.getByRole('status')).toHaveTextContent('Vi is still open.');
    const hit = document.querySelector('li[data-hit]');
    expect(spoken(hit)).toBe('Vi, Piltover and Zaun');
  });

  it('chip grids pick their columns by text size (em minimums), not by screen width', () => {
    render(<FearlessPool banned={[]} initialLane="jungle" viewerLane={null} regions={REGIONS} />);
    const grid = chip('Vi')?.parentElement;
    expect(grid?.className).toContain('grid-cols-[repeat(auto-fill,minmax(min(100%,9em),1fr))]');
    expect(grid?.className).toContain('lg:grid-cols-[repeat(auto-fill,minmax(min(100%,10.5em),1fr))]');
    expect(grid?.className).not.toContain('min-[360px]:grid-cols-2');
  });
});

describe('the panel builds the map on the server and passes it on', () => {
  const panel = (view?: ModeCardView) =>
    render(
      <ModePanelBody
        mode="fearless"
        fearless={demoPool(false)}
        view={view}
        lane="jungle"
        viewerLane={null}
        isAdmin={false}
        poolSince="Thu 1 Oct"
        cardHref="/g/customs#mode"
        heading="h2"
        headingId="t"
      />,
    );
  const regionView: ModeCardView = {
    shown: { id: 'region', blue: 'piltover', red: 'zaun' } as ModeCardView['shown'],
    rated: true,
    standing: 'normal',
    locked: true,
    nextLine: null,
    didntApply: false,
    classOpen: null,
    laneCounts: null,
    pendingKey: null,
  };

  it('Fearless: Vi carries Piltover and Zaun', () => {
    panel();
    expect(spoken(chip('Vi', screen.getByRole('region', { name: 'jungle' })))).toBe('Vi, Piltover and Zaun');
  });

  it('region wars: Vi in both pools with the same full tag, nothing emphasised', () => {
    panel(regionView);
    const blue = screen.getByRole('region', { name: 'BLUE Piltover jungle' });
    const red = screen.getByRole('region', { name: 'RED Zaun jungle' });
    expect(spoken(chip('Vi', blue))).toBe('Vi, Piltover and Zaun');
    expect(spoken(chip('Vi', red))).toBe('Vi, Piltover and Zaun');
    expect(chip('Vi', blue)?.querySelector('b, strong')).toBeNull();
  });

  it('class wars: the class pool is tagged too', () => {
    panel({ ...regionView, shown: { id: 'class', tag: 'Tank' } as ModeCardView['shown'], locked: false });
    const lanes = screen
      .getAllByRole('listitem')
      .filter((li) => li.querySelector('[data-slot="region-tag"]'));
    expect(lanes.length).toBeGreaterThan(0);
  });
});

describe("the Mode card's Banned next game", () => {
  it('tags each of the ten, rendered on the server, with an 8em grid minimum', () => {
    render(
      <ModeCard
        group={ORIGINAL_GROUP}
        mode="fearless"
        fearless={demoPool(false)}
        variant="finished"
        bannedNext={{
          champions: [
            { id: 254, name: 'Vi', role: 'jungle' },
            { id: 432, name: 'Bard', role: 'support' },
            { id: 222, name: 'Jinx', role: 'adc' },
          ],
          gameNumber: 4,
        }}
      />,
    );
    expect(spoken(chip('Vi'))).toBe('Vi, Piltover and Zaun');
    expect(spoken(chip('Jinx'))).toBe('Jinx, Zaun');
    expect(spoken(chip('Bard'))).toBe('Bard');
    expect(chip('Vi')?.parentElement?.className).toContain(
      'grid-cols-[repeat(auto-fill,minmax(min(100%,8em),1fr))]',
    );
  });
});
