((): void => {
  const html = document.documentElement;

  // ── Smooth color scheme transitions + confetti ──
  const observer = new MutationObserver((): void => {
    requestAnimationFrame((): void => {
      html.classList.add("color-transition");
      setTimeout((): void => {
        html.classList.remove("color-transition");
      }, 350);
    });
    confettiBurst();
  });

  observer.observe(html, {
    attributes: true,
    attributeFilter: ["data-md-color-scheme"],
  });

  // ── Reading progress bar ──
  const bar = document.createElement("div");
  bar.id = "read-progress";
  document.body.prepend(bar);

  const updateProgress = (): void => {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight > 100) {
      bar.style.width = `${Math.min((scrollTop / docHeight) * 100, 100)}%`;
    }
  };

  window.addEventListener("scroll", updateProgress);
  window.addEventListener("resize", updateProgress);

  // ── Confetti burst ──
  function confettiBurst(): void {
    const count = 60;
    const colors = [
      "#a38256", "#bea88b", "#d4b078", "#dacfc0",
      "#e8d5b5", "#f0e0c8", "#7a6b50", "#c4956a",
    ];
    const container = document.createElement("div");
    container.style.cssText = [
      "position: fixed; top: 0; left: 0; width: 100%; height: 100%;",
      "pointer-events: none; z-index: 9998; overflow: hidden;",
    ].join(" ");
    document.body.appendChild(container);

    for (let i = 0; i < count; i++) {
      const piece = document.createElement("div");
      const color = colors[Math.floor(Math.random() * colors.length)];
      const size = Math.random() * 8 + 4;
      const startX = Math.random() * 100;
      const delay = Math.random() * 0.3;
      const duration = Math.random() * 1.5 + 1;
      const shapes = ["50%", "0%"];
      const br = shapes[Math.floor(Math.random() * shapes.length)];

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
        "opacity: 0;",
      ].join(" ");
      container.appendChild(piece);
    }

    setTimeout((): void => {
      if (container.parentNode) container.parentNode.removeChild(container);
    }, 3500);
  }

  // ── Click ripple ──
  document.addEventListener("click", (e: MouseEvent): void => {
    const ripple = document.createElement("div");
    ripple.className = "click-ripple";
    ripple.style.left = `${e.clientX - 60}px`;
    ripple.style.top = `${e.clientY - 60}px`;
    document.body.appendChild(ripple);
    ripple.addEventListener("animationend", (): void => {
      ripple.remove();
    });
  });

  // ── Console easter egg ──
  setTimeout((): void => {
    const styles = [
      "color: #bea88b",
      "font-size: 16px",
      "font-weight: bold",
      "padding: 8px",
    ].join(";");

    console.log("%c  sutliff  ", styles);
    console.log("%cHey, thanks for peeking under the hood!", "color: #a38256; font-size: 13px;");
    console.log(
      "%cThis site is built with MkDocs + Material. The source is at github.com/reedsutliff",
      "color: #888; font-size: 11px;"
    );
  }, 100);
})();
