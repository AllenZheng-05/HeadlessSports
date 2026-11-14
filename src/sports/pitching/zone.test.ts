import { describe, expect, it } from 'vitest';
import { pitchingConfig as cfg } from './config';
import { adjacent, cellAt, cellCentre, distanceOutsideZone, isCorner } from './zone';

describe('zone', () => {
  it('finds the cell at every centre and round-trips', () => {
    const p = { x: 0, y: 0 };
    for (let c = 0; c < 9; c++) {
      cellCentre(cfg, c, p);
      expect(cellAt(cfg, p.x, p.y)).toBe(c);
    }
  });
  it('numbers cells from the top left', () => {
    const p = { x: 0, y: 0 };
    cellCentre(cfg, 0, p);
    expect(p.x).toBeLessThan(0);
    expect(p.y).toBeGreaterThan(cfg.zoneCentreY);
    cellCentre(cfg, 8, p);
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(cfg.zoneCentreY);
  });
  it('treats the outer edges as inside and just beyond as outside', () => {
    expect(cellAt(cfg, 0.25, cfg.zoneCentreY + 0.3)).toBe(2);
    expect(cellAt(cfg, -0.25, cfg.zoneCentreY - 0.3)).toBe(6);
    expect(cellAt(cfg, 0.2501, cfg.zoneCentreY)).toBe(-1);
    expect(cellAt(cfg, 0, cfg.zoneCentreY + 0.3001)).toBe(-1);
  });
  it('gives each side of an inner edge to its own cell', () => {
    const edge = cfg.zoneWidth / 6;
    expect(cellAt(cfg, edge - 0.001, cfg.zoneCentreY)).toBe(4);
    expect(cellAt(cfg, edge + 0.001, cfg.zoneCentreY)).toBe(5);
    const c = cellAt(cfg, edge, cfg.zoneCentreY);
    expect(c === 4 || c === 5).toBe(true);
  });
  it('knows adjacency including diagonals', () => {
    expect(adjacent(4, 0)).toBe(true);
    expect(adjacent(4, 8)).toBe(true);
    expect(adjacent(4, 1)).toBe(true);
    expect(adjacent(0, 1)).toBe(true);
    expect(adjacent(0, 4)).toBe(true);
    expect(adjacent(0, 2)).toBe(false);
    expect(adjacent(0, 8)).toBe(false);
    expect(adjacent(3, 3)).toBe(false);
    expect(adjacent(2, 3)).toBe(false);
  });
  it('knows the corners', () => {
    expect([0, 2, 6, 8].every(isCorner)).toBe(true);
    expect([1, 3, 4, 5, 7].some(isCorner)).toBe(false);
  });
  it('measures the near-miss band from the zone edge', () => {
    expect(distanceOutsideZone(cfg, 0, cfg.zoneCentreY)).toBe(0);
    expect(distanceOutsideZone(cfg, 0.25 + 0.1, cfg.zoneCentreY)).toBeCloseTo(0.1, 9);
    expect(distanceOutsideZone(cfg, 0.25 + 0.03, cfg.zoneCentreY + 0.3 + 0.04)).toBeCloseTo(
      0.05,
      9,
    );
  });
});
