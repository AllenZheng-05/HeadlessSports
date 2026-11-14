import type { InputProvider } from '../../input/types';
import { AvatarAnimator } from '../../render/avatar/AvatarAnimator';
import { AvatarRig } from '../../render/avatar/AvatarRig';
import { BlobShadow } from '../../render/style/blobShadow';
import { createFieldDayScene } from '../../render/style/scene';
import type { FieldDayScene } from '../../render/style/scene';
import { mirrorUpperBody } from '../avatarDrive';

/**
 * The idle stage behind the title and the menus: Field Day, with the athlete mirroring the player
 * when an input is attached and breathing otherwise.
 */
export class Lobby {
  readonly stage: FieldDayScene = createFieldDayScene();
  private readonly avatar = new AvatarRig();
  private readonly shadow = new BlobShadow(0.55);
  private readonly animator = new AvatarAnimator(this.avatar);

  constructor() {
    this.stage.scene.add(this.avatar.root);
    this.stage.scene.add(this.shadow.mesh);
    this.animator.setBreathing(true);
  }

  frame(dt: number, nowMs: number, input: InputProvider | null): void {
    if (input !== null) mirrorUpperBody(this.avatar, input.state, nowMs);
    this.animator.update(dt);
    this.avatar.update(dt);
    this.shadow.follow(this.avatar.root);
  }

  dispose(): void {
    this.shadow.dispose();
    this.avatar.dispose();
    this.stage.dispose();
  }
}
