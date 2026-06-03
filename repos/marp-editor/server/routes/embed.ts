import { Router, Request, Response } from 'express'
import Marp from '@marp-team/marp-core'
import { getDb } from '../db'
import { starterThemes } from '../../src/lib/themes.js'

const router = Router()

interface BrandingOptions {
  bgColor: string | null
  accentColor: string | null
  fontFamily: string | null
  logoUrl: string | null
  showTitle: boolean
  theme: string | null
}

/**
 * Parse branding query parameters into a CSS-override object.
 * Supported params: bg_color, accent_color, font_family, logo_url, show_title, theme
 */
function parseBranding(query: Record<string, string | undefined>): BrandingOptions {
  return {
    bgColor: query.bg_color || query.bgColor || null,
    accentColor: query.accent_color || query.accentColor || null,
    fontFamily: query.font_family || query.fontFamily || null,
    logoUrl: query.logo_url || query.logoUrl || null,
    showTitle: query.show_title !== 'false' && query.showTitle !== 'false',
    theme: query.theme || null,
  }
}

/**
 * Resolve theme CSS from a theme ID.
 * Checks starter themes first, then saved themes in the DB.
 */
function resolveThemeCss(themeId: string): string | null {
  // Check starter (built-in) themes
  const starter = starterThemes.find(t => t.id === themeId)
  if (starter) return starter.css

  // Check saved themes in DB (by theme_palettes id or name)
  try {
    const db = getDb()
    const saved = db.prepare(
      'SELECT palette_json FROM theme_palettes WHERE id = ? OR name = ? LIMIT 1'
    ).get(themeId, themeId) as { palette_json: string } | undefined
    if (saved) {
      const palette = JSON.parse(saved.palette_json)
      return `/* Theme: ${palette.name} */
section {
  background-color: ${palette.colors.background};
  color: ${palette.colors.text};
  font-family: "${palette.fonts.body}", ${palette.fonts.fallback};
}
h1, h2, h3, h4, h5, h6 {
  color: ${palette.colors.primary};
  font-family: "${palette.fonts.heading}", ${palette.fonts.fallback};
}
a { color: ${palette.colors.accent}; }`
    }
  } catch { /* ignore DB errors for theme resolution */ }

  return null
}

/**
 * Build branding CSS overrides from query parameters.
 */
function brandingCss(branding: ReturnType<typeof parseBranding>): string {
  const lines: string[] = []

  if (branding.bgColor) {
    lines.push(`  --embed-bg: ${branding.bgColor};`)
  }
  if (branding.accentColor) {
    lines.push(`  --embed-accent: ${branding.accentColor};`)
  }
  if (branding.fontFamily) {
    lines.push(`  font-family: ${branding.fontFamily}, sans-serif !important;`)
  }

  return lines.length > 0 ? `:root {\n${lines.join('\n')}\n}` : ''
}

/**
 * Render markdown to individual slide HTML sections using Marp.
 */
function renderMarpSlides(markdown: string, userCss?: string): {
  slides: string[]
  css: string
} {
  const marp = new Marp()
  const rendered = marp.render(markdown)

  const slideRegex = /<section[^>]*>[\s\S]*?<\/section>/g
  const slides: string[] = []
  let match
  while ((match = slideRegex.exec(rendered.html)) !== null) {
    slides.push(match[0])
  }

  const combinedCss = [
    rendered.css,
    userCss || '',
    `
    section {
      font-family: system-ui, -apple-system, sans-serif;
    }
    `,
  ].join('\n')

  return {
    slides: slides.length > 0 ? slides : [rendered.html],
    css: combinedCss,
  }
}

// ──────────────────────────────────────────────
// GET /embed/:token — Full embed page (public)
// Used as the iframe src for external embeds.
// Query params for branding:
//   ?bg_color=#1a1a2e&accent_color=#e94560&font_family=Inter&logo_url=https://...
//   &show_title=false
// ──────────────────────────────────────────────
router.get('/embed/:token', (req: Request, res: Response) => {
  try {
    const db = getDb()
    const { token } = req.params
    const branding = parseBranding(req.query as Record<string, string>)

    const link = db.prepare(`
      SELECT sl.id, sl.presentation_id, sl.expires_at, sl.is_active,
             p.title, vn.markdown, vn.css
      FROM share_links sl
      JOIN presentations p ON p.id = sl.presentation_id
      JOIN version_nodes vn ON vn.presentation_id = p.id
      WHERE sl.token = ?
      AND vn.version = (SELECT MAX(version) FROM version_nodes WHERE presentation_id = p.id)
    `).get(token) as any

    if (!link) {
      res.status(404).type('html').send(`
<!DOCTYPE html><html><head><title>Not Found</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#111;color:#999;}</style>
</head><body><div><h1>404</h1><p>Presentation not found</p></div></body></html>`)
      return
    }

    if (!link.is_active) {
      res.status(410).type('html').send(`
<!DOCTYPE html><html><head><title>Revoked</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#111;color:#999;}</style>
</head><body><div><h1>410</h1><p>This share link has been revoked</p></div></body></html>`)
      return
    }

    if (link.expires_at && Date.now() > link.expires_at) {
      res.status(410).type('html').send(`
<!DOCTYPE html><html><head><title>Expired</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#111;color:#999;}</style>
</head><body><div><h1>410</h1><p>This share link has expired</p></div></body></html>`)
      return
    }

    // Resolve theme CSS if a theme ID is specified
    let themeCss = ''
    if (branding.theme) {
      const resolved = resolveThemeCss(branding.theme)
      if (resolved) themeCss = resolved
    }

    // Combine user CSS with theme CSS (theme overrides user)
    const combinedCss = themeCss ? [link.css, themeCss].filter(Boolean).join('\n') : link.css

    // Render the slides server-side
    const { slides, css: marpCss } = renderMarpSlides(link.markdown, combinedCss)
    const brandingOverrides = brandingCss(branding)

    // Build the full embed page
    const slideJson = JSON.stringify(slides)

    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${link.title}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --embed-bg: #0f0f0f;
    --embed-accent: #3b82f6;
    --text-primary: #f0f0f0;
    --text-secondary: #a0a0a0;
    --nav-hover: rgba(255,255,255,0.12);
    --title-bar-h: 48px;
    --nav-btn-w: 56px;
  }

  ${brandingOverrides}

  html, body {
    height: 100%;
    background: var(--embed-bg);
    color: var(--text-primary);
    font-family: system-ui, -apple-system, sans-serif;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }\n\n  /* Marp slide styles */
  ${marpCss}

  /* Ensure Marp slides fill their container */
  section {
    width: 100% !important;
    height: 100% !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: center !important;
    padding: 48px 64px !important;
  }

  /* Embed chrome */
  #embed-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  /* Title bar (optional) */
  #title-bar {
    display: ${branding.showTitle ? 'flex' : 'none'};
    align-items: center;
    justify-content: space-between;
    height: var(--title-bar-h);
    padding: 0 16px;
    background: rgba(0,0,0,0.4);
    border-bottom: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
  }

  #title-bar .branding-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  #title-bar .logo-img {
    height: 24px;
    width: auto;
    display: ${branding.logoUrl ? 'block' : 'none'};
  }

  #title-bar .slide-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  #title-bar .slide-counter {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  /* Slide area */
  #slide-area {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
    cursor: pointer;
  }

  #slide-wrapper {
    width: 100%;
    height: 100%;
    max-width: 1280px;
    max-height: 720px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .slide-frame {
    width: 100%;
    height: 100%;
    border: none;
    border-radius: 4px;
    background: transparent;
  }

  /* Navigation hot zones */
  .nav-hot-zone {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s;
    z-index: 10;
    cursor: pointer;
  }

  .nav-hot-zone:hover {
    opacity: 1;
  }

  .nav-hot-zone.left  { left: 0; background: linear-gradient(90deg, rgba(0,0,0,0.3) 0%, transparent 100%); }
  .nav-hot-zone.right { right: 0; background: linear-gradient(270deg, rgba(0,0,0,0.3) 0%, transparent 100%); }

  .nav-arrow {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: rgba(0,0,0,0.6);
    border: 1px solid rgba(255,255,255,0.15);
    color: var(--text-primary);
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
    transition: background 0.15s;
  }

  .nav-arrow:hover {
    background: var(--nav-hover);
  }

  .nav-arrow.hidden {
    visibility: hidden;
  }

  /* Dots navigation */
  #dots {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 12px 16px;
    flex-shrink: 0;
    background: rgba(0,0,0,0.2);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: none;
    background: rgba(255,255,255,0.2);
    cursor: pointer;
    transition: all 0.15s;
    padding: 0;
  }

  .dot:hover {
    background: rgba(255,255,255,0.4);
  }

  .dot.active {
    background: var(--embed-accent);
    transform: scale(1.3);
  }

  /* Responsive scaling */
  @media (max-width: 768px) {
    section {
      padding: 24px 28px !important;
    }
    #title-bar { --title-bar-h: 40px; }
    .nav-hot-zone { width: 40px; }
    .nav-arrow { width: 32px; height: 32px; font-size: 14px; }
    #dots { padding: 8px 12px; }
    .dot { width: 6px; height: 6px; }
  }
</style>
</head>
<body>
<div id="embed-container">
  ${branding.showTitle ? `
  <div id="title-bar">
    <div class="branding-left">
      ${branding.logoUrl ? `<img class="logo-img" src="${escapeHtml(branding.logoUrl)}" alt="Logo" />` : ''}
      <span class="slide-title">${escapeHtml(link.title)}</span>
    </div>
    <span class="slide-counter" id="slide-counter">1 / ${slides.length}</span>
  </div>` : ''}

  <div id="slide-area">
    <div class="nav-hot-zone left" id="nav-left" onclick="navigate(-1)">
      <div class="nav-arrow" id="arrow-left">◀</div>
    </div>

    <div id="slide-wrapper">
      <iframe class="slide-frame" id="slide-frame" sandbox="allow-same-origin" />
    </div>

    <div class="nav-hot-zone right" id="nav-right" onclick="navigate(1)">
      <div class="nav-arrow" id="arrow-right">▶</div>
    </div>
  </div>

  <div id="dots"></div>
</div>

<script>
  // Slide data pre-rendered server-side
  var SLIDES = ${slideJson};
  var current = 0;

  function renderSlide(index) {
    if (index < 0 || index >= SLIDES.length) return;
    current = index;
    var iframe = document.getElementById('slide-frame');
    iframe.srcdoc = '<!DOCTYPE html><html><head><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:transparent;}</style></head><body>' + SLIDES[index] + '</body></html>';

    // Update counter
    var counter = document.getElementById('slide-counter');
    if (counter) counter.textContent = (index + 1) + ' / ' + SLIDES.length;

    // Update dots
    var dots = document.querySelectorAll('.dot');
    dots.forEach(function(d, i) {
      d.classList.toggle('active', i === index);
    });

    // Update arrows
    document.getElementById('arrow-left').classList.toggle('hidden', index === 0);
    document.getElementById('arrow-right').classList.toggle('hidden', index === SLIDES.length - 1);
  }

  function navigate(dir) {
    var next = current + dir;
    if (next >= 0 && next < SLIDES.length) {
      renderSlide(next);
    }
  }

  function jumpTo(index) {
    if (index >= 0 && index < SLIDES.length) {
      renderSlide(index);
    }
  }

  // Build dots
  (function() {
    var container = document.getElementById('dots');
    for (var i = 0; i < SLIDES.length; i++) {
      var dot = document.createElement('button');
      dot.className = 'dot' + (i === 0 ? ' active' : '');
      dot.setAttribute('aria-label', 'Go to slide ' + (i + 1));
      dot.onclick = (function(idx) { return function() { jumpTo(idx); }; })(i);
      container.appendChild(dot);
    }
  })();

  // Keyboard navigation
  document.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
      e.preventDefault();
      navigate(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      navigate(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      jumpTo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      jumpTo(SLIDES.length - 1);
    }
  });

  // Click to advance
  document.getElementById('slide-area').addEventListener('click', function(e) {
    // Don't advance if clicking on a nav button
    if (e.target.closest('.nav-hot-zone')) return;
    navigate(1);
  });

  // Render first slide
  renderSlide(0);
</script>
</body>
</html>`)
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to render embed'
    res.status(500).type('html').send(`
<!DOCTYPE html><html><head><title>Error</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#111;color:#999;}</style>
</head><body><div><h1>500</h1><p>${escapeHtml(error)}</p></div></body></html>`)
  }
})

// ──────────────────────────────────────────────
// GET /api/embed/:token/snippet — Returns embed iframe HTML snippet (public)
// External sites call this to get the <iframe> code to paste.
// Query params: same branding params as /embed/:token
// Returns JSON with { html, url, slides, options }
// ──────────────────────────────────────────────
router.get('/api/embed/:token/snippet', (req: Request, res: Response) => {
  try {
    const db = getDb()
    const { token } = req.params
    const branding = parseBranding(req.query as Record<string, string>)

    // Validate the share link exists and is active
    const link = db.prepare(`
      SELECT sl.id, sl.presentation_id, sl.expires_at, sl.is_active,
             p.title, vn.markdown
      FROM share_links sl
      JOIN presentations p ON p.id = sl.presentation_id
      JOIN version_nodes vn ON vn.presentation_id = p.id
      WHERE sl.token = ?
      AND vn.version = (SELECT MAX(version) FROM version_nodes WHERE presentation_id = p.id)
    `).get(token) as any

    if (!link) {
      res.status(404).json({ error: 'Presentation not found' })
      return
    }

    if (!link.is_active) {
      res.status(410).json({ error: 'Share link has been revoked' })
      return
    }

    if (link.expires_at && Date.now() > link.expires_at) {
      res.status(410).json({ error: 'Share link has expired' })
      return
    }

    // Build the embed URL with branding params
    const embedUrl = new URL(`/embed/${token}`, `${req.protocol}://${req.get('host')}`)
    const brandingParams: Record<string, string> = {}

    if (branding.bgColor) brandingParams.bg_color = branding.bgColor
    if (branding.accentColor) brandingParams.accent_color = branding.accentColor
    if (branding.fontFamily) brandingParams.font_family = branding.fontFamily
    if (branding.logoUrl) brandingParams.logo_url = branding.logoUrl
    if (!branding.showTitle) brandingParams.show_title = 'false'

    for (const [key, value] of Object.entries(brandingParams)) {
      embedUrl.searchParams.set(key, value)
    }

    const url = embedUrl.toString()

    // Generate the iframe HTML snippet
    const iframeHtml = `<iframe src="${escapeHtml(url)}" width="800" height="450" frameborder="0" allowfullscreen title="${escapeHtml(link.title)}"></iframe>`

    // Count slides from raw markdown (lightweight, no Marp render needed)
    const slideCount = link.markdown
      ? Math.max(1, link.markdown.split(/\n---\n/).filter((s: string) => s.trim()).length)
      : 1

    res.json({
      html: iframeHtml,
      url,
      title: link.title,
      slides: slideCount,
      options: {
        bgColor: branding.bgColor,
        accentColor: branding.accentColor,
        fontFamily: branding.fontFamily,
        logoUrl: branding.logoUrl,
        showTitle: branding.showTitle,
      },
    })
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Failed to generate snippet'
    res.status(500).json({ error })
  }
})

/**
 * Simple HTML entity escaping.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export default router
