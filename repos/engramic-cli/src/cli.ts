import { cmdAuthConnect, cmdAuthList, loadBackends, getActiveBackend } from './auth.js'
import { cmdServe } from './serve.js'

const VERSION = '0.1.0'

export async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    showHelp()
    process.exit(0)
  }

  const command = args[0]

  switch (command) {
    case 'auth':
      return handleAuth(args.slice(1))
    case 'serve':
      return handleServe(args.slice(1))
    case '--help':
    case '-h':
    case 'help':
      showHelp()
      return
    case '--version':
    case '-v':
    case 'version':
      console.log(VERSION)
      return
    default:
      console.error(`Unknown command: ${command}`)
      showHelp()
      process.exit(1)
  }
}

function handleAuth(args: string[]): void {
  const sub = args[0]
  switch (sub) {
    case 'connect':
      cmdAuthConnect(args.slice(1))
      break
    case 'list':
    case 'ls':
      cmdAuthList()
      break
    default:
      console.error('Usage: engramic auth connect [name] --key <key> [--url <url>] [--model <model>]')
      console.error('       engramic auth list')
      process.exit(1)
  }
}

function handleServe(args: string[]): void {
  let port = 1111
  let host = '0.0.0.0'
  let keyOverride: string | undefined

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':
      case '-p':
        port = parseInt(args[++i], 10)
        break
      case '--host':
        host = args[++i]
        break
      case '--key':
      case '-k':
        keyOverride = args[++i]
        break
      default:
        if (args[i]?.startsWith('-')) {
          console.error(`Unknown flag: ${args[i]}`)
          process.exit(1)
        }
    }
  }

  const backend = getActiveBackend()
  if (!backend) {
    console.error('No backend configured.')
    console.error('Run: engramic auth connect --key <api-key>')
    process.exit(1)
    return
  }

  cmdServe(port, host, backend, keyOverride).catch((err) => {
    console.error('Server failed:', err)
    process.exit(1)
  })
}

function showHelp(): void {
  console.log(`
  engramic v${VERSION} - AI proxy server

  USAGE
    engramic <command> [options]

  COMMANDS
    auth connect [name]   Connect to an AI provider backend
      --key, -k <key>      API key (required)
      --url, -u <url>      Base URL (default: https://api.openai.com/v1)
      --model, -m <model>  Default model (default: gpt-4o)

    auth list              Show configured backends

    serve                  Start the proxy server
      --port, -p <port>    Port (default: 1111)
      --host <addr>        Host (default: 0.0.0.0)
      --key, -k <key>      Override API key for this session

    help, --help, -h       Show this help
    version, --version, -v Show version

  ENVIRONMENT
    ENGRAMIC_API_KEY       API key (for auth connect)
    ENGRAMIC_BASE_URL      Base URL override
    ENGRAMIC_PORT          Port override

  EXAMPLES
    engramic auth connect --key sk-proj-xxx
    engramic auth connect my-provider --key sk-xxx --url https://ai.example.com/v1
    engramic serve --port 1111
    engramic serve -p 8080 -k sk-xxx
  `)
}
