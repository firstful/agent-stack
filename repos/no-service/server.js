const http = require("http");
const port = process.env.PORT || 3999;

const DASH_URL = process.env.DASH_URL || "https://dash.ffilt.us";

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>No Service Configured</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }
    .container { text-align: center; }
    h1 { font-size: 2.5rem; margin-bottom: 0.5rem; }
    p { color: #94a3b8; font-size: 1.125rem; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: #1e293b; padding: 0.2em 0.4em; border-radius: 4px; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="container">
    <h1>No Service Configured</h1>
    <p>This subdomain (<code id="hostname"></code>) does not have a service configured yet.</p>
    <p style="margin-top: 1.5rem"><a href="${DASH_URL}">View all services on the dashboard &rarr;</a></p>
  </div>
  <script>document.getElementById("hostname").textContent = window.location.hostname;</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
});

server.listen(port, () => {
  console.log(`no-service listening on ${port}`);
});
