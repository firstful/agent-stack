const COLORS = ['#b8895a', '#c4b094', '#dbbc8c', '#e8dfd0', '#e8d5b5', '#f0e0c8', '#7a6b50', '#c4956a'];

export function confettiBurst(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const count = 60;
  const container = document.createElement('div');
  container.style.cssText = [
    'position: fixed; top: 0; left: 0; width: 100%; height: 100%;',
    'pointer-events: none; z-index: 9998; overflow: hidden;',
  ].join('');
  document.body.appendChild(container);

  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const size = Math.random() * 8 + 4;
    const startX = Math.random() * 100;
    const delay = Math.random() * 0.3;
    const duration = Math.random() * 1.5 + 1;
    const br = Math.random() > 0.5 ? '50%' : '0%';

    piece.style.cssText = [
      'position: absolute;',
      'top: 45%;',
      `left: ${startX}%;`,
      `width: ${size}px;`,
      `height: ${size * (Math.random() * 0.6 + 0.6)}px;`,
      `background: ${color};`,
      `border-radius: ${br};`,
      `animation: confetti-drop ${duration}s ease-out ${delay}s forwards;`,
      `transform: rotate(${Math.random() * 360}deg);`,
      'opacity: 0;',
    ].join('');
    container.appendChild(piece);
  }

  setTimeout(() => {
    if (container.parentNode) container.parentNode.removeChild(container);
  }, 3500);
}

export function initConfettiOnToggle(): void {
  const html = document.documentElement;
  const observer = new MutationObserver(() => confettiBurst());
  observer.observe(html, { attributes: true, attributeFilter: ['data-md-color-scheme'] });
}
