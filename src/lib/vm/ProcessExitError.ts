export const normalizeExitCode = (value: unknown) => {
  if (value === undefined || value === null || value === '') {
    return 0
  }
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) {
    return 1
  }
  return Math.max(0, Math.trunc(numericValue))
}

export class ProcessExitError extends Error {
  readonly exitCode: number

  constructor(exitCode: unknown) {
    const normalizedExitCode = normalizeExitCode(exitCode)
    super(`Process exited with code ${normalizedExitCode}.`)
    this.name = 'ProcessExitError'
    this.exitCode = normalizedExitCode
  }
}
