import type {ActionRuntimeBindings} from '../ActionRuntimeBindings.ts'
import type {Compiler, ExternalItemFunctionData, Stats} from '@rspack/core'

import {randomUUID} from 'node:crypto'
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {promisify} from 'node:util'

import {ensureRspackBindingFile} from './ensureRspackBindingFile.ts'

const globalsAlias = '__action_run_typescript_globals__'
const injectedIdentifierPattern = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u

type RspackModule = typeof import('@rspack/core')
type Rspack = RspackModule['default']

const closeCompiler = (compiler: Compiler) => promisify(compiler.close.bind(compiler))()
const createBootstrapEntrySource = (userEntrySpecifier: string) => `export {}\n\nawait import(${JSON.stringify(userEntrySpecifier)})\n`
const createUserEntrySource = (code: string) => `export {}\n\n${code}\n`
const getRspackOutput = async (compiler: Compiler) => {
  try {
    const stats = await (promisify(compiler.run.bind(compiler)) as () => Promise<Stats>)()
    if (stats.hasErrors()) {
      throw new Error(stats.toString())
    }
  } finally {
    await closeCompiler(compiler)
  }
}
const getVendorRspackFiles = () => ({
  core: fileURLToPath(new URL('vendor/@rspack/core/dist/index.js', import.meta.url)),
  packageJson: fileURLToPath(new URL('vendor/@rspack/core/package.json', import.meta.url)),
})
const getVendorRspackVersion = (packageJsonFile: string) => {
  const packageJson = JSON.parse(readFileSync(packageJsonFile, 'utf8')) as {
    readonly version?: string
  }
  if (!packageJson.version) {
    throw new Error(`Vendored @rspack/core package metadata in ${packageJsonFile} does not contain a version.`)
  }
  return packageJson.version
}
const isBundledRequest = (request: string | undefined) => {
  if (!request) {
    return true
  }
  return request.startsWith('.')
    || request.startsWith('/')
    || request.startsWith('file:')
    || request.startsWith('#')
    || request.startsWith('__action_run_typescript_')
    || path.isAbsolute(request)
}
const isPathInside = (parentFolder: string, childPath: string) => {
  const normalizedParentFolder = path.resolve(parentFolder)
  const normalizedChildPath = path.resolve(childPath)
  return normalizedChildPath === normalizedParentFolder || normalizedChildPath.startsWith(normalizedParentFolder + path.sep)
}
const isProbablyJsxParseFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('JSX')
    || message.includes('Unexpected token') && message.includes('<')
    || message.includes('files with the .mts or .cts extension')
}
const isValidInjectedIdentifier = (name: string) => injectedIdentifierPattern.test(name)
const loadRspack = async (): Promise<Rspack> => {
  const vendorRspackFiles = getVendorRspackFiles()
  if (existsSync(vendorRspackFiles.core) && existsSync(vendorRspackFiles.packageJson)) {
    if (!process.env.RSPACK_BINDING || !existsSync(process.env.RSPACK_BINDING)) {
      process.env.RSPACK_BINDING = await ensureRspackBindingFile({
        version: getVendorRspackVersion(vendorRspackFiles.packageJson),
      })
    }
    const vendorRspackModule = await import(pathToFileURL(vendorRspackFiles.core).href) as RspackModule
    return vendorRspackModule.default
  }
  const localRspackModule = await import('@rspack/core')
  return localRspackModule.default
}
const serializeJavaScriptValue = (value: unknown) => String(JSON.stringify(value, null, 2))
const toForwardSlashRelativePath = (from: string, to: string) => path.relative(from, to).replaceAll('\\', '/')
const createGlobalsModuleSource = ({bindings,
  globals,
  exportNamedValues}: {bindings: ActionRuntimeBindings
  exportNamedValues: boolean
  globals: Record<string, unknown>}) => {
  const lines: Array<string> = []
  const mergedExpressions = new Map<string, string>
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
    if (exportNamedValues && isValidInjectedIdentifier(name)) {
      lines.push(`export {${localName} as ${name}}`)
    }
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
  lines.push('export default globals')
  return `${lines.join('\n')}\n`
}
const createCompiler = ({entryFile,
  globalsProvidedFile,
  globalsRuntimeFileName,
  injectedGlobalNames,
  outputFolder,
  rspack,
  workspace}: {entryFile: string
  globalsProvidedFile: string
  globalsRuntimeFileName: string
  injectedGlobalNames: ReadonlySet<string>
  outputFolder: string
  rspack: Rspack
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
    ({context = '', request}: ExternalItemFunctionData) => {
      if (isBundledRequest(request) || !isPathInside(workspace, context)) {
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
  plugins: [
    new rspack.ProvidePlugin(Object.fromEntries([...injectedGlobalNames]
      .filter(isValidInjectedIdentifier)
      .map(name => [name, [globalsAlias, name]]))),
    new rspack.BannerPlugin({
      raw: true,
      banner: [
        `import __action_run_typescript_globals__ from ${JSON.stringify(`./${globalsRuntimeFileName}`)};`,
        'for (const [name, value] of Object.entries(__action_run_typescript_globals__)) {',
        '  Reflect.defineProperty(globalThis, name, {',
        '    configurable: true,',
        '    enumerable: true,',
        '    value,',
        '    writable: true,',
        '  });',
        '}',
      ].join('\n'),
    }),
  ],
  resolve: {
    alias: {
      [globalsAlias]: globalsProvidedFile,
    },
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.mts', '.cts', '.mjs', '.cjs', '.json'],
  },
})

export interface BundledInlineScript {
  cleanup: () => void
  file: string
}

export interface RspackInlineScriptBundleOptions {
  readonly bindings: ActionRuntimeBindings
  readonly code: string
  readonly globals: Record<string, unknown>
}

export interface RspackInlineScriptBundlerOptions {
  readonly workspace: string
}

export class RspackInlineScriptBundler {
  readonly options: RspackInlineScriptBundlerOptions

  constructor(options: RspackInlineScriptBundlerOptions) {
    this.options = options
  }

  async bundle(options: RspackInlineScriptBundleOptions) {
    let tsError: unknown
    try {
      return await this.bundleWithExtension(options, '.ts')
    } catch (error) {
      tsError = error
    }
    try {
      return await this.bundleWithExtension(options, '.tsx')
    } catch (tsxError) {
      if (isProbablyJsxParseFailure(tsError)) {
        throw tsxError
      }
      throw tsError
    }
  }

  async bundleWithExtension({bindings,
    code,
    globals}: RspackInlineScriptBundleOptions, extension: '.ts' | '.tsx'): Promise<BundledInlineScript> {
    const nonce = randomUUID()
    const outputFolder = mkdtempSync(path.join(this.options.workspace, '.action-run-typescript-'))
    const bundleFile = path.join(outputFolder, 'bundle.mjs')
    const globalsProvidedFile = path.join(outputFolder, 'globals.provided.mjs')
    const globalsRuntimeFile = path.join(outputFolder, 'globals.mjs')
    const bootstrapEntryFile = path.join(outputFolder, 'entry.ts')
    const userEntryFile = path.join(this.options.workspace, `__action_run_typescript_inline__.${nonce}${extension}`)
    const injectedGlobalNames = new Set([...Object.keys(bindings), ...Object.keys(globals)])
    const cleanup = () => {
      rmSync(outputFolder, {
        force: true,
        recursive: true,
      })
      rmSync(userEntryFile, {force: true})
    }
    const rspack = await loadRspack()
    writeFileSync(userEntryFile, createUserEntrySource(code), 'utf8')
    writeFileSync(globalsProvidedFile, createGlobalsModuleSource({
      bindings,
      exportNamedValues: true,
      globals,
    }), 'utf8')
    writeFileSync(globalsRuntimeFile, createGlobalsModuleSource({
      bindings,
      exportNamedValues: false,
      globals,
    }), 'utf8')
    writeFileSync(bootstrapEntryFile, createBootstrapEntrySource(toForwardSlashRelativePath(outputFolder, userEntryFile)), 'utf8')
    const compiler = createCompiler({
      entryFile: bootstrapEntryFile,
      globalsProvidedFile,
      globalsRuntimeFileName: path.basename(globalsRuntimeFile),
      injectedGlobalNames,
      outputFolder,
      rspack,
      workspace: this.options.workspace,
    })
    try {
      await getRspackOutput(compiler)
      return {
        cleanup,
        file: bundleFile,
      }
    } catch (error) {
      cleanup()
      throw error
    }
  }
}
