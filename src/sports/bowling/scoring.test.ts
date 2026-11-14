import { describe, expect, it } from 'vitest';
import {
  frameMarks,
  frameTotals,
  isComplete,
  nextBall,
  runningTotal,
  scorecardRows,
} from './scoring';

const final = (rolls: number[], frames = 10): number => runningTotal(rolls, frames);
const rep = (n: number, v: number): number[] => new Array<number>(n).fill(v);

describe('scoring', () => {
  it('scores a gutter game 0', () => {
    expect(final(rep(20, 0))).toBe(0);
    expect(isComplete(rep(20, 0))).toBe(true);
  });
  it('scores all ones 20', () => expect(final(rep(20, 1))).toBe(20));
  it('scores all spares with 5s as 150', () => expect(final(rep(21, 5))).toBe(150));
  it('scores a perfect game 300', () => {
    const rolls = rep(12, 10);
    expect(final(rolls)).toBe(300);
    expect(isComplete(rolls)).toBe(true);
    expect(frameTotals(rolls)).toEqual([30, 60, 90, 120, 150, 180, 210, 240, 270, 300]);
  });
  it('adds the next two balls to a strike (X 3 4)', () => {
    expect(frameTotals([10, 3, 4], 10).slice(0, 2)).toEqual([17, 24]);
  });
  it('leaves a strike unresolved until two more balls', () => {
    expect(frameTotals([10], 10)[0]).toBeNull();
    expect(frameTotals([10, 3], 10)[0]).toBeNull();
    expect(runningTotal([10, 3])).toBe(0);
  });
  it('adds one ball to a spare', () => {
    expect(frameTotals([7, 3, 5, 0], 10).slice(0, 2)).toEqual([15, 20]);
    expect(frameTotals([7, 3], 10)[0]).toBeNull();
  });
  it('scores a spare in the tenth with one bonus ball', () => {
    const rolls = [...rep(18, 0), 7, 3, 9];
    expect(final(rolls)).toBe(19);
    expect(isComplete(rolls)).toBe(true);
    expect(isComplete([...rep(18, 0), 7, 3])).toBe(false);
  });
  it('scores a strike in the tenth with two more strikes', () => {
    const rolls = [...rep(18, 0), 10, 10, 10];
    expect(final(rolls)).toBe(30);
    expect(isComplete(rolls)).toBe(true);
  });
  it('ends the tenth after two open balls', () => {
    expect(isComplete([...rep(18, 0), 4, 3])).toBe(true);
    expect(final([...rep(18, 0), 4, 3])).toBe(7);
  });
  it('scores the classic mixed game 167', () => {
    const rolls = [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1];
    expect(final(rolls)).toBe(167);
    expect(frameTotals(rolls)).toEqual([20, 39, 48, 66, 74, 84, 90, 120, 148, 167]);
    expect(frameMarks(rolls)).toEqual(['X', '7/', '9-', 'X', '-8', '8/', '-6', 'X', 'X', 'X81']);
  });
  it('scores a short two-frame game with tenth-frame rules on the last frame', () => {
    expect(final([10, 10, 10, 10], 2)).toBe(60);
    expect(isComplete([10, 10, 10, 10], 2)).toBe(true);
    expect(isComplete([10, 10, 10], 2)).toBe(false);
    expect(final([3, 4, 5, 5, 6], 2)).toBe(7 + 16);
    expect(frameTotals([3, 4], 2)).toEqual([7, null]);
  });
});

describe('nextBall', () => {
  it('starts with a fresh rack in frame 1', () => {
    expect(nextBall([])).toEqual({ done: false, frame: 0, ball: 0, pinsUp: 10, freshRack: true });
  });
  it('keeps the remaining pins for the second ball', () => {
    expect(nextBall([7])).toEqual({ done: false, frame: 0, ball: 1, pinsUp: 3, freshRack: false });
    expect(nextBall([0])).toMatchObject({ ball: 1, pinsUp: 10, freshRack: false });
  });
  it('skips the second ball after a strike', () => {
    expect(nextBall([10])).toMatchObject({ frame: 1, ball: 0, pinsUp: 10, freshRack: true });
  });
  it('moves to the next frame after two balls', () => {
    expect(nextBall([3, 4])).toMatchObject({ frame: 1, ball: 0, freshRack: true });
  });
  it('handles every tenth-frame branch', () => {
    const nine = rep(18, 0);
    expect(nextBall([...nine, 10])).toMatchObject({
      frame: 9,
      ball: 1,
      pinsUp: 10,
      freshRack: true,
    });
    expect(nextBall([...nine, 10, 4])).toMatchObject({
      frame: 9,
      ball: 2,
      pinsUp: 6,
      freshRack: false,
    });
    expect(nextBall([...nine, 10, 10])).toMatchObject({ ball: 2, pinsUp: 10, freshRack: true });
    expect(nextBall([...nine, 6])).toMatchObject({
      frame: 9,
      ball: 1,
      pinsUp: 4,
      freshRack: false,
    });
    expect(nextBall([...nine, 6, 4])).toMatchObject({ ball: 2, pinsUp: 10, freshRack: true });
    expect(nextBall([...nine, 6, 3]).done).toBe(true);
    expect(nextBall([...nine, 10, 4, 6]).done).toBe(true);
  });
  it('reports done at the end of a short game', () => {
    expect(nextBall([3, 4, 3, 4], 2).done).toBe(true);
    expect(nextBall([3, 4], 2)).toMatchObject({ frame: 1, ball: 0 });
  });
});

describe('scorecard', () => {
  it('builds marks with X, /, - and digits', () => {
    expect(frameMarks([10, 7, 3, 9, 0, 0, 0])).toEqual([
      'X',
      '7/',
      '9-',
      '--',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
    expect(frameMarks([...rep(18, 0), 10, 10, 10])[9]).toBe('XXX');
    expect(frameMarks([...rep(18, 0), 5, 5, 10])[9]).toBe('5/X');
    expect(frameMarks([...rep(18, 0), 10, 5, 5])[9]).toBe('X5/');
  });
  it('marks a 0 then 10 as a spare, never X, including in the tenth frame', () => {
    expect(frameMarks([0, 10, 3])[0]).toBe('-/');
    expect(frameMarks([...rep(18, 0), 10, 0, 10])[9]).toBe('X-/');
    expect(frameMarks([...rep(18, 0), 0, 10, 10])[9]).toBe('-/X');
    expect(frameMarks([...rep(18, 0), 10, 10, 0])[9]).toBe('XX-');
  });
  it('builds three rows with one cell per frame', () => {
    const rows = scorecardRows([10, 3, 4]);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toHaveLength(10);
    expect(rows[0]?.[0]).toBe('1');
    expect(rows[1]?.slice(0, 2)).toEqual(['X', '34']);
    expect(rows[2]?.slice(0, 3)).toEqual(['17', '24', '']);
  });
  it('sizes the card to a short game', () => {
    expect(scorecardRows([], 2)[0]).toEqual(['1', '2']);
  });
});
