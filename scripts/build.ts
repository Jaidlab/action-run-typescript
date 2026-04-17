import {cpSync, existsSync, mkdirSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const rspackRuntimePackageNames = [
  '@rspack/core',
  '@rspack/binding',
  '@rspack/binding-linux-x64-gnu',
  '@rspack/binding-win32-x64-msvc',
] as const
const copyPackageFolder = (packageName: string, outputFolder: string, rootFolder: string) => {
  const packagePathSegments = packageName.split('/')
  const sourceFolder = path.join(rootFolder, 'node_modules', ...packagePathSegments)
  if (!existsSync(sourceFolder)) {
    return false
  }
  const targetFolder = path.join(outputFolder, 'node_modules', ...packagePathSegments)
  mkdirSync(path.dirname(targetFolder), {recursive: true})
  cpSync(sourceFolder, targetFolder, {
    recursive: true,
  })
  return true
}
const getPackageVersion = async (packageJsonFile: string, packageName: string) => {
  const packageJson = await Bun.file(packageJsonFile).json() as {
    readonly dependencies?: Record<string, string>
    readonly devDependencies?: Record<string, string>
  }
  const rawVersion = packageJson.dependencies?.[packageName] || packageJson.devDependencies?.[packageName]
  if (!rawVersion) {
    throw new Error(`Package ${packageName} is not declared in package.json.`)
  }
  return rawVersion.replace(/^[\^~]/, '')
}
const downloadPackageFolder = async (packageName: string, version: string, outputFolder: string) => {
  const encodedPackageName = packageName.replace('/', '%2f')
  const metadataUrl = `https://registry.npmjs.org/${encodedPackageName}/${version}`
  const metadataResponse = await fetch(metadataUrl)
  if (!metadataResponse.ok) {
    throw new Error(`Failed to fetch package metadata for ${packageName}@${version} from ${metadataUrl}.`)
  }
  const metadata = await metadataResponse.json() as {
    readonly dist?: {
      readonly tarball?: string
    }
  }
  const tarballUrl = metadata.dist?.tarball
  if (!tarballUrl) {
    throw new Error(`Package metadata for ${packageName}@${version} does not contain a tarball URL.`)
  }
  const temporaryFolder = path.join(os.tmpdir(), `action-run-typescript-build-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(temporaryFolder, {recursive: true})
  const archiveFile = path.join(temporaryFolder, 'package.tgz')
  const extractFolder = path.join(temporaryFolder, 'extract')
  mkdirSync(extractFolder, {recursive: true})
  try {
    const tarballResponse = await fetch(tarballUrl)
    if (!tarballResponse.ok) {
      throw new Error(`Failed to download ${packageName}@${version} from ${tarballUrl}.`)
    }
    await Bun.write(archiveFile, await tarballResponse.arrayBuffer())
    await Bun.$`tar -xf ${archiveFile} -C ${extractFolder}`
    const extractedFolder = path.join(extractFolder, 'package')
    if (!existsSync(extractedFolder)) {
      throw new Error(`Archive for ${packageName}@${version} did not contain a package folder.`)
    }
    const targetFolder = path.join(outputFolder, 'node_modules', ...packageName.split('/'))
    mkdirSync(path.dirname(targetFolder), {recursive: true})
    cpSync(extractedFolder, targetFolder, {
      recursive: true,
    })
  } finally {
    rmSync(temporaryFolder, {
      force: true,
      recursive: true,
    })
  }
}
const isProduction = process.env.NODE_ENV === 'production'
const rootFolder = path.resolve(process.cwd())
const outputFolder = path.join(rootFolder, 'dist')
const outputFile = path.join(outputFolder, 'action.js')
const entryFile = path.join(rootFolder, 'src', 'main.ts')
const packageJsonFile = path.join(rootFolder, 'package.json')
rmSync(outputFolder, {
  force: true,
  recursive: true,
})
mkdirSync(outputFolder, {recursive: true})
const result = await Bun.build({
  entrypoints: [entryFile],
  format: 'esm',
  minify: isProduction,
  external: ['@rspack/core'],
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
for (const packageName of rspackRuntimePackageNames) {
  if (copyPackageFolder(packageName, outputFolder, rootFolder)) {
    continue
  }
  const version = await getPackageVersion(packageJsonFile, packageName)
  await downloadPackageFolder(packageName, version, outputFolder)
}
console.log(`Built action bundle: ${outputFile}`)
