import { describe, expect, it } from 'vitest';
import { championRegionMap, championRegionNames } from './championFacts';
import { listChampions } from './names';

describe('championRegionNames (M20.5, 05-design 8.15)', () => {
  it('names the regions in plain words, Universe first, then the home', () => {
    expect(championRegionNames(222)).toEqual(['Zaun']); // Jinx
    expect(championRegionNames(254)).toEqual(['Piltover', 'Zaun']); // Vi
    expect(championRegionNames(141)).toEqual(['Ionia', 'Noxus']); // Kayn
    expect(championRegionNames(904)).toEqual(['Shurima']); // Zaahen
    expect(championRegionNames(711)).toEqual(['Shadow Isles', 'Bandle City']); // Vex
    expect(championRegionNames(421)).toEqual(['The Void', 'Shurima']); // Rek'Sai
  });

  it('keeps Fizz in the home list order (no Universe region, two homes)', () => {
    expect(championRegionNames(105)).toEqual(['Bilgewater', 'Bandle City']);
  });

  it('is empty for an unaffiliated champion and for an id with no row', () => {
    expect(championRegionNames(432)).toEqual([]); // Bard
    expect(championRegionNames(999)).toEqual([]);
  });

  it('never prints a slug, upper case or Unaffiliated, and at most two', () => {
    for (const { id } of listChampions()) {
      const names = championRegionNames(id);
      for (const name of names) {
        expect(name).not.toBe('Unaffiliated');
        expect(name).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)?$/);
      }
      expect(names.length).toBeLessThanOrEqual(2);
    }
  });
});

describe('championRegionMap', () => {
  it('leaves untagged champions out', () => {
    expect(championRegionMap([222, 432, 999, 254])).toEqual({ 222: ['Zaun'], 254: ['Piltover', 'Zaun'] });
  });
});
