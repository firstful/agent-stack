export interface StarterTheme {
  id: string
  name: string
  description: string
  css: string
}

export const starterThemes: StarterTheme[] = [
  {
    id: 'default-light',
    name: 'Default Light',
    description: 'Clean white background with dark text',
    css: `section {
  background: white;
  color: #1a1a2e;
}
h1 { color: #0f3460; }
h2 { color: #16213e; }
a { color: #2563eb; }`,
  },
  {
    id: 'dark',
    name: 'Dark Mode',
    description: 'Dark background with light text',
    css: `section {
  background: #1a1a2e;
  color: #e0e0e0;
}
h1, h2, h3 { color: #64b5f6; }
a { color: #90caf9; }
code { background: #2d2d44; }`,
  },
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Blue-green tones with warm accents',
    css: `section {
  background: linear-gradient(135deg, #0c2340, #1a5276);
  color: #d4e6f1;
}
h1 { color: #85c1e9; }
h2 { color: #a3d6f5; }
a { color: #f0b27a; }
code { background: #1a3a5c; }`,
  },
  {
    id: 'forest',
    name: 'Forest',
    description: 'Earthy greens with warm brown accents',
    css: `section {
  background: #1b2e1b;
  color: #d4e6c3;
}
h1 { color: #81c784; }
h2 { color: #a5d6a7; }
a { color: #ffcc80; }
code { background: #2a422a; }`,
  },
  {
    id: 'sunset',
    name: 'Sunset',
    description: 'Warm orange-red tones',
    css: `section {
  background: linear-gradient(135deg, #2d1b3d, #4a1a2e);
  color: #fce4d6;
}
h1 { color: #ff8a65; }
h2 { color: #ffab91; }
a { color: #ffd54f; }
code { background: #3d1f2e; }`,
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'High contrast, sans-serif, clean lines',
    css: `section {
  background: #fafafa;
  color: #212121;
}
h1, h2, h3 {
  color: #000;
  font-weight: 300;
  letter-spacing: -0.02em;
}
a { color: #1976d2; }
code { background: #eee; }`,
  },
  {
    id: 'terminal',
    name: 'Terminal',
    description: 'Green-on-black retro terminal aesthetic',
    css: `section {
  background: #0d0d0d;
  color: #33ff33;
  font-family: 'Courier New', monospace;
}
h1, h2, h3 {
  color: #00ff00;
  font-family: 'Courier New', monospace;
  text-transform: uppercase;
}
a { color: #00bfff; }
code { background: #1a1a1a; }`,
  },
  {
    id: 'lavender',
    name: 'Lavender',
    description: 'Soft purple tones for a calm feel',
    css: `section {
  background: #2b1f3d;
  color: #e8dff5;
}
h1 { color: #ce93d8; }
h2 { color: #b39ddb; }
a { color: #80cbc4; }
code { background: #3d2a54; }`,
  },
]
