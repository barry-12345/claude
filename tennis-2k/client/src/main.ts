import './styles/main.css';
import type { Court2KTestHook } from './contracts.js';
import { GameApp } from './game/GameApp.js';

declare global {
  interface Window {
    __COURT2K_TEST__?: Court2KTestHook;
  }
}

const params = new URLSearchParams(window.location.search);
const testMode = params.get('test') === '1';
const netDebug = params.get('netdebug') === '1';

const canvas = document.getElementById('court-canvas') as HTMLCanvasElement | null;
const uiRoot = document.getElementById('ui-root');

if (!canvas || !uiRoot) {
  throw new Error('Missing #court-canvas or #ui-root');
}

new GameApp(canvas, uiRoot, { testMode, netDebug });
