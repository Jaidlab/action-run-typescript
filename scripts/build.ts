import {cpSync, existsSync, mkdirSync, rmSync} from 'node:fs'
import path from 'node:path'

const isProduction = process.env.NODE_ENV === 'production'
const rootFolder = path.resolve(process.cwd())
const outputFolder = path.join(rootFolder, 'dist')
const vendorFolder = path.join(outputFolder, 'vendor')
const rspackCoreFolder = path.join(rootFolder, 'node_modules', '@rspack', 'core')
const buildActionEntry = async ({entryFile, external = [], outputFile}: {entryFile: string
  external?: Array<string>
  outputFile: string}) => {
  const result = await Bun.build({
    entrypoints: [entryFile],
    format: 'esm',
    minify: isProduction,
    external,
    packages: 'bundle',
    splitting: false,
    target: 'node',
  })
  if (!result.success) {
    for (const log of result.logs) {
      console.error(log)
    }
    throw new Error(`Failed to build ${entryFile}.`)
  }
  const outputArtifact = result.outputs.find(output => output.kind === 'entry-point')
  if (!outputArtifact) {
    throw new Error(`No entry-point output artifact found for ${entryFile}.`)
  }
  await Bun.write(outputFile, outputArtifact)
}
const copyPath = (sourcePath: string, outputPath: string) => {
  mkdirSync(path.dirname(outputPath), {recursive: true})
  cpSync(sourcePath, outputPath, {
    recursive: true,
  })
}
if (!existsSync(rspackCoreFolder)) {
  throw new Error(`Missing local @rspack/core installation in ${rspackCoreFolder}. Run bun install first.`)
}
rmSync(outputFolder, {
  force: true,
  recursive: true,
})
mkdirSync(outputFolder, {recursive: true})
await buildActionEntry({
  entryFile: path.join(rootFolder, 'src', 'main.ts'),
  external: ['@rspack/core'],
  outputFile: path.join(outputFolder, 'action.js'),
})
for (const relativePath of ['compiled', 'dist', 'hot', 'package.json', 'LICENSE']) {
  copyPath(path.join(rspackCoreFolder, relativePath), path.join(vendorFolder, '@rspack', 'core', relativePath))
}
console.log(`Built action bundle: ${path.join(outputFolder, 'action.js')}`)
