import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'marp.db')

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initSchema()
  }
  return db
}

function initSchema() {
  db.exec(`
    -- Better-Auth tables
    CREATE TABLE IF NOT EXISTS "user" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "email" TEXT NOT NULL UNIQUE,
      "emailVerified" INTEGER NOT NULL,
      "image" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "session" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "expiresAt" TEXT NOT NULL,
      "token" TEXT NOT NULL UNIQUE,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      "ipAddress" TEXT,
      "userAgent" TEXT,
      "userId" TEXT NOT NULL,
      FOREIGN KEY ("userId") REFERENCES "user"("id")
    );

    CREATE TABLE IF NOT EXISTS "account" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "providerId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "accessToken" TEXT,
      "refreshToken" TEXT,
      "idToken" TEXT,
      "accessTokenExpiresAt" TEXT,
      "refreshTokenExpiresAt" TEXT,
      "scope" TEXT,
      "password" TEXT,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      FOREIGN KEY ("userId") REFERENCES "user"("id")
    );

    CREATE TABLE IF NOT EXISTS "verification" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "identifier" TEXT NOT NULL,
      "value" TEXT NOT NULL,
      "expiresAt" TEXT NOT NULL,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    );

    -- Legacy users table (to be migrated)
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- App tables
    CREATE TABLE IF NOT EXISTS share_links (
      id TEXT PRIMARY KEY,
      presentation_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (presentation_id) REFERENCES presentations(id)
    );

    CREATE TABLE IF NOT EXISTS presentations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS version_nodes (
      id TEXT PRIMARY KEY,
      presentation_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      parent_version INTEGER,
      markdown TEXT NOT NULL,
      css TEXT NOT NULL DEFAULT '',
      theme TEXT NOT NULL DEFAULT 'default',
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      is_fork INTEGER NOT NULL DEFAULT 0,
      fork_label TEXT,
      FOREIGN KEY (presentation_id) REFERENCES presentations(id)
    );

    CREATE TABLE IF NOT EXISTS credit_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES "user"("id")
    );

    CREATE TABLE IF NOT EXISTS theme_palettes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_url TEXT NOT NULL,
      palette_json TEXT NOT NULL,
      user_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `)
}

export function ensureDataDir() {
  const dir = path.dirname(DB_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
