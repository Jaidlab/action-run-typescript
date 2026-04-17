import {mkdir, rm} from 'node:fs/promises'
import path from 'node:path'

const isProduction = process.env.NODE_ENV === 'production'
const rootFolder = path.resolve(process.cwd())
const outputFolder = path.join(rootFolder, 'dist')
const outputFile = path.join(outputFolder, 'action.js')
const entryFile = path.join(rootFolder, 'src', 'main.ts')
await rm(outputFolder, {
  force: true,
  recursive: true,
})
await mkdir(outputFolder, {recursive: true})
const result = await Bun.build({
  entrypoints: [entryFile],
  format: 'esm',
  minify: isProduction,
  packages: 'bundle',
  splitting: false,
  target: 'node',
})
if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  throw new Error('Failed to build action bundle.')
}
const outputArtifact = result.outputs.find(output => output.kind === 'entry-point')
if (!outputArtifact) {
  throw new Error('No entry-point output artifact found.')
}
await Bun.write(outputFile, outputArtifact)
console.log(`Built action bundle: ${outputFile}`)
