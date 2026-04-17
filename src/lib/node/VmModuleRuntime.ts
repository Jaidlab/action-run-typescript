import {createRequire, isBuiltin} from 'node:module'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import vm from 'node:vm'

export interface VmModuleRuntimeOptions {
  readonly code: string
  readonly globalValues: Record<string, unknown>
  readonly identifier: string
}

type GlobalRecord = Record<PropertyKey, unknown>
type ModuleInstance = vm.SourceTextModule | vm.SyntheticModule

const defineGlobalValue = (target: object, name: PropertyKey, value: unknown) => {
  Reflect.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
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

export class VmModuleRuntime {
  readonly code: string

  readonly context: vm.Context

  readonly identifier: string

  readonly moduleCache = new Map<string, ModuleInstance>

  constructor(options: VmModuleRuntimeOptions) {
    this.code = options.code
    this.context = createExecutionContext(options.globalValues)
    this.identifier = options.identifier
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
      await module.link((specifier, referencingModule) => this.linkModule(specifier, referencingModule) as never)
    }
  }

  async evaluate() {
    const rootModule = new vm.SourceTextModule(this.code, {
      context: this.context,
      identifier: this.identifier,
      importModuleDynamically: ((specifier: string, referencingModule: ModuleInstance) => this.importModuleDynamically(specifier, referencingModule)) as never,
      initializeImportMeta: importMeta => {
        importMeta.url = this.identifier
        if (this.identifier.startsWith('file:')) {
          const filename = fileURLToPath(this.identifier)
          importMeta.dirname = path.dirname(filename)
          importMeta.filename = filename
        }
      },
    })
    await this.ensureLinked(rootModule)
    await this.ensureEvaluated(rootModule)
  }

  async importModuleDynamically(specifier: string, referencingModule?: ModuleInstance) {
    const linkedModule = await this.linkModule(specifier, referencingModule)
    await this.ensureLinked(linkedModule)
    await this.ensureEvaluated(linkedModule)
    return linkedModule
  }

  async linkModule(specifier: string, referencingModule?: ModuleInstance) {
    const parentIdentifier = referencingModule?.identifier || this.identifier
    const resolvedSpecifier = this.resolveExternalModuleSpecifier(specifier, parentIdentifier)
    const cachedModule = this.moduleCache.get(resolvedSpecifier)
    if (cachedModule) {
      return cachedModule
    }
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
    this.moduleCache.set(resolvedSpecifier, module)
    return module
  }

  resolveExternalModuleSpecifier(specifier: string, parentIdentifier: string) {
    if (specifier.startsWith('node:')) {
      return specifier
    }
    if (isBuiltin(specifier)) {
      return `node:${specifier}`
    }
    const requireParentPath = parentIdentifier.startsWith('file:') ? fileURLToPath(parentIdentifier) : path.join(process.cwd(), '__action_run_typescript_require__.mjs')
    const resolvedSpecifier = createRequire(requireParentPath).resolve(specifier)
    return resolvedSpecifier.startsWith('node:') ? resolvedSpecifier : pathToFileURL(resolvedSpecifier).href
  }
}
