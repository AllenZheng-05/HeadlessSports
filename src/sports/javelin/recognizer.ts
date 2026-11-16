import type { RecognizerConfig } from '../../input/recognizers/config';
import type { JavelinConfig } from './config';

/**
 * Wrist speed above which a release is a throw whatever the run speed: the rules' floor at full
 * run speed. A release that peaked below this may have been refused as slow.
 */
export function maxRequiredThrowSpeed(cfg: JavelinConfig): number {
  return cfg.minThrowSpeed + cfg.pumpMargin;
}

/**
 * The throw recognizer settings the javelin wants while it is on (see `JavelinConfig`): running
 * bobs the shoulders and pumps the arms, so the body-speed limit is raised and the arm counts as
 * ready sooner; and a release the rules would refuse as too slow may be superseded by a stronger
 * one inside the cooldown (a cocking movement must not hide the real throw). Returns a function
 * that puts back what was there.
 */
export function applyJavelinRecognizer(cfg: JavelinConfig, rc: RecognizerConfig): () => void {
  const t = rc.throw;
  const saved = {
    maxBodySpeed: t.maxBodySpeed,
    armSpeed: t.armSpeed,
    armMs: t.armMs,
    supersedeMaxPeak: t.supersedeMaxPeak,
  };
  if (cfg.maxBodySpeedOverride > 0) t.maxBodySpeed = cfg.maxBodySpeedOverride;
  if (cfg.recognizerArmSpeed > 0) t.armSpeed = cfg.recognizerArmSpeed;
  if (cfg.recognizerArmMs > 0) t.armMs = cfg.recognizerArmMs;
  t.supersedeMaxPeak = Math.max(t.supersedeMaxPeak, maxRequiredThrowSpeed(cfg) / t.minPeak);
  return () => {
    t.maxBodySpeed = saved.maxBodySpeed;
    t.armSpeed = saved.armSpeed;
    t.armMs = saved.armMs;
    t.supersedeMaxPeak = saved.supersedeMaxPeak;
  };
}
