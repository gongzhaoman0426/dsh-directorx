import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { DirectorxSettings, SETTINGS_NS, configSnapshot, type DirectorxConfig, type DirectorxSettings as DirectorxSettingsType } from './config.ts'
import { corpus } from './corpus.ts'
import { registerCanvasCraftRoute, registerCanvasIntentRoute, registerCanvasResetRoute, registerCanvasRestoreRoute, registerCanvasRoute, registerCanvasSnapshotsRoute, registerCharactersRoute, registerMediaEditsRoute, registerMediaListRoute, registerMediaRoute, registerMediaTasksRoute, registerProjectsRoute, registerProposalsRoute, registerProposalUpdateRoute, registerStudioRoute, registerVendorRoute } from './media-server.ts'
import { registerCanvasGenerateRoute } from './canvas-job.ts'
import { registerBundledSkills } from './skills.ts'
import { registerSettingsTestRoute } from './settings-test.ts'
import { registerMcpRoute } from './mcp.ts'
import { registerDirectorxCommands } from './commands.ts'
import { registerSubagentSetup } from './subagents.ts'
import { registerSystemPrompt, syncTools } from './tools.ts'
import { registerStageRoutes } from './stage-server.ts'
import { registerEditRoutes } from './edit-server.ts'

import { registerAdaptersRoute } from './adapters-route.ts'
import type { AdapterCapability } from './providers/adapter-spec.ts'
import type { CapabilitySettings } from './config.ts'

export { corpus, knowledgeProviders, registerKnowledgeProvider } from './corpus.ts'
export type { KnowledgeArticle, KnowledgeProvider, KnowledgeSearchHit, KnowledgeSearchOptions } from './corpus.ts'
export { runAudio, mockAudio } from './providers/audio.ts'
export { runImage, mockImage } from './providers/image.ts'
export { runVideo, mockVideo } from './providers/video.ts'
export { runVision, mockVision } from './providers/vision.ts'

export const name = 'directorx'
export const inject = ['tools', 'skills', 'systemPrompt', 'settings', 'llm']

/** 0.2.x settings are config-derived: the editable fields are the volatile ones in this schema. */
export const Config = DirectorxSettings

export function apply(ctx: Context, config: DirectorxConfig): void {
  corpus.setRoot(fileURLToPath(new URL('../knowledge/', import.meta.url)))

  // The DSH runtime's context carries the event bus and the owning fiber; the
  // published cordis type surface does not describe them here, so read them
  // structurally the same way this file already reaches `llm`.
  const host = ctx as Context & {
    fiber?: { entry?: { options?: { id?: string } } }
    on(name: string, listener: (...args: never[]) => unknown): () => boolean
    logger?: { warn?(format: unknown, ...rest: unknown[]): void }
  }

  // Nothing is registered with the settings service any more: it projects a form
  // from this entry's own volatile Config. `read()` detaches the live references
  // into the plain snapshot every tool and provider already consumes, so the
  // rest of the plugin keeps reading an immutable `DirectorxSettings`.
  const read = (): DirectorxSettingsType => configSnapshot(config)

  // The schema validates shape at write time, but this rule spans four fields,
  // so it is reported instead of refusing to activate the whole plugin.
  const warnUnconfigured = (value: DirectorxSettingsType): void => {
    for (const [capability, settings] of Object.entries({ vision: value.vision, image: value.image, video: value.video, audio: value.audio })) {
      if (settings.enabled && settings.mode !== 'mock' && settings.baseURL.trim() === '') {
        host.logger?.warn?.('directorx: %s is enabled with an empty Base URL; choose mock mode or set one.', capability)
      }
    }
  }

  // Writes go through the settings service, keyed by this entry's id — the same
  // namespace the WebUI cards mutate. `SETTINGS_NS` is the bundle's shipped id.
  const settingsFace = ctx.get('settings') as {
    update(ns: string, patch: object, expectedRevision?: number): Promise<void>
  } | undefined
  const settingsNamespace = host.fiber?.entry?.options?.id ?? SETTINGS_NS

  // Host serves every registered settings namespace (`settings.describe`).
  // Also register the four capability profiles as configurable providers so
  // the Models page can address the same `directorx` namespace.
  const llm = ctx.get('llm') as {
    registerConfigurableProviders(entries: Array<{
      provider: string
      displayName: string
      settingsNs: string
      settingsPath: readonly string[]
      declared?: boolean
    }>): unknown
  }
  llm.registerConfigurableProviders([
    { provider: 'directorx-vision', displayName: 'DirectorX Vision', settingsNs: SETTINGS_NS, settingsPath: ['vision'], declared: true },
    { provider: 'directorx-image', displayName: 'DirectorX Image', settingsNs: SETTINGS_NS, settingsPath: ['image'], declared: true },
    { provider: 'directorx-video', displayName: 'DirectorX Video', settingsNs: SETTINGS_NS, settingsPath: ['video'], declared: true },
    { provider: 'directorx-audio', displayName: 'DirectorX Audio', settingsNs: SETTINGS_NS, settingsPath: ['audio'], declared: true },
  ])

  let disposeTools: (() => void) | undefined
  let disposePrompt: (() => void) | undefined

  const applyCapability = async (capability: AdapterCapability, patch: Partial<CapabilitySettings>): Promise<void> => {
    if (settingsFace === undefined) throw new Error('directorx: the settings service is unavailable, so provider configuration cannot be persisted.')
    const prev = read()[capability]
    await settingsFace.update(settingsNamespace, {
      [capability]: {
        ...prev,
        ...patch,
        auth: { ...prev.auth, ...(patch.auth ?? {}) },
      },
    })
  }

  const sync = (settings: DirectorxSettingsType): void => {
    disposeTools?.()
    disposePrompt?.()
    disposeTools = syncTools(ctx, settings, applyCapability, defineTool)
    disposePrompt = registerSystemPrompt(ctx, settings)
  }

  // Volatile edits commit into the running fiber and are dispatched here, so a
  // settings write re-registers the tools without remounting the plugin.
  const refresh = (): void => {
    const settings = read()
    warnUnconfigured(settings)
    sync(settings)
  }

  refresh()
  ctx.effect(() => registerStageRoutes(ctx, () => read()), 'directorx director stage route')
  ctx.effect(() => registerEditRoutes(ctx), 'directorx edit stage route')
  ctx.effect(() => host.on('loader/volatile-update', refresh), 'directorx settings watch')
  ctx.effect(() => registerMediaRoute(ctx, () => read().outputDir), 'directorx media route')
  ctx.effect(() => registerMediaEditsRoute(ctx, () => read().outputDir), 'directorx media edits route')
  ctx.effect(() => registerMediaTasksRoute(ctx, () => read().outputDir), 'directorx media tasks route')
  ctx.effect(() => registerMediaListRoute(ctx, () => read().outputDir), 'directorx media list route')
  ctx.effect(() => registerProjectsRoute(ctx), 'directorx projects route')
  ctx.effect(() => registerCanvasRoute(ctx, () => read().outputDir), 'directorx canvas route')
  ctx.effect(() => registerCanvasResetRoute(ctx, () => read().outputDir), 'directorx canvas reset route')
  ctx.effect(() => registerCanvasSnapshotsRoute(ctx, () => read().outputDir), 'directorx canvas snapshots route')
  ctx.effect(() => registerCanvasRestoreRoute(ctx, () => read().outputDir), 'directorx canvas restore route')
  ctx.effect(() => registerCanvasIntentRoute(ctx, () => read().outputDir), 'directorx canvas intent route')
  ctx.effect(() => registerCanvasCraftRoute(ctx, () => read().outputDir), 'directorx canvas craft route')
  ctx.effect(() => registerCanvasGenerateRoute(ctx, () => read()), 'directorx canvas generate route')
  ctx.effect(() => registerCharactersRoute(ctx, () => read().outputDir), 'directorx characters route')
  ctx.effect(() => registerStudioRoute(ctx, () => read().outputDir), 'directorx studio route')
  ctx.effect(() => registerVendorRoute(ctx), 'directorx vendor assets route')
  ctx.effect(() => registerProposalsRoute(ctx, () => read().outputDir), 'directorx proposals route')
  ctx.effect(() => registerProposalUpdateRoute(ctx, () => read().outputDir), 'directorx proposal update route')
  ctx.effect(() => registerSettingsTestRoute(ctx, () => read()), 'directorx settings test route')
  ctx.effect(() => registerAdaptersRoute(ctx, () => read().outputDir), 'directorx adapters route')
  ctx.effect(() => registerMcpRoute(ctx, () => read()), 'directorx mcp route')
  ctx.effect(() => registerSubagentSetup(ctx), 'directorx subagent setup')
  ctx.effect(() => registerDirectorxCommands(ctx, () => read().outputDir), 'directorx commands')

  // System prompt and child-agent guidance are installed through DSH's native seams.
  // registerSubagentSetup consumes the same runtime preset as registerSystemPrompt;
  // this keeps the host's agent loop authoritative and avoids a second orchestrator.
  void registerBundledSkills(ctx).catch(error => {
    ctx.logger?.error('directorx: failed to register bundled skills: %s', error instanceof Error ? error.message : String(error))
  })
}