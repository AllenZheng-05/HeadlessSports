import type { Flags } from '../core/flags';
import { createCameraSource } from './camera/CameraLandmarkSource';
import { loadClip } from './replay/library';
import { createReplaySource } from './replay/ReplaySource';
import { createSyntheticSource } from './synthetic/SyntheticSource';
import { getScript, listScripts } from './synthetic/scripts';
import type { LandmarkSource } from './types';

/**
 * camera -> createCameraSource; synthetic -> script from the registry (default 'idle');
 * replay -> loadClip(flags.clip). Rejects with a clear Error for an unknown script or clip.
 */
export async function createLandmarkSource(flags: Flags): Promise<LandmarkSource> {
  switch (flags.source) {
    case 'synthetic': {
      const name = flags.script ?? 'idle';
      const script = getScript(name);
      if (!script) {
        throw new Error(`Unknown script "${name}". Available: ${listScripts().join(', ')}`);
      }
      return createSyntheticSource({ script, noise: { seed: flags.seed } });
    }
    case 'replay': {
      if (!flags.clip) throw new Error('source=replay needs a clip name (?clip=<name>).');
      const clip = await loadClip(flags.clip);
      return createReplaySource(clip, { loop: true });
    }
    default:
      return createCameraSource({
        poseModel: flags.pose,
        forceMainThread: flags.mainThread,
      });
  }
}
