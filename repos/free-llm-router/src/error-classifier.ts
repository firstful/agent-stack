import { readFileSync, appendFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ErrorRule, ErrorCategory } from './types.js';
import { seedRules } from './error-classifier-seeds.js';

export class ErrorClassifier {
  private rules: ErrorRule[] = [];
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.init();
  }

  private init(): void {
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
    const path = join(this.dataDir, 'error-rules.jsonl');
    const seeds = seedRules();
    this.rules = [...seeds];
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8').trim();
      if (content) {
        for (const line of content.split('\n')) {
          try {
            const r = JSON.parse(line) as ErrorRule;
            const existing = this.rules.findIndex(e => e.id === r.id || (e.provider === r.provider && e.pattern === r.pattern && e.category === r.category));
            if (existing === -1) this.rules.push(r);
            else this.rules[existing] = r;
          } catch { /* skip malformed lines */ }
        }
      }
    } else {
      this.flushRulesFile();
    }
  }

  private flushRulesFile(): void {
    const path = join(this.dataDir, 'error-rules.jsonl');
    const lines = this.rules.map(r => JSON.stringify(r)).join('\n');
    writeFileSync(path, lines + '\n');
  }

  classify(provider: string, status: number, body: string): { category: ErrorCategory; ruleId?: string; matched: boolean } {
    const statusStr = String(status);
    const combined = `${statusStr}: ${body}`;

    const sorted = [...this.rules].sort((a, b) => {
      if (a.provider === provider && b.provider !== provider) return -1;
      if (a.provider !== provider && b.provider === provider) return 1;
      if (a.source === 'seed' && b.source !== 'seed') return -1;
      if (a.source !== 'seed' && b.source === 'seed') return 1;
      return 0;
    });

    for (const rule of sorted) {
      if (rule.provider !== '_shared' && rule.provider !== provider) continue;
      try {
        const re = new RegExp(rule.pattern, rule.flags);
        if (re.test(combined)) {
          return { category: rule.category, ruleId: rule.id, matched: true };
        }
      } catch { /* bad regex, skip */ }
    }

    return { category: 'transient', matched: false };
  }

  learnRule(provider: string, status: number, body: string, llmResponse: string): ErrorRule | null {
    try {
      const parsed = JSON.parse(llmResponse) as { category: ErrorCategory; regex: string; description: string };
      if (!['transient', 'config', 'format', 'rate_limit'].includes(parsed.category)) return null;

      try { new RegExp(parsed.regex, 'i'); } catch { return null; }

      const rule: ErrorRule = {
        id: `learned-${provider}-${Date.now().toString(36)}`,
        provider,
        category: parsed.category,
        pattern: parsed.regex,
        flags: 'i',
        source: 'llm',
        description: parsed.description || `Learned from ${provider} ${status}`,
        createdAt: new Date().toISOString(),
      };

      this.rules.push(rule);
      appendFileSync(join(this.dataDir, 'error-rules.jsonl'), JSON.stringify(rule) + '\n');
      return rule;
    } catch {
      return null;
    }
  }

  recordError(provider: string, status: number, body: string, category: ErrorCategory, ruleId?: string): void {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      provider,
      status,
      body: body.slice(0, 500),
      category,
      ruleId,
    });
    appendFileSync(join(this.dataDir, 'provider-errors.jsonl'), entry + '\n');
  }
}
