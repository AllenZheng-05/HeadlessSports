import './styles/base.css';
import { boot } from './core/shell/boot';
import { APP_NAME } from './core/version';
import { registerServiceWorker } from './sw/register';

document.title = APP_NAME;
void boot();
registerServiceWorker();
