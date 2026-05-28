import fs from "node:fs"
import path from "node:path"
import { Pool } from "pg"

export async function runMigrations(databaseUrl: string): Promise<void> {
  const sqlPath = path.join(process.cwd(), "db", "init.sql")
  if (!fs.existsSync(sqlPath)) {
    console.warn("[migrate] init.sql not found at", sqlPath)
    return
  }

  const sql = fs.readFileSync(sqlPath, "utf-8")
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"))

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    for (const stmt of statements) {
      await pool.query(stmt + ";")
    }
    console.log("[migrate] init.sql applied successfully")
  } catch (err: any) {
    console.error("[migrate] failed to apply init.sql:", err.message)
    throw err
  } finally {
    await pool.end()
  }
}
