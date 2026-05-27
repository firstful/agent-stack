import { describe, it, before, after } from "node:test"
import { equal, ok } from "node:assert/strict"
import { writeFile, mkdir, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"
import { TapeBackend } from "./tape-backend.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const TAPE_PORT = 14567
const ENGRAM_PORT = 14568
const DATA_DIR = join(__dirname, "../.test-data")
const REPO_DIR = join(__dirname, "..")
const HOST = `http://127.0.0.1:${ENGRAM_PORT}`

let tape: TapeBackend
let engramProc: ReturnType<typeof spawn>
let engramStarted = false

async function waitForServer(url: string, timeoutMs = 10000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`)
}

let authToken = ""

let testSeq = 0

function nextConv(): string {
  return `conv_test_${++testSeq}`
}

describe("Hidden Tool Interception", () => {
  before(async () => {
    if (existsSync(DATA_DIR)) {
      await rm(DATA_DIR, { recursive: true, force: true })
    }
    await mkdir(DATA_DIR, { recursive: true })

    tape = new TapeBackend(TAPE_PORT)
    await tape.start()

    engramProc = spawn("npx", ["tsx", "src/index.ts"], {
      cwd: REPO_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ENGRA_PORT: String(ENGRAM_PORT),
        ENGRA_HOST: "127.0.0.1",
        ENGRA_DATA_DIR: DATA_DIR,
        ENGRA_OPENAI_BASE_URL: `http://127.0.0.1:${TAPE_PORT}/v1`,
        ENGRA_OPENAI_API_KEY: "test-key",
      },
    })

    engramProc.stdout?.on("data", (d) => process.stdout.write(`[engramic] ${d}`))
    engramProc.stderr?.on("data", (d) => process.stderr.write(`[engramic] ${d}`))

    await waitForServer(`http://127.0.0.1:${ENGRAM_PORT}/health`)

    const regRes = await fetch(`${HOST}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "openai",
        api_key: "test-key",
        base_url: `http://127.0.0.1:${TAPE_PORT}/v1`,
        default_model: "gpt-4o",
        label: "test",
      }),
    })
    const regData = await regRes.json() as { token: string }
    authToken = regData.token
  })

  after(async () => {
    if (engramProc && !engramProc.killed) {
      engramProc.kill("SIGTERM")
      await new Promise((r) => setTimeout(r, 500))
    }
    if (tape) await tape.stop()
    if (existsSync(DATA_DIR)) {
      await rm(DATA_DIR, { recursive: true, force: true })
    }
  })

  it("basic chat roundtrip works", async () => {
    tape.reset()
    tape.addText("Hello! I am a helpful assistant.")

    const res = await fetch(`${HOST}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body: JSON.stringify({
        model: "test/gpt-4o",
        messages: [{ role: "user", content: "Say hello" }],
        conversation_id: nextConv(),
      }),
    })
    equal(res.status, 200)
    const data = await res.json()
    ok(data.choices?.[0]?.message?.content?.length > 0, "Basic roundtrip should return content")
    equal(tape.callCount, 1, "Tape should have received 1 request")
  })

  it("intercepts remember() tool call and returns clean text", async () => {
    tape.reset()
    const convId = nextConv()

    // Step 1: Build a conversation with 2 normal turns (will become compressible)
    tape.addText("The capital of France is Paris.")
    let res = await fetch(`${HOST}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body: JSON.stringify({
        model: "test/gpt-4o",
        messages: [{ role: "user", content: "What is the capital of France?" }],
        conversation_id: convId,
      }),
    })
    equal(res.status, 200)

    tape.addText("OAuth 2.0 is an authorization framework.")
    res = await fetch(`${HOST}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body: JSON.stringify({
        model: "test/gpt-4o",
        messages: [{ role: "user", content: "What is OAuth?" }],
        conversation_id: convId,
      }),
    })
    equal(res.status, 200)

    // Step 2: Now send a request where tape returns remember() for a memory
    tape.addToolCall("remember", { memory_id: "mem_test123" })
    tape.addText("The OAuth discussion covered authorization code flow and refresh tokens.")

    res = await fetch(`${HOST}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body: JSON.stringify({
        model: "test/gpt-4o",
        messages: [{ role: "user", content: "Tell me about the OAuth discussion." }],
        conversation_id: convId,
      }),
    })

    equal(res.status, 200)
    const data = await res.json()
    const content = data.choices[0].message.content

    ok(typeof content === "string", "Content should be a string")

    // No tool calls leaked
    equal(data.choices[0].message.tool_calls, undefined, "Tool calls must NOT be visible to client")
    equal(data.choices[0].finish_reason, "stop", "Finish reason should be 'stop'")

    // Content should come from the reinference
    ok(content.includes("OAuth"), `Content should contain memory text, got: ${content}`)
  })

  it("falls back when remember() memory is missing", async () => {
    tape.reset()
    const convId = nextConv()
    const conv = {
      id: convId, spans: [], summaries: [], memories: [],
      events: [], policy: { compressionRate: "medium", recencyBias: 0.7, retentionPriority: [] },
      createdAt: Date.now(), updatedAt: Date.now(), metadata: {},
    }
    await writeFile(join(DATA_DIR, `${convId}.json`), JSON.stringify(conv, null, 2))

    tape.addToolCall("remember", { memory_id: "mem_nonexistent" })
    tape.addText("This fallback should not appear.")

    const res = await fetch(`${HOST}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body: JSON.stringify({
        model: "test/gpt-4o",
        messages: [
          { role: "user", content: "What did we discuss?" },
        ],
        conversation_id: convId,
      }),
    })

    equal(res.status, 200)
    const data = await res.json()
    ok(data.choices[0].message.content, "Should return some content even for missing memory")
  })

  it("intercepts expand_memory_range tool call", async () => {
    tape.reset()
    const convId = nextConv()
    const conv = {
      id: convId,
      spans: [
        {
          id: "span_a", messages: [
            { id: "m1", role: "user", content: [{ type: "text", text: "What is the capital of France?" }] },
            { id: "m2", role: "assistant", content: [{ type: "text", text: "Paris is the capital." }] },
          ], createdAt: Date.now() - 60000, summaryIds: ["sum_a"], embeddingIds: [], tokenCount: 50,
        },
      ],
      summaries: [["sum_a", { id: "sum_a", sourceSpanIds: ["span_a"], summaryText: "Geography discussion about France", importanceScore: 0.6, compressionRatio: 1.5, parentSummaryIds: [], childSummaryIds: [] }]],
      memories: [{ id: "mem_range", topic: "France geography", turnRange: "1-1", spanId: "span_a" }],
      events: [], policy: { compressionRate: "medium", recencyBias: 0.7, retentionPriority: [] },
      createdAt: Date.now() - 60000, updatedAt: Date.now() - 30000, metadata: {},
    }
    await writeFile(join(DATA_DIR, `${convId}.json`), JSON.stringify(conv, null, 2))

    tape.addToolCall("expand_memory_range", { start_span: "span_a", end_span: "span_a" })
    tape.addText("Span was expanded: Paris is the capital of France.")

    const res = await fetch(`${HOST}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body: JSON.stringify({
        model: "test/gpt-4o",
        messages: [{ role: "user", content: "Expand that range" }],
        conversation_id: convId,
      }),
    })

    equal(res.status, 200)
    const data = await res.json()
    equal(data.choices[0].message.tool_calls, undefined, "Tool calls must not leak")
    ok(data.choices[0].message.content.includes("Paris"), "Response should contain expanded content")
  })
})
