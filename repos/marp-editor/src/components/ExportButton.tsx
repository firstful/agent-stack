import { renderSlides } from '../lib/marp'
import { useStore } from '../lib/store'

export function ExportButton() {
  const { markdown, css } = useStore()

  const handleExport = () => {
    const result = renderSlides(markdown, css)
    const slides = result.slides
    const combinedCss = result.css

    const slideHtml = slides.map((slide, i) => `
      <div class="slide${i > 0 ? ' slide-separator' : ''}">
        ${slide}
      </div>
    `).join('\n')

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page {
    size: 1920px 1080px;
    margin: 0;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; background: #fff; }
  .slide {
    width: 1920px;
    height: 1080px;
    overflow: hidden;
    position: relative;
  }
  .slide-separator {
    page-break-before: always;
    break-before: page;
  }
  ${combinedCss}
  section {
    width: 1920px;
    height: 1080px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 80px;
  }
</style>
</head>
<body>
${slideHtml}
<script>
window.onload = function() { window.print(); }
</script>
</body>
</html>`

    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const win = window.open(url, '_blank')
    if (win) {
      win.onload = () => URL.revokeObjectURL(url)
    } else {
      // Fallback: download as .html file
      const a = document.createElement('a')
      a.href = url
      a.download = 'presentation.html'
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  return (
    <button className="btn-ghost btn text-xs" onClick={handleExport} title="Export PDF via browser print">
      Export PDF
    </button>
  )
}
