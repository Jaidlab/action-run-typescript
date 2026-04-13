import type {ContextModuleBindings} from '../context/createContextModuleContent.ts'

import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import vm from 'node:vm'

import {createContextModuleContent} from '../context/createContextModuleContent.ts'
import {createScriptModuleContent} from '../context/createScriptModuleContent.ts'
import {normalizeExitCode, ProcessExitError} from './ProcessExitError.ts'

export interface VmModuleRunnerOptions {
  readonly bindings: ContextModuleBindings
  readonly code: string
  readonly environment: Record<string, string | undefined>
  readonly workspace: string
}

const isResolvedModuleIdentifier = (value: string) => /^(node:|bun:|file:|data:|https?:)/.test(value)
const toExecutionEnvironment = (environment: Record<string, string | undefined>) => {
  const executionEnvironment: Record<string, string> = {}
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined) {
      executionEnvironment[name] = value
    }
  }
  return executionEnvironment
}

export class VmModuleRunner {
  readonly contextIdentifier = 'action-run-typescript:context'
  contextModulePromise?: Promise<vm.SourceTextModule>
  readonly contextTranspiler = new Bun.Transpiler({loader: 'ts'})
  readonly entryIdentifier: string
  entryModulePromise?: Promise<vm.SourceTextModule>
  readonly executionEnvironment: Record<string, string>
  readonly hostModuleCache = new Map<string, Promise<vm.Module>>
  readonly importModuleDynamically = async (specifier: string, referencingModule: vm.Module) => {
    const identifier = this.resolveModuleIdentifier(specifier, referencingModule.identifier)
    if (identifier === this.contextIdentifier) {
      const contextModule = await this.getContextModule()
      await contextModule.evaluate()
      return contextModule.namespace
    }
    return this.importHostModuleNamespace(identifier)
  }

  readonly linkModule = async (specifier: string, referencingModule: vm.Module) => {
    const identifier = this.resolveModuleIdentifier(specifier, referencingModule.identifier)
    if (identifier === this.contextIdentifier) {
      return this.getContextModule()
    }
    return this.createHostModule(identifier)
  }
  runtimeExitCode = process.exitCode
  readonly runtimeProcess: NodeJS.Process

  readonly scriptTranspiler = new Bun.Transpiler({loader: 'tsx'})

  readonly vmContext: vm.Context

  constructor(readonly options: VmModuleRunnerOptions) {
    this.entryIdentifier = pathToFileURL(path.join(options.workspace, '.action-run-typescript-script.tsx')).href
    this.executionEnvironment = toExecutionEnvironment(options.environment)
    this.runtimeProcess = this.createRuntimeProcess()
    this.vmContext = this.createVmContext()
  }

  applyEnvironment(environment: Record<string, string | undefined>) {
    for (const name of Object.keys(process.env)) {
      if (!Object.hasOwn(environment, name) || environment[name] === undefined) {
        delete process.env[name]
      }
    }
    for (const [name, value] of Object.entries(environment)) {
      if (value !== undefined) {
        process.env[name] = value
      }
    }
  }

  async createContextModule() {
    const source = this.contextTranspiler.transformSync(createContextModuleContent(this.options.bindings))
    const module = this.createVmModule(this.contextIdentifier, source)
    await module.link(this.linkModule)
    return module
  }

  async createEntryModule() {
    const source = this.scriptTranspiler.transformSync(createScriptModuleContent(this.contextIdentifier, this.options.code))
    const module = this.createVmModule(this.entryIdentifier, source)
    await module.link(this.linkModule)
    return module
  }

  async createHostModule(identifier: string) {
    const cachedModule = this.hostModuleCache.get(identifier)
    if (cachedModule) {
      return cachedModule
    }
    const modulePromise = (async () => {
      const namespace = await this.importHostModuleNamespace(identifier)
      const exportNames = Object.getOwnPropertyNames(namespace)
      const module = new vm.SyntheticModule(exportNames, function () {
        for (const exportName of exportNames) {
          this.setExport(exportName, namespace[exportName])
        }
      }, {
        context: this.vmContext,
        identifier,
      })
      await module.link(() => {
        throw new Error(`Synthetic module ${identifier} unexpectedly requested imports.`)
      })
      await module.evaluate()
      return module
    })()
    this.hostModuleCache.set(identifier, modulePromise)
    return modulePromise
  }

  createProcessExitError(exitCode: unknown) {
    return new ProcessExitError(this.setExitCode(exitCode))
  }

  createRuntimeProcess() {
    return new Proxy(process, {
      get: (target, property) => {
        if (property === 'exit') {
          return (exitCode?: unknown) => {
            throw this.createProcessExitError(exitCode ?? this.getObservedExitCode())
          }
        }
        if (property === 'exitCode') {
          return this.runtimeExitCode
        }
        const value: unknown = Reflect.get(target, property, target)
        if (typeof value === 'function') {
          return Function.prototype.bind.call(value, target) as unknown
        }
        return value
      },
      set: (target, property, value) => {
        if (property === 'exitCode') {
          this.setExitCode(value)
          return true
        }
        return Reflect.set(target, property, value, target)
      },
    })
  }

  createVmContext() {
    const descriptors: Record<string, PropertyDescriptor> = {...Object.getOwnPropertyDescriptors(globalThis)}
    delete descriptors.globalThis
    delete descriptors.global
    delete descriptors.self
    delete descriptors.process
    const sandbox: Record<string, unknown> = {}
    Object.defineProperties(sandbox, descriptors)
    sandbox.globalThis = sandbox
    sandbox.global = sandbox
    sandbox.process = this.runtimeProcess
    sandbox.self = sandbox
    return vm.createContext(sandbox)
  }

  createVmModule(identifier: string, source: string) {
    return new vm.SourceTextModule(source, {
      context: this.vmContext,
      identifier,
      importModuleDynamically: this.importModuleDynamically,
      initializeImportMeta: (meta, module) => {
        meta.main = module.identifier === this.entryIdentifier
        meta.resolve = (specifier: string) => this.resolveModuleIdentifier(specifier, module.identifier)
        meta.url = module.identifier
      },
    })
  }

  getContextModule() {
    this.contextModulePromise ??= this.createContextModule()
    return this.contextModulePromise
  }

  getEntryModule() {
    this.entryModulePromise ??= this.createEntryModule()
    return this.entryModulePromise
  }

  getObservedExitCode() {
    const exitCode = this.runtimeExitCode ?? process.exitCode
    if (exitCode === undefined) {
      return 0
    }
    return normalizeExitCode(exitCode)
  }

  async importHostModuleNamespace(identifier: string) {
    return (await import(identifier)) as Record<string, unknown>
  }

  resolveModuleIdentifier(specifier: string, parentIdentifier: string) {
    if (specifier === this.contextIdentifier) {
      return this.contextIdentifier
    }
    if (isResolvedModuleIdentifier(specifier)) {
      return specifier
    }
    const baseDirectory = parentIdentifier.startsWith('file:') ? path.dirname(fileURLToPath(parentIdentifier)) : this.options.workspace
    const resolved = Bun.resolveSync(specifier, baseDirectory)
    if (isResolvedModuleIdentifier(resolved)) {
      return resolved
    }
    return pathToFileURL(resolved).href
  }

  restoreProcessExitCode(originalExitCode: typeof process.exitCode) {
    if (originalExitCode !== undefined) {
      process.exitCode = originalExitCode
      return
    }
    if (process.exitCode !== undefined) {
      process.exitCode = 0
    }
  }

  async run() {
    await this.withPatchedRuntime(async () => {
      try {
        const entryModule = await this.getEntryModule()
        await entryModule.evaluate()
        await (entryModule.namespace as {default: Promise<unknown>}).default
      } catch (error) {
        if (!(error instanceof ProcessExitError)) {
          throw error
        }
      }
      const exitCode = this.getObservedExitCode()
      if (exitCode !== 0) {
        throw new Error(`Inline TypeScript exited with code ${exitCode}.`)
      }
    })
  }

  setExitCode(exitCode: unknown) {
    const normalizedExitCode = normalizeExitCode(exitCode)
    this.runtimeExitCode = normalizedExitCode
    process.exitCode = normalizedExitCode
    return normalizedExitCode
  }

  async withPatchedRuntime<Value>(task: () => Promise<Value> | Value) {
    const originalCwd = process.cwd()
    const originalEnvironment = {...process.env}
    const originalProcessExit = process.exit.bind(process)
    const originalProcessExitCode: typeof process.exitCode = process.exitCode
    this.runtimeExitCode = originalProcessExitCode
    process.exit = ((exitCode?: unknown) => {
      throw this.createProcessExitError(exitCode ?? this.getObservedExitCode())
    }) as typeof process.exit
    try {
      this.applyEnvironment(this.executionEnvironment)
      process.chdir(this.options.workspace)
      return await task()
    } finally {
      process.chdir(originalCwd)
      process.exit = originalProcessExit
      this.restoreProcessExitCode(originalProcessExitCode)
      this.applyEnvironment(originalEnvironment)
    }
  }
}
