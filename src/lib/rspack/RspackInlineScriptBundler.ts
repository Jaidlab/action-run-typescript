import type {Compiler, ExternalItemFunctionData, Stats} from '@rspack/core'

import {randomUUID} from 'node:crypto'
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'

import rspack from '@rspack/core'

const isBundledRequest = (request: string | undefined) => {
  if (!request) {
    return true
  }
  return request.startsWith('.')
    || request.startsWith('/')
    || request.startsWith('file:')
    || request.startsWith('#')
    || path.isAbsolute(request)
}
const isProbablyJsxParseFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('JSX')
    || message.includes('Unexpected token') && message.includes('<')
    || message.includes('files with the .mts or .cts extension')
}
const closeCompiler = (compiler: Compiler) => promisify(compiler.close.bind(compiler))()
const runCompiler = (compiler: Compiler) => (promisify(compiler.run.bind(compiler)) as () => Promise<Stats>)()
const createCompiler = ({entryFile, outputFolder, workspace}: {entryFile: string
  outputFolder: string
  workspace: string}) => rspack({
  context: workspace,
  mode: 'none',
  target: 'node',
  devtool: false,
  entry: entryFile,
  experiments: {
    outputModule: true,
    topLevelAwait: true,
  },
  externalsPresets: {
    node: true,
  },
  externalsType: 'module',
  externals: [
    ({request}: ExternalItemFunctionData) => {
      if (isBundledRequest(request)) {
        return
      }
      return request
    },
  ],
  module: {
    rules: [
      {
        test: /\.[cm]?[jt]sx?$/,
        type: 'javascript/auto',
        loader: 'builtin:swc-loader',
        options: {
          detectSyntax: 'auto',
          jsc: {
            target: 'es2023',
            transform: {
              react: {
                development: false,
                runtime: 'automatic',
              },
            },
          },
        },
      },
    ],
  },
  optimization: {
    minimize: false,
    runtimeChunk: false,
    splitChunks: false,
  },
  output: {
    chunkFormat: 'module',
    chunkLoading: false,
    filename: 'bundle.mjs',
    library: {
      type: 'module',
    },
    module: true,
    path: outputFolder,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.mts', '.cts', '.mjs', '.cjs', '.json'],
  },
})
const createEntrySource = (code: string) => `export {}\n\n${code}\n`
const getRspackOutput = async (compiler: Compiler, outputFile: string) => {
  try {
    const stats = await runCompiler(compiler)
    if (stats.hasErrors()) {
      throw new Error(stats.toString())
    }
    return readFileSync(outputFile, 'utf8')
  } finally {
    await closeCompiler(compiler)
  }
}

export interface RspackInlineScriptBundlerOptions {
  readonly tempFolder?: string
  readonly workspace: string
}

export class RspackInlineScriptBundler {
  readonly options: RspackInlineScriptBundlerOptions

  constructor(options: RspackInlineScriptBundlerOptions) {
    this.options = options
  }

  async bundle(code: string) {
    let tsError: unknown
    try {
      return await this.bundleWithExtension(code, '.ts')
    } catch (error) {
      tsError = error
    }
    try {
      return await this.bundleWithExtension(code, '.tsx')
    } catch (tsxError) {
      if (isProbablyJsxParseFailure(tsError)) {
        throw tsxError
      }
      throw tsError
    }
  }

  async bundleWithExtension(code: string, extension: '.ts' | '.tsx') {
    const temporaryRoot = this.options.tempFolder || os.tmpdir()
    mkdirSync(temporaryRoot, {recursive: true})
    const nonce = randomUUID()
    const entryFile = path.join(this.options.workspace, `__action_run_typescript_inline__.${nonce}${extension}`)
    const outputFolder = path.join(temporaryRoot, `action-run-typescript-rspack-${nonce}`)
    const outputFile = path.join(outputFolder, 'bundle.mjs')
    writeFileSync(entryFile, createEntrySource(code), 'utf8')
    mkdirSync(outputFolder, {recursive: true})
    const compiler = createCompiler({
      entryFile,
      outputFolder,
      workspace: this.options.workspace,
    })
    try {
      return await getRspackOutput(compiler, outputFile)
    } finally {
      rmSync(outputFolder, {
        force: true,
        recursive: true,
      })
      rmSync(entryFile, {force: true})
    }
  }
}
