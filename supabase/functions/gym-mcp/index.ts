// openGym MCP server: remote MCP over Streamable HTTP (stateless, JSON responses, no SSE stream),
// for Claude / ChatGPT custom connectors. Deploy with verify_jwt = false (supabase/config.toml):
// this function answers the 401 + WWW-Authenticate itself, which is how MCP clients discover the
// Supabase OAuth 2.1 server, and then checks each bearer token against Supabase Auth.
//
// Every tool runs as the signed-in user through the same gym_get / gym_put RPCs the app uses,
// with the user's token, so RLS, the definer checks and the 409 base check all apply.
// Account-level RPCs refuse these tokens (they carry a client_id claim; see
// supabase/migrations/20261023_ai_client_guard.sql).
//
// A minimal JSON-RPC implementation instead of the MCP SDK: the server needs initialize, ping,
// tools/* and prompts/*, which is less code than wiring the SDK's transport, and keeps the tool
// logic in plain JS (tools.js) that the frontend's vitest can test.
import { TOOLS, PROMPTS, callTool, buildPlanPrompt } from './tools.js'

const SB = Deno.env.get('SUPABASE_URL')!
const KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const RESOURCE = `${SB}/functions/v1/gym-mcp`
const META = `${RESOURCE}/.well-known/oauth-protected-resource`
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'www-authenticate, mcp-session-id'
}
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', ...extra } })

const unauthorized = (why: string) => json({ error: 'invalid_token', error_description: why }, 401, {
  'WWW-Authenticate': `Bearer resource_metadata="${META}"${why === 'missing token' ? '' : ', error="invalid_token"'}`
})

type Err = Error & { status?: number }
async function rest(path: string, token: string, init: RequestInit = {}) {
  const r = await fetch(SB + path, { ...init, headers: { apikey: KEY, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } })
  const text = await r.text()
  const data = text ? JSON.parse(text) : null
  if (!r.ok) throw Object.assign(new Error(data?.message || data?.msg || 'HTTP ' + r.status), { status: r.status }) as Err
  return data
}

function rpcErr(id: unknown, code: number, message: string) { return { jsonrpc: '2.0', id: id ?? null, error: { code, message } } }

async function handle(msg: any, token: string) {
  const { id, method, params } = msg || {}
  if (msg?.jsonrpc !== '2.0' || typeof method !== 'string') return rpcErr(id, -32600, 'Invalid Request')
  if (id === undefined) return null   // notification (e.g. notifications/initialized): nothing to answer
  switch (method) {
    case 'initialize': {
      const v = VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : VERSIONS[0]
      return { jsonrpc: '2.0', id, result: {
        protocolVersion: v, capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: 'opengym', title: 'openGym', version: '1.0.0' },
        instructions: 'openGym workout planner. Always get exercise ids from search_exercises or get_routines; never guess ids. In pregnancy mode the user must confirm avoid exercises herself.'
      } }
    }
    case 'ping': return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
    case 'prompts/list': return { jsonrpc: '2.0', id, result: { prompts: PROMPTS } }
    case 'prompts/get':
      if (params?.name !== 'build_plan') return rpcErr(id, -32602, 'Unknown prompt')
      return { jsonrpc: '2.0', id, result: buildPlanPrompt() }
    case 'tools/call': {
      const ctx = { rpc: (fn: string, args?: unknown) => rest(`/rest/v1/rpc/${fn}`, token, { method: 'POST', body: JSON.stringify(args || {}) }) }
      try { return { jsonrpc: '2.0', id, result: await callTool(params?.name, params?.arguments, ctx) } }
      catch (e) {
        if ((e as Err).status === 401) throw e
        console.error('tool failed', params?.name, e)
        return { jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: 'openGym could not do that right now: ' + (e as Error).message }] } }
      }
    }
    default: return rpcErr(id, -32601, 'Method not found')
  }
}

Deno.serve(async req => {
  const path = new URL(req.url).pathname
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  // RFC 9728 protected-resource metadata, linked from the 401 below.
  if (path.endsWith('/.well-known/oauth-protected-resource')) {
    return json({ resource: RESOURCE, authorization_servers: [`${SB}/auth/v1`], bearer_methods_supported: ['header'],
      scopes_supported: ['openid', 'email', 'profile'], resource_name: 'openGym' })
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' })   // no SSE stream offered

  const token = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return unauthorized('missing token')
  try { await rest('/auth/v1/user', token) }        // Supabase Auth verifies the JWT (signature, expiry, session)
  catch (e) { return (e as Err).status && (e as Err).status! < 500 ? unauthorized('token rejected') : json({ error: 'auth unavailable' }, 503) }

  let body: any
  try { body = await req.json() } catch { return json(rpcErr(null, -32700, 'Parse error'), 400) }
  try {
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map(m => handle(m, token)))).filter(Boolean)
      return out.length ? json(out) : new Response(null, { status: 202, headers: CORS })
    }
    const out = await handle(body, token)
    return out ? json(out) : new Response(null, { status: 202, headers: CORS })
  } catch (e) {
    if ((e as Err).status === 401) return unauthorized('token rejected')
    throw e
  }
})
