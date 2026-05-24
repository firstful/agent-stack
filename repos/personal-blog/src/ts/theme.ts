export function initThemeTransitions(): void {
  const html = document.documentElement;

  const observer = new MutationObserver(() => {
    requestAnimationFrame(() => {
      html.classList.add('color-transition');
      setTimeout(() => html.classList.remove('color-transition'), 350);
    });
  });

  observer.observe(html, {
    attributes: true,
    attributeFilter: ['data-md-color-scheme'],
  });
}
