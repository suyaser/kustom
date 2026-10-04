import { describe, expect, it } from 'vitest';
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  chartGeometry,
  DEFAULT_LABEL_CHARS,
  LABEL_ROOM,
  labelPlacement,
  labelStartX,
  pathExtentFrom,
} from './chart';

/**
 * The reference label's side (M18.7 design re-check, item 2): chosen from the line's path across the
 * label's whole span, not from the last point, with the gutter under the plot when neither side clears.
 */
describe('the reference label placement', () => {
  it('covers the right-hand part of the box, wider for a longer label', () => {
    const start = labelStartX(DEFAULT_LABEL_CHARS);
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(CHART_WIDTH);
    expect(labelStartX(20)).toBeLessThan(start);
    expect(labelStartX(500)).toBe(0);
  });

  it('reads the line where it enters the span, not only the points inside it', () => {
    // Points at x 0, 160, 320; the span starts between 0 and 160, so the entry value is interpolated.
    const { min, max } = pathExtentFrom([0, 100, 50], 80);
    expect(min).toBeCloseTo(50, 5);
    expect(max).toBe(100);
    expect(pathExtentFrom([7], 200)).toEqual({ min: 7, max: 7 });
  });

  it('dip and recover through the reference under the label: neither side clears, so the gutter', () => {
    // Ends above 1200 (the old one-point rule put the label below), but dips to 1190 inside the span.
    const series = [1_250, 1_260, 1_270, 1_280, 1_190, 1_230];
    const { min, max } = pathExtentFrom(series, labelStartX(DEFAULT_LABEL_CHARS));
    expect(min).toBeLessThan(1_200);
    expect(max).toBeGreaterThan(1_200);

    const geometry = chartGeometry(series, 1_200);
    expect(geometry?.labelPlacement).toBe('gutter');
    // The gutter needs no room in the plot: the range is the 100-point minimum centred on the data.
    expect(geometry?.low).toBeCloseTo(1_185, 5);
    expect(geometry?.high).toBeCloseTo(1_285, 5);
  });

  it('dip and recover to the reference: the clear side wins over the side away from the last point', () => {
    // Ends on the reference (the old rule: below), but the dip runs under the line inside the span;
    // the path never rises past 1200 there, so the label goes over the line.
    const geometry = chartGeometry([1_300, 1_300, 1_300, 1_100, 1_200], 1_200);
    expect(geometry?.labelPlacement).toBe('above');
    expect(geometry?.seedY ?? 0).toBeGreaterThanOrEqual(LABEL_ROOM);
  });

  it('a dip before the span does not move the label', () => {
    expect(chartGeometry([1_200, 1_150, 1_250, 1_260, 1_270], 1_200)?.labelPlacement).toBe('below');
  });

  it('monotone up: under the line, with room to the bottom edge', () => {
    const geometry = chartGeometry([1_200, 1_220, 1_240, 1_260, 1_280, 1_300], 1_200);
    expect(geometry?.labelPlacement).toBe('below');
    expect(CHART_HEIGHT - (geometry?.seedY ?? 0)).toBeGreaterThanOrEqual(LABEL_ROOM);
  });

  it('monotone down: over the line, with room to the top edge', () => {
    const geometry = chartGeometry([1_200, 1_180, 1_160, 1_140, 1_120, 1_100], 1_200);
    expect(geometry?.labelPlacement).toBe('above');
    expect(geometry?.seedY ?? 0).toBeGreaterThanOrEqual(LABEL_ROOM);
  });

  it('flat on the reference, and flat away from it', () => {
    expect(chartGeometry([1_200, 1_200, 1_200], 1_200)?.labelPlacement).toBe('below');
    expect(chartGeometry([1_250, 1_250, 1_250], 1_200)?.labelPlacement).toBe('below');
    expect(chartGeometry([1_150, 1_150, 1_150], 1_200)?.labelPlacement).toBe('above');
    // A one-point week is drawn flat.
    expect(chartGeometry([0], 0)?.labelPlacement).toBe('below');
  });

  it('a line clear of the reference across the span keeps the side away from the last point', () => {
    expect(labelPlacement([0, 40, 90, 95], 0).placement).toBe('below');
  });

  it('a week line crossing 0 under "Week start" goes to the gutter', () => {
    expect(chartGeometry([0, 12, 30, 41, 18, -9, 6], 0, 'Week start'.length)?.labelPlacement).toBe('gutter');
  });
});
