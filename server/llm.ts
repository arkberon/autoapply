import { getSetting } from './db.ts'
import type { LlmStatus } from '../shared/types.ts'

// The app talks to any server that speaks the OpenAI chat API. Ollama, LM Studio
// and mlx_lm.server all do, so the model runs on this machine and nothing about
// the applicant leaves it.

export const DEFAULT_LLM_BASE_URL = 'http://localhost:11434/v1'

export function llmConfig() {
  return {
    baseUrl: getSetting('llm_base_url', DEFAULT_LLM_BASE_URL).replace(/\/+$/, ''),
    model: getSetting('llm_model'),
    apiKey: getSetting('llm_api_key'),
  }
}

function headers(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }
}

/** Asks the model for a JSON object and parses it. Throws when the reply is not valid JSON. */
export async function chatJson<T>(system: string, user: string, timeoutMs = 120_000): Promise<T> {
  const { baseUrl, model, apiKey } = llmConfig()
  const ask = (jsonMode: boolean) =>
    fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers(apiKey),
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        temperature: 0,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })

  // Not every model supports the server's strict JSON mode; the prompt alone is
  // enough for those, and the reply is validated either way.
  let res = await ask(true)
  if (!res.ok && res.status !== 401) res = await ask(false)
  if (!res.ok) throw new Error(`Model server answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  // Some servers leave a thinking model's reasoning inline; the answer is what follows it.
  const text = (body.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '')
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as T
}

export async function testLlm(): Promise<LlmStatus> {
  const { baseUrl, model, apiKey } = llmConfig()
  const status: LlmStatus = { baseUrl, model, ok: false, message: '', models: [] }

  try {
    const res = await fetch(`${baseUrl}/models`, { headers: headers(apiKey), signal: AbortSignal.timeout(5_000) })
    if (!res.ok) throw new Error(`answered ${res.status}`)
    const body = (await res.json()) as { data?: { id: string }[] }
    status.models = (body.data ?? []).map((m) => m.id).sort()
  } catch {
    status.message = `Nothing is answering at ${baseUrl}. Start your local model app, then test again.`
    return status
  }

  if (status.models.length === 0) {
    status.message = 'The model server is running but has no models yet. Download one, then test again.'
    return status
  }
  if (!model) {
    status.message = 'The model server is running. Pick a model below.'
    return status
  }
  if (!status.models.includes(model)) {
    status.message = `"${model}" is not downloaded on this server. Pick one from the list.`
    return status
  }

  try {
    const reply = await chatJson<{ ok?: boolean }>(
      'You reply with JSON only.',
      'Reply with exactly {"ok": true}.',
    )
    status.ok = reply.ok === true
    status.message = status.ok ? `Connected to ${model}.` : `${model} replied, but not in the JSON format the app needs.`
  } catch (err) {
    status.message = `${model} did not reply usefully: ${err instanceof Error ? err.message : String(err)}`
  }
  return status
}
