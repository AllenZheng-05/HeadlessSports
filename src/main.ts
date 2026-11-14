import './styles/base.css';
import { boot } from './core/shell/boot';
import { APP_NAME } from './core/version';

document.title = APP_NAME;
void boot();
