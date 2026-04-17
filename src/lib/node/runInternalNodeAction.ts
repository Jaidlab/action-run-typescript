import type {ActionRuntimeBindings} from '../ActionRuntimeBindings.ts'
import type {WorkflowJob} from '../github/getCurrentWorkflowJob.ts'
import type {InputOptions} from '@actions/core'

import {existsSync, readFileSync, statSync} from 'node:fs'
import * as nodeModule from 'node:module'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import vm from 'node:vm'

import * as actionCore from '@actions/core'
import * as actionGithub from '@actions/github'
import json5 from 'json5'

import {createCore} from '../context/createCore.ts'
import {actionInputNames,
  deprecatedContextEnvironmentNames,
  getEnvironmentValue,
  legacyActionRuntimeInputEnvironmentNames,
  normalizeEnvironmentValue,
  toInputEnvironmentName} from '../environment.ts'
import {getCurrentWorkflowJob} from '../github/getCurrentWorkflowJob.ts'
import {toActionRuntimeGitHubContext} from '../github/toActionRuntimeGitHubContext.ts'
import {toWorkflowStepsFallback} from '../github/toWorkflowStepsFallback.ts'
import {ACTION_RUN_TYPESCRIPT_INTERNAL_MODE,
  internalEnvironmentNames} from './internalEnvironment.ts'

const {createRequire, isBuiltin} = nodeModule
const supportedLocalExtensions = ['.ts', '.mts', '.cts', '.js', '.mjs', '.json'] as const
const supportedLocalExtensionList = supportedLocalExtensions.join(', ')
const unsupportedJsxExtensions = new Set(['.tsx', '.jsx'])

type GlobalRecord = Record<PropertyKey, unknown>
type ModuleInstance = vm.SourceTextModule | vm.SyntheticModule
type MutableEnvironment = Record<string, string | undefined>

type StripTypeScriptTypesImplementation = (source: string, options?: {mode?: 'strip' | 'transform'}) => string

const getStripTypeScriptTypes = () => {
  const implementation = (nodeModule as typeof nodeModule & {stripTypeScriptTypes?: StripTypeScriptTypesImplementation}).stripTypeScriptTypes
  if (typeof implementation !== 'function') {
    throw new TypeError('node:module.stripTypeScriptTypes is unavailable in this Node runtime.')
  }
  return implementation
}
const isDirectory = (filePath: string) => {
  try {
    return statSync(filePath).isDirectory()
  } catch {
    return false
  }
}
const isFile = (filePath: string) => {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}
const isProbablyJsxFailure = (error: unknown, source: string, label: string) => {
  const normalizedLabel = label.toLowerCase()
  if (normalizedLabel.endsWith('.tsx') || normalizedLabel.endsWith('.jsx')) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("Unexpected token '<'") || message.includes('JSX') || source.includes('</') && message.includes('Unexpected token')
}
const isLocalFileSpecifier = (specifier: string) => specifier.startsWith('./')
  || specifier.startsWith('../')
  || specifier.startsWith('file:')
  || path.isAbsolute(specifier)
const createJsxUnsupportedError = (label: string) => new Error(`TSX/JSX syntax is not supported by action-run-typescript runtime (${label}).`)
const createModuleSourceError = (phase: 'compile' | 'transform', error: unknown, source: string, label: string) => {
  if (isProbablyJsxFailure(error, source, label)) {
    return createJsxUnsupportedError(label)
  }
  return new Error(`Failed to ${phase} module ${label}.`, {cause: error})
}
const defineGlobalValue = (target: object, name: PropertyKey, value: unknown) => {
  Reflect.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}
const createGlobalValuesRecord = (...sources: ReadonlyArray<Record<string, unknown>>) => {
  const record = Object.create(null) as Record<string, unknown>
  for (const source of sources) {
    for (const [name, value] of Object.entries(source)) {
      defineGlobalValue(record, name, value)
    }
  }
  return record
}
const createExecutionContext = (globalValues: Record<string, unknown>) => {
  const sandbox = Object.create(null) as GlobalRecord
  for (const key of Reflect.ownKeys(globalThis)) {
    if (key === 'crypto' || key === 'global' || key === 'globalThis' || key === 'self') {
      continue
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(globalThis, key)
    if (descriptor) {
      Reflect.defineProperty(sandbox, key, descriptor)
    }
  }
  for (const [name, value] of Object.entries(globalValues)) {
    defineGlobalValue(sandbox, name, value)
  }
  Reflect.defineProperty(sandbox, 'global', {
    configurable: true,
    enumerable: false,
    value: sandbox,
    writable: true,
  })
  Reflect.defineProperty(sandbox, 'globalThis', {
    configurable: true,
    enumerable: false,
    value: sandbox,
    writable: true,
  })
  Reflect.defineProperty(sandbox, 'self', {
    configurable: true,
    enumerable: false,
    value: sandbox,
    writable: true,
  })
  Reflect.defineProperty(sandbox, 'crypto', {
    configurable: true,
    enumerable: false,
    value: globalThis.crypto,
    writable: true,
  })
  return vm.createContext(sandbox)
}
const getActionInput = (name: string, options?: InputOptions) => normalizeEnvironmentValue(actionCore.getInput(name, options))
const getCode = (environment: MutableEnvironment) => {
  const code = getActionInput('code', {trimWhitespace: false}) ?? getEnvironmentValue(environment, 'ACTION_RUN_TYPESCRIPT_CODE')
  if (code === undefined) {
    throw new Error('Missing action input "code".')
  }
  return code
}
const getGitHubToken = (environment: MutableEnvironment) => getActionInput('github-token', {trimWhitespace: false})
  ?? getEnvironmentValue(environment, 'ACTION_RUN_TYPESCRIPT_GITHUB_TOKEN', 'GITHUB_TOKEN')
const parseGlobals = (environment: MutableEnvironment) => {
  const rawGlobals = getActionInput('globals', {trimWhitespace: false}) ?? getEnvironmentValue(environment, 'ACTION_RUN_TYPESCRIPT_GLOBALS')
  if (rawGlobals === undefined || rawGlobals.trim() === '') {
    return {}
  }
  let parsed: unknown
  try {
    parsed = json5.parse(rawGlobals)
  } catch (error) {
    throw new Error('Failed to parse action input "globals".', {cause: error})
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Action input "globals" must evaluate to an object.')
  }
  return parsed as Record<string, unknown>
}
const setGitHubTokenEnvironmentValue = (environment: MutableEnvironment, token?: string) => {
  if (!token) {
    return
  }
  if (!environment.GITHUB_TOKEN) {
    environment.GITHUB_TOKEN = token
  }
  if (!process.env.GITHUB_TOKEN) {
    process.env.GITHUB_TOKEN = token
  }
}
const stripRuntimeEnvironmentValues = (environment: MutableEnvironment) => {
  for (const name of [
    ...internalEnvironmentNames,
    ...deprecatedContextEnvironmentNames,
    ...legacyActionRuntimeInputEnvironmentNames,
    ...actionInputNames.map(toInputEnvironmentName),
  ]) {
    delete environment[name]
  }
}
const toJobContext = (githubJobId: string | undefined, workflowJob?: WorkflowJob) => {
  const job: Record<string, unknown> = {}
  if (githubJobId) {
    job.id = githubJobId
  }
  if (!workflowJob) {
    return job
  }
  if (workflowJob.id !== undefined) {
    job.workflow_job_id = workflowJob.id
    job.workflowJobId = workflowJob.id
  }
  if (workflowJob.name !== undefined) {
    job.name = workflowJob.name
  }
  if (workflowJob.status !== undefined) {
    job.status = workflowJob.status
  }
  if (workflowJob.conclusion !== undefined) {
    job.conclusion = workflowJob.conclusion
  }
  const url = workflowJob.html_url ?? workflowJob.url
  if (url !== undefined) {
    job.url = url
  }
  return job
}
const resolveRunnerOperatingSystem = () => {
  const platform = actionCore.platform
  if (platform.isWindows) {
    return 'Windows'
  }
  if (platform.isMacOS) {
    return 'macOS'
  }
  if (platform.isLinux) {
    return 'Linux'
  }
  return platform.platform
}
const toRunnerContext = (environment: MutableEnvironment) => ({
  arch: getEnvironmentValue(environment, 'RUNNER_ARCH') ?? actionCore.platform.arch,
  debug: actionCore.isDebug(),
  name: getEnvironmentValue(environment, 'RUNNER_NAME'),
  os: getEnvironmentValue(environment, 'RUNNER_OS') ?? resolveRunnerOperatingSystem(),
  temp: getEnvironmentValue(environment, 'RUNNER_TEMP'),
  tool_cache: getEnvironmentValue(environment, 'RUNNER_TOOL_CACHE'),
})
const getBindings = async (environment: MutableEnvironment, token?: string): Promise<ActionRuntimeBindings> => {
  const github = toActionRuntimeGitHubContext(actionGithub.context, token)
  const workflowJob = await getCurrentWorkflowJob({
    github,
    runnerName: getEnvironmentValue(environment, 'RUNNER_NAME'),
    token,
  })
  return {
    core: createCore(),
    github,
    job: toJobContext(actionGithub.context.job, workflowJob),
    matrix: {},
    runner: toRunnerContext(environment),
    steps: workflowJob ? toWorkflowStepsFallback(workflowJob) : {},
    strategy: {},
    workflowJob: workflowJob ?? null,
  }
}
const toFileIdentifierLabel = (identifier: string) => {
  if (identifier.startsWith('file:')) {
    return fileURLToPath(identifier)
  }
  return identifier
}
const transformTypeScriptSource = (source: string, label: string) => {
  try {
    return getStripTypeScriptTypes()(source, {mode: 'transform'})
  } catch (error) {
    throw createModuleSourceError('transform', error, source, label)
  }
}
class NodeInlineModuleRuntime {
  readonly context: vm.Context

  readonly linkModule = async (specifier: string, referencingModule?: ModuleInstance) => {
    const parentIdentifier = referencingModule?.identifier || this.rootModuleIdentifier
    if (isLocalFileSpecifier(specifier)) {
      return this.loadLocalModule(specifier, parentIdentifier)
    }
    return this.loadExternalModule(specifier, parentIdentifier)
  }

  readonly moduleCache = new Map<string, ModuleInstance>

  readonly pendingModuleCache = new Map<string, Promise<ModuleInstance>>

  readonly rootModuleIdentifier: string

  readonly workspace: string

  constructor(globalValues: Record<string, unknown>, workspace: string) {
    this.context = createExecutionContext(globalValues)
    const normalizedWorkspace = path.resolve(workspace)
    this.rootModuleIdentifier = pathToFileURL(path.join(normalizedWorkspace, '__action_run_typescript_inline__.ts')).href
    this.workspace = normalizedWorkspace
  }

  createJsonModule(identifier: string) {
    const filePath = fileURLToPath(identifier)
    const rawJson = readFileSync(filePath, 'utf8')
    let value: unknown
    try {
      value = JSON.parse(rawJson)
    } catch (error) {
      throw new Error(`Failed to parse JSON module ${filePath}.`, {cause: error})
    }
    const module = new vm.SyntheticModule(['default'], () => {
      module.setExport('default', value)
    }, {
      context: this.context,
      identifier,
    })
    return module
  }

  createTextModule({identifier, label, source, transformTypeScript}: {identifier: string
    label: string
    source: string
    transformTypeScript: boolean}) {
    const compiledSource = transformTypeScript ? transformTypeScriptSource(source, label) : source
    try {
      return new vm.SourceTextModule(compiledSource, {
        context: this.context,
        identifier,
        importModuleDynamically: ((specifier: string, referencingModule: ModuleInstance) => this.importModuleDynamically(specifier, referencingModule)) as never,
        initializeImportMeta: importMeta => {
          importMeta.url = identifier
          if (identifier.startsWith('file:')) {
            const filename = fileURLToPath(identifier)
            importMeta.dirname = path.dirname(filename)
            importMeta.filename = filename
          }
        },
      })
    } catch (error) {
      throw createModuleSourceError('compile', error, compiledSource, label)
    }
  }

  async ensureEvaluated(module: ModuleInstance) {
    if (module.status === 'unlinked') {
      await this.ensureLinked(module)
    }
    if (module.status === 'linked') {
      await module.evaluate()
    }
  }

  async ensureLinked(module: ModuleInstance) {
    if (module.status === 'unlinked') {
      await module.link(this.linkModule as never)
    }
  }

  async evaluate(code: string) {
    const rootModule = await this.getOrCreateModule(this.rootModuleIdentifier, () => this.createTextModule({
      identifier: this.rootModuleIdentifier,
      label: 'inline TypeScript',
      source: code,
      transformTypeScript: true,
    }))
    await this.ensureLinked(rootModule)
    await this.ensureEvaluated(rootModule)
  }

  async getOrCreateModule(identifier: string, createModule: () => ModuleInstance | Promise<ModuleInstance>) {
    const cachedModule = this.moduleCache.get(identifier)
    if (cachedModule) {
      return cachedModule
    }
    const pendingModule = this.pendingModuleCache.get(identifier)
    if (pendingModule) {
      return pendingModule
    }
    const createdModule = (async () => {
      try {
        const module = await createModule()
        this.moduleCache.set(identifier, module)
        return module
      } finally {
        this.pendingModuleCache.delete(identifier)
      }
    })()
    this.pendingModuleCache.set(identifier, createdModule)
    return createdModule
  }

  async importModuleDynamically(specifier: string, referencingModule?: ModuleInstance) {
    const linkedModule = await this.linkModule(specifier, referencingModule)
    await this.ensureLinked(linkedModule)
    await this.ensureEvaluated(linkedModule)
    return linkedModule
  }

  async loadExternalModule(specifier: string, parentIdentifier: string) {
    const resolvedSpecifier = this.resolveExternalModuleSpecifier(specifier, parentIdentifier)
    return this.getOrCreateModule(`external:${resolvedSpecifier}`, async () => {
      const namespace = await import(resolvedSpecifier) as Record<string, unknown>
      const exportNames = Object.getOwnPropertyNames(namespace)
      const module = new vm.SyntheticModule(exportNames, () => {
        for (const exportName of exportNames) {
          module.setExport(exportName, namespace[exportName])
        }
      }, {
        context: this.context,
        identifier: resolvedSpecifier,
      })
      return module
    })
  }

  async loadLocalModule(specifier: string, parentIdentifier: string) {
    const resolvedPath = this.resolveLocalModulePath(specifier, parentIdentifier)
    const identifier = pathToFileURL(resolvedPath).href
    return this.getOrCreateModule(identifier, () => {
      const extension = path.extname(resolvedPath).toLowerCase()
      if (extension === '.json') {
        return this.createJsonModule(identifier)
      }
      if (unsupportedJsxExtensions.has(extension)) {
        throw createJsxUnsupportedError(resolvedPath)
      }
      const source = readFileSync(resolvedPath, 'utf8')
      return this.createTextModule({
        identifier,
        label: resolvedPath,
        source,
        transformTypeScript: extension === '.ts' || extension === '.mts' || extension === '.cts',
      })
    })
  }

  resolveDirectoryIndexPath(directoryPath: string, specifier: string, parentIdentifier: string) {
    for (const extension of supportedLocalExtensions) {
      const indexFilePath = path.join(directoryPath, `index${extension}`)
      if (isFile(indexFilePath)) {
        return path.resolve(indexFilePath)
      }
    }
    for (const extension of unsupportedJsxExtensions) {
      const jsxIndexFilePath = path.join(directoryPath, `index${extension}`)
      if (isFile(jsxIndexFilePath)) {
        throw createJsxUnsupportedError(jsxIndexFilePath)
      }
    }
    throw new Error(`Cannot resolve local module ${JSON.stringify(specifier)} from ${toFileIdentifierLabel(parentIdentifier)}. Supported extensions: ${supportedLocalExtensionList}.`)
  }

  resolveExternalModuleSpecifier(specifier: string, parentIdentifier: string) {
    if (specifier.startsWith('node:')) {
      return specifier
    }
    if (isBuiltin(specifier)) {
      return `node:${specifier}`
    }
    const requireParentPath = parentIdentifier.startsWith('file:') ? fileURLToPath(parentIdentifier) : path.join(this.workspace, '__action_run_typescript_require__.mjs')
    try {
      const resolvedSpecifier = createRequire(requireParentPath).resolve(specifier)
      return resolvedSpecifier.startsWith('node:') ? resolvedSpecifier : pathToFileURL(resolvedSpecifier).href
    } catch (error) {
      throw new Error(`Cannot resolve package import ${JSON.stringify(specifier)} from ${toFileIdentifierLabel(parentIdentifier)}.`, {cause: error})
    }
  }

  resolveLocalModulePath(specifier: string, parentIdentifier: string) {
    const parentDirectory = parentIdentifier.startsWith('file:') ? path.dirname(fileURLToPath(parentIdentifier)) : this.workspace
    const candidatePath = specifier.startsWith('file:') ? fileURLToPath(specifier) : path.resolve(parentDirectory, specifier)
    const explicitExtension = path.extname(candidatePath).toLowerCase()
    if (unsupportedJsxExtensions.has(explicitExtension)) {
      throw createJsxUnsupportedError(candidatePath)
    }
    if (explicitExtension) {
      if (isFile(candidatePath)) {
        return path.resolve(candidatePath)
      }
      if (isDirectory(candidatePath)) {
        return this.resolveDirectoryIndexPath(candidatePath, specifier, parentIdentifier)
      }
      throw new Error(`Cannot resolve local module ${JSON.stringify(specifier)} from ${toFileIdentifierLabel(parentIdentifier)}.`)
    }
    for (const extension of supportedLocalExtensions) {
      const resolvedFilePath = `${candidatePath}${extension}`
      if (isFile(resolvedFilePath)) {
        return path.resolve(resolvedFilePath)
      }
    }
    for (const extension of unsupportedJsxExtensions) {
      const jsxFilePath = `${candidatePath}${extension}`
      if (existsSync(jsxFilePath)) {
        throw createJsxUnsupportedError(jsxFilePath)
      }
    }
    if (isDirectory(candidatePath)) {
      return this.resolveDirectoryIndexPath(candidatePath, specifier, parentIdentifier)
    }
    throw new Error(`Cannot resolve local module ${JSON.stringify(specifier)} from ${toFileIdentifierLabel(parentIdentifier)}. Supported extensions: ${supportedLocalExtensionList}.`)
  }
}

export const isInternalNodeActionEnvironment = (environment: Record<string, string | undefined>) => environment[ACTION_RUN_TYPESCRIPT_INTERNAL_MODE] === '1'

export const runInternalNodeAction = async (environment = process.env as MutableEnvironment) => {
  const code = getCode(environment)
  const globals = parseGlobals(environment)
  const token = getGitHubToken(environment)
  setGitHubTokenEnvironmentValue(environment, token)
  const bindings = await getBindings(environment, token)
  stripRuntimeEnvironmentValues(process.env as MutableEnvironment)
  if (environment !== process.env) {
    stripRuntimeEnvironmentValues(environment)
  }
  const globalValues = createGlobalValuesRecord({...bindings}, globals)
  const runtime = new NodeInlineModuleRuntime(globalValues, process.cwd())
  await runtime.evaluate(code)
}
