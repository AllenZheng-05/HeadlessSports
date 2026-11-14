/** Registry used by `?source=synthetic&script=<name>`. Importing this module registers the demo scripts. */
import './demo';

export { registerScript, getScript, listScripts } from './registry';
