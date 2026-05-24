export function initReadProgress(): void {
  const bar = document.createElement('div');
  bar.id = 'read-progress';
  document.body.prepend(bar);

  function update(): void {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight > 100) {
      bar.style.width = `${Math.min((scrollTop / docHeight) * 100, 100)}%`;
    }
  }

  window.addEventListener('scroll', update);
  window.addEventListener('resize', update);
}
