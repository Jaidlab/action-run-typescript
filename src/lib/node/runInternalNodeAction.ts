import type {ActionRuntimeBindings} from '../ActionRuntimeBindings.ts'

import {webcrypto} from 'node:crypto'
import {existsSync, readFileSync, statSync} from 'node:fs'
import * as nodeModule from 'node:module'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import vm from 'node:vm'

import {createContextModuleContent} from '../context/createContextModuleContent.ts'
import {createScriptModuleContent} from '../context/createScriptModuleContent.ts'
import {parseJsonString} from '../parseJsonString.ts'
import {ACTION_RUN_TYPESCRIPT_INTERNAL_BINDINGS,
  ACTION_RUN_TYPESCRIPT_INTERNAL_CODE,
  ACTION_RUN_TYPESCRIPT_INTERNAL_MODE,
  internalEnvironmentNames} from './internalEnvironment.ts'

const {createRequire, isBuiltin} = nodeModule
const supportedLocalExtensions = ['.ts', '.mts', '.cts', '.js', '.mjs', '.json'] as const
const supportedLocalExtensionList = supportedLocalExtensions.join(', ')
const unsupportedJsxExtensions = new Set(['.tsx', '.jsx'])
const contextModuleIdentifier = 'action-run-typescript:context'

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
const createExecutionContext = () => {
  const sandbox = Object.create(null)
  for (const key of Reflect.ownKeys(globalThis)) {
    if (key === 'crypto' || key === 'global' || key === 'globalThis' || key === 'self') {
      continue
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(globalThis, key)
    if (descriptor) {
      Reflect.defineProperty(sandbox, key, descriptor)
    }
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
    value: globalThis.crypto ?? webcrypto,
    writable: true,
  })
  return vm.createContext(sandbox)
}
const getRequiredEnvironmentValue = (environment: MutableEnvironment, name: string) => {
  const value = environment[name]
  if (value === undefined) {
    throw new Error(`Missing internal environment variable ${name}.`)
  }
  return value
}
const stripInternalEnvironmentValues = (environment: MutableEnvironment) => {
  for (const name of internalEnvironmentNames) {
    delete environment[name]
  }
}
const toFileIdentifierLabel = (identifier: string) => (identifier.startsWith('file:') ? fileURLToPath(identifier) : identifier)

const transformTypeScriptSource = (source: string, label: string) => {
  try {
    return getStripTypeScriptTypes()(source, {mode: 'transform'})
  } catch (error) {
    throw createModuleSourceError('transform', error, source, label)
  }
}
class NodeInlineModuleRuntime {
  readonly bindings: ActionRuntimeBindings

  readonly context = createExecutionContext()

  readonly linkModule = async (specifier: string, referencingModule?: ModuleInstance) => {
    if (specifier === contextModuleIdentifier) {
      return this.getContextModule()
    }
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

  constructor(bindings: ActionRuntimeBindings,
    workspace: string) {
    this.bindings = bindings
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
      source: createScriptModuleContent(contextModuleIdentifier, code),
      transformTypeScript: true,
    }))
    await this.ensureLinked(rootModule)
    await this.ensureEvaluated(rootModule)
  }

  async getContextModule() {
    return this.getOrCreateModule(contextModuleIdentifier, () => this.createTextModule({
      identifier: contextModuleIdentifier,
      label: 'injected context module',
      source: createContextModuleContent(this.bindings),
      transformTypeScript: true,
    }))
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
    const createdModule = Promise.resolve(createModule())
      .then(module => {
        this.moduleCache.set(identifier, module)
        return module
      })
      .finally(() => {
        this.pendingModuleCache.delete(identifier)
      })
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
  const code = getRequiredEnvironmentValue(environment, ACTION_RUN_TYPESCRIPT_INTERNAL_CODE)
  const bindings = parseJsonString<ActionRuntimeBindings>(getRequiredEnvironmentValue(environment, ACTION_RUN_TYPESCRIPT_INTERNAL_BINDINGS), ACTION_RUN_TYPESCRIPT_INTERNAL_BINDINGS)
  if (bindings === undefined) {
    throw new Error(`Missing internal environment variable ${ACTION_RUN_TYPESCRIPT_INTERNAL_BINDINGS}.`)
  }
  stripInternalEnvironmentValues(process.env as MutableEnvironment)
  if (environment !== process.env) {
    stripInternalEnvironmentValues(environment)
  }
  const runtime = new NodeInlineModuleRuntime(bindings, process.cwd())
  await runtime.evaluate(code)
}
