import { ArmRaiseRecognizer } from './ArmRaiseRecognizer';
import { CadenceRecognizer } from './CadenceRecognizer';
import { recognizerConfig } from './config';
import type { RecognizerConfig } from './config';
import { PunchRecognizer } from './PunchRecognizer';
import { SquatJumpRecognizer } from './SquatJumpRecognizer';
import { SwingRecognizer } from './SwingRecognizer';
import { ThrowRecognizer } from './ThrowRecognizer';
import type { Recognizer } from './types';

export { ArmRaiseRecognizer } from './ArmRaiseRecognizer';
export { CadenceRecognizer } from './CadenceRecognizer';
export { PunchRecognizer } from './PunchRecognizer';
export { SquatJumpRecognizer } from './SquatJumpRecognizer';
export { SwingRecognizer } from './SwingRecognizer';
export { ThrowRecognizer } from './ThrowRecognizer';
export { recognizerConfig } from './config';
export type { RecognizerConfig } from './config';
export type { Emit, Recognizer } from './types';

/** Every recognizer, both hands. */
export function createDefaultRecognizers(
  config: RecognizerConfig = recognizerConfig,
): Recognizer[] {
  return [
    new ArmRaiseRecognizer(config),
    new CadenceRecognizer(config),
    new ThrowRecognizer('left', config),
    new ThrowRecognizer('right', config),
    new SwingRecognizer(config),
    new PunchRecognizer('left', config),
    new PunchRecognizer('right', config),
    new SquatJumpRecognizer(config),
  ];
}
