function initHeroGradient(): void {
  const hero = document.querySelector('.md-content__inner');
  if (hero) hero.classList.add('home-hero');
}

function initAccentBar(introPara: HTMLParagraphElement): void {
  const bar = document.createElement('div');
  bar.className = 'hero-accent-bar';
  introPara.parentNode!.insertBefore(bar, introPara.nextSibling);
}

function initTypewriter(introPara: HTMLParagraphElement): void {
  const typeEl = document.createElement('div');
  typeEl.style.cssText = 'margin-bottom: 1.5em; font-size: 0.95em; color: var(--md-typeset-color);';
  typeEl.innerHTML = '<span>I work with&nbsp;</span><span class="hero-typewriter"></span>';
  introPara.parentNode!.insertBefore(typeEl, introPara.nextSibling!);

  const tagSpan = typeEl.querySelector('.hero-typewriter') as HTMLElement;
  const tags = ['TypeScript', 'Python', 'C#', 'OpenAPI', 'AsyncAPI', 'Cloud', 'Open Source'];
  let ti = 0, ci = 0, del = false;

  function type(): void {
    const cur = tags[ti];
    tagSpan.textContent = del ? cur.substring(0, --ci) : cur.substring(0, ++ci);
    if (!del && ci === cur.length) { del = true; setTimeout(type, 1800); return; }
    if (del && ci === 0) { del = false; ti = (ti + 1) % tags.length; setTimeout(type, 400); return; }
    setTimeout(type, del ? 35 : 70);
  }
  type();
}

function initCardEntrance(): void {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('.blog-override-post'));
  cards.forEach((c, i) => {
    c.style.opacity = '0';
    c.style.animationDelay = `${0.1 + i * 0.08}s`;
    requestAnimationFrame(() => c.classList.add('card-enter'));
  });
  returnCards(cards);
}

function returnCards(cards: HTMLElement[]): void {
  if (!window.matchMedia('(hover: hover)').matches ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  cards.forEach((card) => {
    card.classList.add('card-tilt');

    card.addEventListener('mousemove', (e: MouseEvent) => {
      const r = card.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const rx = (y / r.height - 0.5) * -12;
      const ry = (x / r.width - 0.5) * 12;
      card.style.transform = `perspective(600px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(600px) rotateX(0) rotateY(0)';
    });
  });
}

export function initHomePage(): void {
  const isHome = window.location.pathname === '/' || window.location.pathname === '';
  if (!isHome) return;

  initHeroGradient();

  const introPara = document.querySelector<HTMLParagraphElement>('.md-content__inner > p');
  if (!introPara) return;

  initAccentBar(introPara);
  initTypewriter(introPara);
  initCardEntrance();
}
