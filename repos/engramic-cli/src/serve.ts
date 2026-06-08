import Fastify from 'fastify'
import cors from '@fastify/cors'
import { OpenAIProvider } from './engramic-provider/openai.js'
import type { BackendConfig } from './auth.js'

export async function cmdServe(
  port: number,
  host: string,
  backend: BackendConfig,
  apiKey?: string,
): Promise<void> {
  // If an apiKey override is given (--key), use it instead of the stored one
  const provider = new OpenAIProvider(apiKey || backend.apiKey, backend.baseUrl)

  const app = Fastify({ logger: { level: 'info' } })
  await app.register(cors, { origin: true })

  // Health
  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    provider: backend.name,
    model: backend.defaultModel,
  }))

  // Models list
  app.get('/v1/models', async (_req, reply) => {
    try {
      const m = await fetchModels(provider)
      return { object: 'list', data: m }
    } catch {
      return {
        object: 'list',
        data: [{
          id: backend.defaultModel,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: backend.name,
        }],
      }
    }
  })

  // Chat completions
  app.post('/v1/chat/completions', async (request, reply) => {
    if (apiKey) {
      const header = String(request.headers.authorization || '')
      if (header.replace(/^Bearer\s+/i, '') !== apiKey) {
        return reply.status(401).send({ error: 'unauthorized' })
      }
    }

    const body = request.body as Record<string, unknown>
    const model = (body.model as string) || backend.defaultModel
    const stream = body.stream === true

    const req = {
      model,
      messages: body.messages as Array<Record<string, unknown>>,
      stream,
      max_tokens: body.max_tokens as number | undefined,
      temperature: body.temperature as number | undefined,
      tools: body.tools as unknown[] | undefined,
      tool_choice: body.tool_choice as string | undefined,
      response_format: body.response_format as Record<string, unknown> | undefined,
      stop: body.stop as string | string[] | undefined,
      top_p: body.top_p as number | undefined,
    }

    try {
      if (stream) {
        return await proxyStream(reply, provider, req, backend.name)
      }
      return await proxyJson(reply, provider, req, backend.name)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      request.log.error({ err }, 'Upstream request failed')
      return reply.status(502).send({ error: 'upstream_error', message })
    }
  })

  console.log(`\n  \u26a1 engramic serve`)
  console.log(`  ${'\u2500'.repeat(31)}`)
  console.log(`  Server   : http://${host}:${port}`)
  console.log(`  Backend  : ${backend.name} (${backend.baseUrl})`)
  console.log(`  Model    : ${backend.defaultModel}`)
  if (apiKey) console.log(`  Auth     : Bearer token required`)
  else console.log(`  Auth     : none`)
  console.log()

  await app.listen({ port, host })
}

async function fetchModels(provider: OpenAIProvider): Promise<Array<{ id: string; object: string; created: number; owned_by: string }>> {
  const res = await fetch(`${provider.getBaseUrl()}/models`, {
    headers: { Authorization: `Bearer ${provider.getApiKey()}` },
  })
  if (!res.ok) return []
  const data = (await res.json()) as { data?: Array<{ id: string }> }
  return (data.data || []).map(m => ({
    id: m.id,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'engramic',
  }))
}

async function proxyJson(
  reply: any,
  provider: OpenAIProvider,
  req: Record<string, unknown>,
  backendName: string,
): Promise<void> {
  const res = await fetch(`${provider.getBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.getApiKey()}`,
    },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Upstream error ${res.status}: ${text}`)
  }
  const data = await res.json()
  return reply.header('x-engramic-backend', backendName).send(data)
}

async function proxyStream(
  reply: any,
  provider: OpenAIProvider,
  req: Record<string, unknown>,
  backendName: string,
): Promise<void> {
  const res = await fetch(`${provider.getBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.getApiKey()}`,
    },
    body: JSON.stringify({ ...req, stream: true }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Upstream error ${res.status}: ${text}`)
  }
  if (!res.body) throw new Error('No response body')

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'x-engramic-backend': backendName,
  })

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) { reply.raw.end(); return }
      reply.raw.write(decoder.decode(value, { stream: true }))
    }
  } catch (err) {
    reply.raw.destroy(err as Error)
  }
}
