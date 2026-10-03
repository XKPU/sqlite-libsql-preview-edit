import ReactDOM from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

/**
 * Report an uncaught error to the extension host's Output channel.
 *
 * The webview is sandboxed and its console is not visible from the extension
 * host, so a crash during startup would otherwise be completely silent — which
 * is exactly the situation that produced an endless "Loading database…".
 * This uses the raw API because the bridge is not available this early.
 */
function reportFatal(message: string): void {
  try {
    const api = (
      window as unknown as { acquireVsCodeApi?: () => { postMessage: (m: unknown) => void } }
    ).acquireVsCodeApi?.();
    api?.postMessage({ id: 0, type: 'log', level: 'error', message });
  } catch {
    // Nothing else we can do if even the raw API is unavailable.
  }
}

window.addEventListener('error', (ev) => {
  reportFatal(`uncaught error: ${ev.message} at ${ev.filename}:${ev.lineno}`);
});
window.addEventListener('unhandledrejection', (ev) => {
  const reason = ev.reason instanceof Error ? ev.reason.stack ?? ev.reason.message : String(ev.reason);
  reportFatal(`unhandled rejection: ${reason}`);
});

// NOTE: StrictMode is deliberately NOT used.
//
// It is not the cause of the startup stall, but it is also not useful here.
// StrictMode only double-invokes effects in React's *development* build, and
// this webview always ships the production build (the bundle has no
// `react-dom.development`, and NODE_ENV is statically replaced), so the
// extra mount/unmount pass never ran and bought no safety.
//
// The actual stall was an unstable `bridge` identity in useWebview — see the
// comment on that memo. It is fixed there; this file is left without
// StrictMode so there is one fewer effect-lifecycle variable in play.
ReactDOM.createRoot(rootEl).render(
  <I18nProvider>
    <App />
  </I18nProvider>
);
