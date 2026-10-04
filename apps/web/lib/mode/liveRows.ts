/**
 * The Mode card's row parsers, loaded late (M19.13): `liveRowSchemas.ts` carries zod, so it is a
 * dynamic import started when the page subscribes, never in Tonight's first load. Like
 * `groupLiveParser` (`lib/tonight/liveSignal.ts`): a chunk that fails to load answers `null` for
 * that row and is forgotten, so the next row tries again.
 */

type Schemas = Pick<typeof import('./liveRowSchemas'), 'parseModeRow' | 'parseFearlessRow'>;

let loadSchemas: () => Promise<Schemas> = () => import('./liveRowSchemas');
let schemas: Promise<Schemas | null> | null = null;

/** Tests only: stand in for the dynamic import. */
export function setModeRowLoaderForTests(loader: (() => Promise<Schemas>) | null): void {
  loadSchemas = loader ?? (() => import('./liveRowSchemas'));
  schemas = null;
}

export function modeRowParsers(): Promise<Schemas | null> {
  schemas ??= loadSchemas().then(
    (module) => module,
    () => {
      schemas = null;
      console.warn('mode rows: the row schema did not load; this row is dropped, the next one retries');
      return null;
    },
  );
  return schemas;
}
