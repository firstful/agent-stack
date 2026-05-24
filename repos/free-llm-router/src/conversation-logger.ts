import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ChatMessage } from './types.js';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export interface ConversationEntry {
  id: string;
  created: number;
  updated: number;
  messages: ChatMessage[];
}

export class ConversationLogger {
  private entries: ConversationEntry[] = [];
  private filePath: string;
  private maxSize: number;

  constructor(filePath: string, maxSize?: number) {
    this.filePath = filePath;
    this.maxSize = maxSize ?? parseInt(process.env.CONV_LOG_MAX_SIZE || '20971520', 10);
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        return;
      }
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      if (!raw.trim()) return;
      this.entries = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (e) {
      console.error(`[convlog] load error: ${(e as Error).message}`);
    }
  }

  private save(): void {
    const data = () => this.entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, data(), 'utf-8');
    } catch (e) {
      console.error(`[convlog] save error: ${(e as Error).message}`);
    }
  }

  record(messages: ChatMessage[]): void {
    if (messages.length === 0) return;

    let best: ConversationEntry | null = null;
    let bestLen = 0;

    for (const entry of this.entries) {
      if (entry.messages.length >= messages.length) continue;
      const len = this.commonPrefixLen(entry.messages, messages);
      if (len === entry.messages.length && len > bestLen) {
        bestLen = len;
        best = entry;
      }
    }

    if (best) {
      best.messages = messages;
      best.updated = Date.now();
    } else {
      this.entries.push({
        id: crypto.randomUUID().slice(0, 8),
        created: Date.now(),
        updated: Date.now(),
        messages,
      });
    }

    this.evict();
    this.save();
  }

  private evict(): void {
    let raw = this.entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    while (Buffer.byteLength(raw, 'utf-8') > this.maxSize && this.entries.length > 1) {
      this.entries.shift();
      raw = this.entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    }
  }

  get size(): number { return this.entries.length; }

  query(options?: { limit?: number; since?: number }): ConversationEntry[] {
    let result = this.entries;
    if (options?.since) {
      result = result.filter(e => e.updated >= options.since!);
    }
    if (options?.limit && options.limit > 0) {
      result = result.slice(-options.limit);
    }
    return result;
  }

  private commonPrefixLen(a: ChatMessage[], b: ChatMessage[]): number {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i].role !== b[i].role) return i;
      if (a[i].content !== b[i].content) return i;
    }
    return len;
  }
}
