(() => {
  // src/ts/theme.ts
  function initThemeTransitions() {
    const html = document.documentElement;
    const observer = new MutationObserver(() => {
      requestAnimationFrame(() => {
        html.classList.add("color-transition");
        setTimeout(() => html.classList.remove("color-transition"), 350);
      });
    });
    observer.observe(html, {
      attributes: true,
      attributeFilter: ["data-md-color-scheme"]
    });
  }

  // src/ts/confetti.ts
  var COLORS = ["#b8895a", "#c4b094", "#dbbc8c", "#e8dfd0", "#e8d5b5", "#f0e0c8", "#7a6b50", "#c4956a"];
  function confettiBurst() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const count = 60;
    const container = document.createElement("div");
    container.style.cssText = [
      "position: fixed; top: 0; left: 0; width: 100%; height: 100%;",
      "pointer-events: none; z-index: 9998; overflow: hidden;"
    ].join("");
    document.body.appendChild(container);
    for (let i = 0; i < count; i++) {
      const piece = document.createElement("div");
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const size = Math.random() * 8 + 4;
      const startX = Math.random() * 100;
      const delay = Math.random() * 0.3;
      const duration = Math.random() * 1.5 + 1;
      const br = Math.random() > 0.5 ? "50%" : "0%";
      piece.style.cssText = [
        "position: absolute;",
        "top: 45%;",
        `left: ${startX}%;`,
        `width: ${size}px;`,
        `height: ${size * (Math.random() * 0.6 + 0.6)}px;`,
        `background: ${color};`,
        `border-radius: ${br};`,
        `animation: confetti-drop ${duration}s ease-out ${delay}s forwards;`,
        `transform: rotate(${Math.random() * 360}deg);`,
        "opacity: 0;"
      ].join("");
      container.appendChild(piece);
    }
    setTimeout(() => {
      if (container.parentNode) container.parentNode.removeChild(container);
    }, 3500);
  }
  function initConfettiOnToggle() {
    const html = document.documentElement;
    const observer = new MutationObserver(() => confettiBurst());
    observer.observe(html, { attributes: true, attributeFilter: ["data-md-color-scheme"] });
  }

  // src/ts/ripple.ts
  function initClickRipple() {
    document.addEventListener("click", (e) => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const ripple = document.createElement("div");
      ripple.className = "click-ripple";
      ripple.style.left = `${e.clientX - 60}px`;
      ripple.style.top = `${e.clientY - 60}px`;
      document.body.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove());
    });
  }

  // src/ts/progress.ts
  function initReadProgress() {
    const bar = document.createElement("div");
    bar.id = "read-progress";
    document.body.prepend(bar);
    function update() {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight > 100) {
        bar.style.width = `${Math.min(scrollTop / docHeight * 100, 100)}%`;
      }
    }
    window.addEventListener("scroll", update);
    window.addEventListener("resize", update);
  }

  // src/ts/hero.ts
  function initHeroGradient() {
    const hero = document.querySelector(".md-content__inner");
    if (hero) hero.classList.add("home-hero");
  }
  function initAccentBar(introPara) {
    const bar = document.createElement("div");
    bar.className = "hero-accent-bar";
    introPara.parentNode.insertBefore(bar, introPara.nextSibling);
  }
  function initTypewriter(introPara) {
    const typeEl = document.createElement("div");
    typeEl.style.cssText = "margin-bottom: 1.5em; font-size: 0.95em; color: var(--md-typeset-color);";
    typeEl.innerHTML = '<span>I work with&nbsp;</span><span class="hero-typewriter"></span>';
    introPara.parentNode.insertBefore(typeEl, introPara.nextSibling);
    const tagSpan = typeEl.querySelector(".hero-typewriter");
    const tags = ["TypeScript", "Python", "C#", "OpenAPI", "AsyncAPI", "Cloud", "Open Source"];
    let ti = 0, ci = 0, del = false;
    function type() {
      const cur = tags[ti];
      tagSpan.textContent = del ? cur.substring(0, --ci) : cur.substring(0, ++ci);
      if (!del && ci === cur.length) {
        del = true;
        setTimeout(type, 1800);
        return;
      }
      if (del && ci === 0) {
        del = false;
        ti = (ti + 1) % tags.length;
        setTimeout(type, 400);
        return;
      }
      setTimeout(type, del ? 35 : 70);
    }
    type();
  }
  function initCardEntrance() {
    const cards = Array.from(document.querySelectorAll(".blog-override-post"));
    cards.forEach((c, i) => {
      c.style.opacity = "0";
      c.style.animationDelay = `${0.1 + i * 0.08}s`;
      requestAnimationFrame(() => c.classList.add("card-enter"));
    });
    returnCards(cards);
  }
  function returnCards(cards) {
    if (!window.matchMedia("(hover: hover)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    cards.forEach((card) => {
      card.classList.add("card-tilt");
      card.addEventListener("mousemove", (e) => {
        const r = card.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        const rx = (y / r.height - 0.5) * -12;
        const ry = (x / r.width - 0.5) * 12;
        card.style.transform = `perspective(600px) rotateX(${rx}deg) rotateY(${ry}deg)`;
      });
      card.addEventListener("mouseleave", () => {
        card.style.transform = "perspective(600px) rotateX(0) rotateY(0)";
      });
    });
  }
  function initHomePage() {
    const isHome = window.location.pathname === "/" || window.location.pathname === "";
    if (!isHome) return;
    initHeroGradient();
    const introPara = document.querySelector(".md-content__inner > p");
    if (!introPara) return;
    initAccentBar(introPara);
    initTypewriter(introPara);
    initCardEntrance();
  }

  // src/ts/console-easter.ts
  function initConsoleEaster() {
    setTimeout(() => {
      const styles = [
        "color: #bea88b",
        "font-size: 16px",
        "font-weight: bold",
        "padding: 8px"
      ].join(";");
      console.log("%c  sutliff  ", styles);
      console.log("%cHey, thanks for peeking under the hood!", "color: #a38256; font-size: 13px;");
      console.log(
        "%cThis site is built with MkDocs + Material. The source is at github.com/reedsutliff",
        "color: #888; font-size: 11px;"
      );
    }, 100);
  }

  // src/ts/main.ts
  initThemeTransitions();
  initConfettiOnToggle();
  initClickRipple();
  initReadProgress();
  initHomePage();
  initConsoleEaster();
})();
