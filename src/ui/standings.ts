import type { PlayerInfo } from '../core/sport';
import { h } from './dom';
import { hexColor } from './format';
import type { Standings } from './types';

interface Chip {
  el: HTMLElement;
  score: HTMLElement;
  text: string;
}

/**
 * The pass-and-play strip: one name chip per player with a running score, the player in front of
 * the camera marked (a pointer and a heavier outline, never colour alone). It sits in the bottom
 * left corner, the one corner no sport HUD uses, stacked so it never meets the score block, the
 * meters (left), the table and controls (right), the banner and hint (centre) or the mirror.
 */
export function createStandings(parent: HTMLElement): Standings {
  const el = h('ul', 'standings');
  el.hidden = true;
  el.setAttribute('aria-label', 'Players');
  parent.append(el);
  let chips: Chip[] = [];
  let current = -1;

  function hide(): void {
    el.hidden = true;
    el.replaceChildren();
    chips = [];
    current = -1;
  }

  return {
    show(players: readonly PlayerInfo[]): void {
      hide();
      for (const p of players) {
        const li = h('li', 'standing');
        li.style.setProperty('--seat', hexColor(p.color));
        li.dataset.seat = String(p.index);
        const name = h('span', 'standing-name', p.name);
        const score = h('span', 'standing-score');
        li.append(name, score);
        el.append(li);
        chips.push({ el: li, score, text: '' });
      }
      el.hidden = chips.length === 0;
    },
    set(index: number, text: string): void {
      const chip = chips[index];
      if (chip === undefined || chip.text === text) return;
      chip.text = text;
      chip.score.textContent = text;
    },
    setCurrent(index: number): void {
      if (index === current) return;
      chips[current]?.el.classList.remove('current');
      current = index;
      chips[index]?.el.classList.add('current');
    },
    hide,
  };
}
