import vm from 'node:vm'

type GlobalRecord = Record<PropertyKey, unknown>

const defineGlobalValue = (target: object, name: PropertyKey, value: unknown) => {
  Reflect.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}

export const createGlobalValuesRecord = (...sources: ReadonlyArray<Record<string, unknown>>) => {
  const record = Object.create(null) as Record<string, unknown>
  for (const source of sources) {
    for (const [name, value] of Object.entries(source)) {
      defineGlobalValue(record, name, value)
    }
  }
  return record
}

export const createExecutionContext = (globalValues: Record<string, unknown>) => {
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
