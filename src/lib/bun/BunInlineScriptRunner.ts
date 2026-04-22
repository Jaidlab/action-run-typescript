import type {ActionRuntimeBindings} from '../ActionRuntimeBindings.ts'
import type {ActionRuntimeGoodieName} from '../ActionRuntimeGoodie.ts'

import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

export interface BunInlineScriptRunnerOptions {
  readonly bindings: ActionRuntimeBindings
  readonly code: string
  readonly environment: Record<string, string | undefined>
  readonly globals: Record<string, unknown>
  readonly goodies: ReadonlySet<ActionRuntimeGoodieName>
  readonly workspace: string
}

interface PreparedInlineScript {
  readonly bootstrapFile: string
  cleanup: () => void
}
const tsTranspiler = new Bun.Transpiler({loader: 'ts'})
const tsxTranspiler = new Bun.Transpiler({loader: 'tsx'})
const serializeJavaScriptValue = (value: unknown) => String(JSON.stringify(value, null, 2))
const createBootstrapSource = ({bindings,
  globals,
  goodies,
  userEntryFile}: {bindings: ActionRuntimeBindings
  globals: Record<string, unknown>
  goodies: ReadonlySet<ActionRuntimeGoodieName>
  userEntryFile: string}) => {
  const lines = ['export {}']
  if (goodies.has('core')) {
    lines.unshift("import * as core from '@actions/core'")
  }
  lines.push('', `process.env.NODE_ENV ||= ${JSON.stringify('production')}`)
  const mergedExpressions = new Map<string, string>
  if (goodies.has('core')) {
    mergedExpressions.set('core', 'core')
  }
  for (const [name, value] of Object.entries(bindings)) {
    mergedExpressions.set(name, serializeJavaScriptValue(value))
  }
  for (const [name, value] of Object.entries(globals)) {
    mergedExpressions.set(name, serializeJavaScriptValue(value))
  }
  const locals: Array<{localName: string
    name: string}> = []
  let index = 0
  for (const [name, expression] of mergedExpressions) {
    const localName = `value${index++}`
    lines.push(`const ${localName} = ${expression}`)
    locals.push({
      localName,
      name,
    })
  }
  lines.push('const globals = {')
  for (const {localName, name} of locals) {
    lines.push(`  ${JSON.stringify(name)}: ${localName},`)
  }
  lines.push('}')
  lines.push('for (const [name, value] of Object.entries(globals)) {')
  lines.push('  Reflect.defineProperty(globalThis, name, {')
  lines.push('    configurable: true,')
  lines.push('    enumerable: true,')
  lines.push('    value,')
  lines.push('    writable: true,')
  lines.push('  })')
  lines.push('}')
  lines.push(`await import(${JSON.stringify(pathToFileURL(userEntryFile).href)})`)
  lines.push('')
  return lines.join('\n')
}
const createSpawnEnvironment = (environment: Record<string, string | undefined>) => Object.fromEntries(Object.entries(environment)
  .filter(([, value]) => value !== undefined)) as Record<string, string>
const createUserEntrySource = (code: string) => `export {}\n\n${code}\n`
const isProbablyJsxParseFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('JSX')
    || message.includes('Unexpected token') && message.includes('<')
    || message.includes('Expected') && message.includes('</')
}
const prepareTranspiler = (transpiler: Bun.Transpiler, code: string) => {
  transpiler.transformSync(code)
}
const resolveUserEntryExtension = (code: string) => {
  try {
    prepareTranspiler(tsTranspiler, code)
    return '.ts'
  } catch (tsError) {
    try {
      prepareTranspiler(tsxTranspiler, code)
      return '.tsx'
    } catch (tsxError) {
      if (isProbablyJsxParseFailure(tsError)) {
        throw tsxError
      }
      throw tsError
    }
  }
}
const waitForChildProcess = (child: ReturnType<typeof spawn>) => new Promise<{exitCode: number | null
  signal: string | null}>((resolve, reject) => {
  child.once('error', reject)
  child.once('close', (exitCode, signal) => {
    resolve({
      exitCode,
      signal,
    })
  })
})

export class BunInlineScriptRunner {
  readonly options: BunInlineScriptRunnerOptions

  constructor(options: BunInlineScriptRunnerOptions) {
    this.options = options
  }

  createPreparedInlineScript(): PreparedInlineScript {
    const extension = resolveUserEntryExtension(this.options.code)
    const nonce = randomUUID()
    const outputFolder = mkdtempSync(path.join(this.options.workspace, '.action-run-typescript-'))
    const bootstrapFile = path.join(outputFolder, 'bootstrap.ts')
    const userEntryFile = path.join(this.options.workspace, `__action_run_typescript_inline__.${nonce}${extension}`)
    const cleanup = () => {
      rmSync(outputFolder, {
        force: true,
        recursive: true,
      })
      rmSync(userEntryFile, {force: true})
    }
    writeFileSync(userEntryFile, createUserEntrySource(this.options.code), 'utf8')
    writeFileSync(bootstrapFile, createBootstrapSource({
      bindings: this.options.bindings,
      globals: this.options.globals,
      goodies: this.options.goodies,
      userEntryFile,
    }), 'utf8')
    return {
      bootstrapFile,
      cleanup,
    }
  }

  async run() {
    const preparedInlineScript = this.createPreparedInlineScript()
    try {
      const child = spawn(process.execPath, [preparedInlineScript.bootstrapFile], {
        cwd: this.options.workspace,
        env: createSpawnEnvironment(this.options.environment),
        stdio: 'inherit',
      })
      const {exitCode, signal} = await waitForChildProcess(child)
      if (signal) {
        throw new Error(`Inline TypeScript exited due to signal ${signal}.`)
      }
      const normalizedExitCode = exitCode ?? 0
      if (normalizedExitCode !== 0) {
        throw new Error(`Inline TypeScript exited with code ${normalizedExitCode}.`)
      }
    } finally {
      preparedInlineScript.cleanup()
    }
  }
}
