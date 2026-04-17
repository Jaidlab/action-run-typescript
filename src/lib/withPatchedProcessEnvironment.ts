type Environment = Record<string, string | undefined>

const applyEnvironment = (source: Environment) => {
  for (const name of Object.keys(process.env)) {
    if (Object.hasOwn(source, name)) {
      continue
    }
    delete process.env[name]
  }
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) {
      delete process.env[name]
      continue
    }
    process.env[name] = value
  }
}

export const withPatchedProcessEnvironment = async <Value>(environment: Environment, run: () => Promise<Value> | Value) => {
  const originalEnvironment = {...process.env} as Environment
  const patchedEnvironment: Environment = {
    ...originalEnvironment,
    ...environment,
  }
  applyEnvironment(patchedEnvironment)
  try {
    return await run()
  } finally {
    applyEnvironment(originalEnvironment)
  }
}
