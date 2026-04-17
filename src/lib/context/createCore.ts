import {appendFileSync, writeFileSync} from 'node:fs'

export interface CoreSummaryLike {
  append: (value: unknown) => void
  clear: () => void
  write: (value: unknown) => void
}

export interface CoreLike {
  addPath: (inputPath: unknown) => void
  debug: (message: unknown) => void
  endGroup: () => void
  error: (message: unknown, properties?: Record<string, unknown>) => void
  exportVariable: (name: string, value: unknown) => void
  getState: (name: string) => string
  group: <Value>(name: unknown, run: () => Promise<Value> | Value) => Promise<Value>
  info: (message: unknown) => void
  isDebug: () => boolean
  notice: (message: unknown, properties?: Record<string, unknown>) => void
  saveState: (name: string, value: unknown) => void
  setFailed: (message: unknown) => void
  setOutput: (name: string, value: unknown) => void
  setSecret: (secret: unknown) => void
  startGroup: (name: unknown) => void
  summary: CoreSummaryLike
  warning: (message: unknown, properties?: Record<string, unknown>) => void
}

const getEnvironmentFile = (name: string) => {
  const file = process.env[name]
  if (!file) {
    throw new Error(`Missing ${name}.`)
  }
  return file
}
const toCommandValue = (value: unknown) => {
  if (value === undefined || value === null) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  const serialized = JSON.stringify(value) as string | undefined
  return serialized === undefined ? '' : serialized
}
const escapeCommandValue = (value: unknown) => toCommandValue(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
const escapeCommandProperty = (value: unknown) => escapeCommandValue(value).replaceAll(':', '%3A').replaceAll(',', '%2C')
const toCommandPropertyString = (properties?: Record<string, unknown>) => {
  if (!properties) {
    return ''
  }
  const entries = Object.entries(properties).filter(([, value]) => value !== undefined && value !== null && value !== '')
  if (!entries.length) {
    return ''
  }
  return ` ${entries.map(([key, value]) => `${key}=${escapeCommandProperty(value)}`).join(',')}`
}
const issueCommand = (command: string, message = '', properties?: Record<string, unknown>) => {
  console.log(`::${command}${toCommandPropertyString(properties)}::${escapeCommandValue(message)}`)
}
const appendEnvironmentFileValue = (environmentFileName: string, name: string, value: unknown) => {
  const stringValue = toCommandValue(value)
  const delimiter = `gha_delimiter_${globalThis.crypto.randomUUID()}`
  const serializedLine = /[\n\r]/.test(stringValue) ? `${name}<<${delimiter}\n${stringValue}\n${delimiter}\n` : `${name}=${stringValue}\n`
  appendFileSync(getEnvironmentFile(environmentFileName), serializedLine, 'utf8')
}
const appendEnvironmentFileLine = (environmentFileName: string, value: unknown) => {
  appendFileSync(getEnvironmentFile(environmentFileName), `${toCommandValue(value)}\n`, 'utf8')
}
const startGroup = (name: unknown) => {
  issueCommand('group', name)
}
const endGroup = () => {
  issueCommand('endgroup')
}

export const createCore = (): CoreLike => {
  const summary: CoreSummaryLike = {
    append(value: unknown) {
      appendFileSync(getEnvironmentFile('GITHUB_STEP_SUMMARY'), toCommandValue(value), 'utf8')
    },
    clear() {
      writeFileSync(getEnvironmentFile('GITHUB_STEP_SUMMARY'), '', 'utf8')
    },
    write(value: unknown) {
      writeFileSync(getEnvironmentFile('GITHUB_STEP_SUMMARY'), toCommandValue(value), 'utf8')
    },
  }
  return {
    addPath(inputPath: unknown) {
      appendEnvironmentFileLine('GITHUB_PATH', inputPath)
    },
    debug(message: unknown) {
      issueCommand('debug', message)
    },
    endGroup,
    error(message: unknown, properties?: Record<string, unknown>) {
      issueCommand('error', message, properties)
    },
    exportVariable(name: string, value: unknown) {
      appendEnvironmentFileValue('GITHUB_ENV', name, value)
    },
    getState(name: string) {
      return process.env[`STATE_${name}`] || ''
    },
    async group<Value>(name: unknown, run: () => Promise<Value> | Value) {
      startGroup(name)
      try {
        return await run()
      } finally {
        endGroup()
      }
    },
    info(message: unknown) {
      console.log(toCommandValue(message))
    },
    isDebug() {
      return process.env.RUNNER_DEBUG === '1'
    },
    notice(message: unknown, properties?: Record<string, unknown>) {
      issueCommand('notice', message, properties)
    },
    saveState(name: string, value: unknown) {
      appendEnvironmentFileValue('GITHUB_STATE', name, value)
    },
    setFailed(message: unknown) {
      const normalizedMessage = message instanceof Error ? message.stack || message.message : message
      issueCommand('error', normalizedMessage)
      process.exitCode = 1
    },
    setOutput(name: string, value: unknown) {
      appendEnvironmentFileValue('GITHUB_OUTPUT', name, value)
    },
    setSecret(secret: unknown) {
      issueCommand('add-mask', secret)
    },
    startGroup,
    summary,
    warning(message: unknown, properties?: Record<string, unknown>) {
      issueCommand('warning', message, properties)
    },
  }
}
