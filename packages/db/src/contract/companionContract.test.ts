import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  COMPANION_CONTRACT,
  type ContractEntry,
  exportEntry,
  INDEX_FILE,
  markedNodes,
  NOT_EXPORTED_KEY,
  renderContract,
} from './companionContract';

function scratch(schema: z.ZodType): ContractEntry {
  return {
    file: 'scratch.request',
    route: 'POST /scratch',
    side: 'request',
    schemaName: 'puuidSchema',
    schema,
  };
}

describe('the JSON Schema export (M17.3)', () => {
  it('marks every rule zod cannot export, on its node, instead of dropping it silently', () => {
    const json = exportEntry(
      scratch(
        z.preprocess(
          (value) => value,
          z.object({
            a: z.string().refine((value) => value !== 'x'),
            b: z.string().trim().min(1),
            c: z.string().trim(),
            d: z.number().int(),
          }),
        ),
      ),
    );
    expect(markedNodes(json)).toEqual([
      { pointer: '/', kinds: ['preprocess'] },
      { pointer: '/properties/a', kinds: ['refine'] },
      { pointer: '/properties/b', kinds: ['normalised'] },
    ]);
  });

  it('refuses a type JSON Schema cannot hold at all', () => {
    expect(() => exportEntry(scratch(z.object({ at: z.date() })))).toThrow();
  });

  it('exports the input side: a field with a default is optional, a transform is invisible', () => {
    const json = exportEntry(
      scratch(z.object({ n: z.number().default(0), s: z.string().transform((value) => value.length) })),
    );
    expect(json.required).toEqual(['s']);
    expect(json.properties).toMatchObject({ s: { type: 'string' } });
  });

  it('lists the milestone-named lossy schemas by name in index.json', () => {
    const index = JSON.parse(renderContract().get(INDEX_FILE) ?? '{}') as {
      schemas: { file: string; schema: string; notExported: { pointer: string; kinds: string[] }[] }[];
    };
    const lossy = new Map(index.schemas.map((entry) => [entry.schema, entry.notExported] as const));
    expect(lossy.get('companionLobbyPayloadSchema')).toContainEqual({ pointer: '/', kinds: ['preprocess'] });
    expect(lossy.get('companionPairResponseSchema')).toContainEqual({ pointer: '/', kinds: ['refine'] });
    // Every schema the contract names is in the index, once.
    expect(index.schemas.map((entry) => entry.file).sort()).toEqual(
      COMPANION_CONTRACT.map((entry) => `${entry.file}.json`).sort(),
    );
  });

  it('renders the same text twice (the drift check depends on it)', () => {
    const once = renderContract();
    const twice = renderContract();
    expect([...twice.entries()]).toEqual([...once.entries()]);
    expect(once.get('lobby.request.json')).toContain(NOT_EXPORTED_KEY);
  });

  it('refuses two entries writing one file', () => {
    const one = COMPANION_CONTRACT[0] as ContractEntry;
    expect(() => renderContract([one, one])).toThrow(/two contract entries/);
  });
});
