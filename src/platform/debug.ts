// URLに ?debug を付けると画面内コンソールを表示する。
// iOSの実機デバッグはMacがないとできないため、その代わりに使う。
export function initDebugConsole(): void {
  if (!location.search.includes('debug')) return;

  const box = document.createElement('div');
  box.className = 'debug-console';
  const head = document.createElement('div');
  head.className = 'debug-head';
  head.textContent = '🐞 debug console';
  const body = document.createElement('div');
  body.className = 'debug-body';
  box.append(head, body);

  let open = false;
  head.addEventListener('click', () => {
    open = !open;
    box.classList.toggle('open', open);
  });

  const push = (level: string, args: unknown[]): void => {
    const line = document.createElement('div');
    line.className = `debug-line debug-${level}`;
    const text = args
      .map((a) => {
        if (typeof a === 'string') return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    body.appendChild(line);
    while (body.childElementCount > 200) body.firstElementChild?.remove();
    body.scrollTop = body.scrollHeight;
    if (level === 'error') head.textContent = '🐞 debug console (error!)';
  };

  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      push(level, args);
    };
  }
  window.addEventListener('error', (e) => push('error', [e.message, `${e.filename}:${e.lineno}`]));
  window.addEventListener('unhandledrejection', (e) => push('error', ['unhandledrejection:', String(e.reason)]));

  document.body.appendChild(box);
  push('info', [`GAME100 v${__APP_VERSION__}`, navigator.userAgent]);
}
