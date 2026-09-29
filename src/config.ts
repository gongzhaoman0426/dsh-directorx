import z from '@deepseek-ai/schemastery'

export const SETTINGS_NS = 'directorx'

/**
 * Live settings reference for one volatile config leaf. 0.2.x projects the
 * settings form from the entry's own volatile config, and a volatile leaf is a
 * reference rather than a value: read it with `get()` to see what is committed.
 * Declared structurally because the published cordis type surface does not
 * re-export the runtime's `Volatile`.
 */
export interface Volatile<T> {
  get(): T
}

export type CapabilityMode =
  | 'deepseek-chat'
  | 'openai-chat'
  | 'openai-images'
  | 'openai-videos'
  | 'modelverse-tasks'
  | 'openai-tts'
  | 'kling'
  | 'runway'
  | 'minimax-h3'
  | 'kling-v3'
  | 'vidu'
  | 'veo'
  | 'generic-rest'
  | 'mock'

export interface CapabilitySettings {
  /** Master switch. The matching DirectorX tool is only registered when true. */
  enabled: boolean
  /** Protocol/configuration mode. */
  mode: CapabilityMode
  /** OpenAI-compatible API base URL, including the version segment when applicable. */
  baseURL: string
  /** API key. Kept in the DSH credential/settings store; also falls back to env. */
  apiKey: string
  /** Model id used by this capability. */
  model: string
  /** Provider-specific output tier, e.g. 2K for MiniMax-H3 video tasks. */
  resolution: string
  /** Mode-specific credentials and options (per-provider auth schemes). */
  auth: ModeAuth
}

/** Per-mode credential/option bag; every field defaults empty and stays secret where it names a credential. */
export interface ModeAuth {
  /** Kling (可灵) AccessKey for JWT signing. */
  klingAk: string
  /** Kling (可灵) SecretKey for JWT signing. */
  klingSk: string
  /** Runway API version header value, e.g. `2024-11-06`; empty = omit the header. */
  runwayVersion: string
}

export type InitiativeMode = '严格' | '自动' | '协同'

export interface DirectorxSettings {
  outputDir: string
  timeoutMs: number
  pollIntervalMs: number
  maxPollAttempts: number
  /** Dedicated 成片 persona — analysis is from a 导演角度. */
  persona: '成片'
  /** Initiative: 严格 / 自动 / 协同. */
  initiative: InitiativeMode
  vision: CapabilitySettings
  image: CapabilitySettings
  video: CapabilitySettings
  audio: CapabilitySettings
}

export const VISION_MODES = ['deepseek-chat', 'openai-chat', 'mock'] as const
export const IMAGE_MODES = ['openai-images', 'modelverse-tasks', 'generic-rest', 'mock'] as const
export const VIDEO_MODES = ['openai-videos', 'modelverse-tasks', 'kling', 'kling-v3', 'runway', 'minimax-h3', 'vidu', 'veo', 'generic-rest', 'mock'] as const
export const AUDIO_MODES = ['openai-tts', 'generic-rest', 'mock'] as const

function modeAuth() {
  return z.object({
    klingAk: z.string().role('secret').default('').description('Kling 可灵 AccessKey（JWT 签名用，仅 kling 模式需要）。').volatile(),
    klingSk: z.string().role('secret').default('').description('Kling 可灵 SecretKey（JWT 签名用，仅 kling 模式需要）。').volatile(),
    runwayVersion: z.string().default('').description('Runway API 版本头（如 2024-11-06），留空则不发送该头。').volatile(),
  })
}

function capability(modes: readonly string[], mode: string, baseURL: string, model: string, resolution = '1K') {
  return z.object({
    enabled: z.boolean().default(true).description('Register and expose this capability to the agent.').volatile(),
    mode: z.union(modes as unknown as string[]).default(mode).description('Protocol used to reach the provider.').volatile(),
    baseURL: z.string().default(baseURL).description('Base URL, e.g. https://api.openai.com/v1.').volatile(),
    apiKey: z.string().role('secret').default('').description('API key; empty means local endpoint or env fallback.').volatile(),
    model: z.string().default(model).description('Model id.').volatile(),
    resolution: z.string().default(resolution).description('Provider-specific output tier.').volatile(),
    auth: modeAuth(),
  })
}

export const DirectorxSettings = z.object({
  outputDir: z.string().default('directorx_output').description('Directory under the current working directory for downloaded media.').volatile(),
  timeoutMs: z.number().step(1).min(1_000).max(3_600_000).default(120_000).description('HTTP timeout for one provider request.').volatile(),
  pollIntervalMs: z.number().step(1).min(500).max(60_000).default(5_000).description('Async task polling interval.').volatile(),
  maxPollAttempts: z.number().step(1).min(1).max(2_000).default(360).description('Maximum async task polling attempts.').volatile(),
  persona: z.union(['成片']).default('成片').description('成片 persona：导演角度分析，积极调用知识库与 skill。').volatile(),
  initiative: z.union(['严格', '自动', '协同']).default('协同').description('严格：多确认、不生成、二到四个提示词。自动：预算内直接执行生成。协同：提示词和占位，用户审阅后执行生成。').volatile(),
  vision: capability(VISION_MODES, 'deepseek-chat', 'https://api.deepseek.com', 'deepseek-v4-flash-vision-exp'),
  image: capability(IMAGE_MODES, 'openai-images', 'https://api.modelverse.cn/v1', 'gpt-image-2'),
  video: capability(VIDEO_MODES, 'modelverse-tasks', 'https://api.modelverse.cn/v1', 'doubao-seedance-2-0-260128', '2K'),
  audio: capability(AUDIO_MODES, 'openai-tts', 'https://api.modelverse.cn/v1', 'qwen3-tts-flash'),
})

/** Per-mode credential bag, live: every leaf is a volatile settings reference. */
export interface ModeAuthConfig {
  klingAk: Volatile<string>
  klingSk: Volatile<string>
  runwayVersion: Volatile<string>
}

/** One capability's live settings; mirrors {@link CapabilitySettings} field for field. */
export interface CapabilityConfig {
  enabled: Volatile<boolean>
  mode: Volatile<CapabilityMode>
  baseURL: Volatile<string>
  apiKey: Volatile<string>
  model: Volatile<string>
  resolution: Volatile<string>
  auth: ModeAuthConfig
}

/**
 * Config injected into `apply` by the Loader for the `directorx` entry. Fields
 * are volatile references, so a settings edit commits in place: read through
 * `.get()` and the same object always yields the current values.
 */
export interface DirectorxConfig {
  outputDir: Volatile<string>
  timeoutMs: Volatile<number>
  pollIntervalMs: Volatile<number>
  maxPollAttempts: Volatile<number>
  persona: Volatile<'成片'>
  initiative: Volatile<InitiativeMode>
  vision: CapabilityConfig
  image: CapabilityConfig
  video: CapabilityConfig
  audio: CapabilityConfig
}

/** Detach a live config into the plain snapshot the tools and providers consume. */
export function configSnapshot(config: DirectorxConfig): DirectorxSettings {
  const cap = (source: CapabilityConfig): CapabilitySettings => ({
    enabled: source.enabled.get(),
    mode: source.mode.get(),
    baseURL: source.baseURL.get(),
    apiKey: source.apiKey.get(),
    model: source.model.get(),
    resolution: source.resolution.get(),
    auth: {
      klingAk: source.auth.klingAk.get(),
      klingSk: source.auth.klingSk.get(),
      runwayVersion: source.auth.runwayVersion.get(),
    },
  })
  return {
    outputDir: config.outputDir.get(),
    timeoutMs: config.timeoutMs.get(),
    pollIntervalMs: config.pollIntervalMs.get(),
    maxPollAttempts: config.maxPollAttempts.get(),
    persona: config.persona.get(),
    initiative: config.initiative.get(),
    vision: cap(config.vision),
    image: cap(config.image),
    video: cap(config.video),
    audio: cap(config.audio),
  }
}