export function initClickRipple(): void {
  document.addEventListener('click', (e: MouseEvent) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ripple = document.createElement('div');
    ripple.className = 'click-ripple';
    ripple.style.left = `${e.clientX - 60}px`;
    ripple.style.top = `${e.clientY - 60}px`;
    document.body.appendChild(ripple);

    ripple.addEventListener('animationend', () => ripple.remove());
  });
}
