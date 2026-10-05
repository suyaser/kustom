import { CALIBRATION_READY, FIXTURE_NAMES, THREE_SPLITS } from '@/components/receipt/fixtures';
import type { DetailSeat, DetailTeam, GameDetailView } from '@/lib/games/detail';

/**
 * One finished game for the game page's component tests and the dev kit (M16.4's recap screens):
 * the receipt fixtures' ten, Red winning in 31 minutes from the rolled split.
 */

const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const;
const PUUIDS = Object.keys(FIXTURE_NAMES);

function seat(puuid: string, i: number): DetailSeat {
  return {
    puuid,
    name: FIXTURE_NAMES[puuid] ?? null,
    role: ROLES[i] ?? null,
    champion: 'Ahri',
    kills: 5,
    deaths: 3,
    assists: 7,
    kda: '5/3/7',
    kp: 60,
    gold: 11_200,
    damageToChamps: 18_400,
    cs: 182,
    vision: 24,
    goldLabel: '11.2k',
    damageLabel: '18.4k',
    csLabel: '182 CS',
    damageShare: 70,
    award: null,
    delta: 14,
    isViewer: false,
  };
}

function team(side: 100 | 200, won: boolean): DetailTeam {
  const ids = side === 100 ? PUUIDS.slice(0, 5) : PUUIDS.slice(5, 10);
  return { side, kills: side === 100 ? 22 : 31, won, seats: ids.map((id, i) => seat(id, i)) };
}

export function gameDetailFixture(overrides: Partial<GameDetailView> = {}): GameDetailView {
  return {
    gameId: '30000000-0000-4000-8000-000000000001',
    winningSide: 200,
    nightLabel: 'Tuesday 20 October',
    durationLabel: '31 min',
    aram: false,
    rated: true,
    ratedStamp: true,
    voided: false,
    blue: team(100, false),
    red: team(200, true),
    receipt: {
      kind: 'rolled',
      splits: THREE_SPLITS,
      chosen: THREE_SPLITS[0] as (typeof THREE_SPLITS)[number],
      swapped: false,
    },
    names: FIXTURE_NAMES,
    calibration: CALIBRATION_READY,
    ...overrides,
  };
}
