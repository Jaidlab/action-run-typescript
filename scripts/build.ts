import {cpSync, existsSync, mkdirSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const rspackRuntimePackageNames = [
  '@rspack/binding-linux-x64-gnu',
  '@rspack/binding-win32-x64-msvc',
] as const
const runtimePackageTreeRoots = [
  '@actions/core',
  '@rspack/core',
] as const
const normalizePackageVersion = (value: string) => value.replace(/^[\^~]/, '')
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
const downloadPackageFolder = async (packageName: string, version: string, outputFolder: string) => {
  const metadataUrl = `https://registry.npmjs.org/${packageName.replace('/', '%2f')}/${version}`
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
const ensureRuntimePackageFolder = async ({outputFolder,
  packageName,
  rootFolder,
  version}: {outputFolder: string
  packageName: string
  rootFolder: string
  version?: string}) => {
  if (copyPackageFolder(packageName, outputFolder, rootFolder)) {
    return path.join(outputFolder, 'node_modules', ...packageName.split('/'))
  }
  if (!version) {
    throw new Error(`Package ${packageName} is not available locally and no version was provided.`)
  }
  await downloadPackageFolder(packageName, normalizePackageVersion(version), outputFolder)
  return path.join(outputFolder, 'node_modules', ...packageName.split('/'))
}
const ensureRuntimePackageTree = async ({outputFolder,
  packageName,
  rootFolder,
  seen,
  version}: {outputFolder: string
  packageName: string
  rootFolder: string
  seen: Set<string>
  version?: string}) => {
  if (seen.has(packageName)) {
    return
  }
  seen.add(packageName)
  const packageFolder = await ensureRuntimePackageFolder({
    outputFolder,
    packageName,
    rootFolder,
    version,
  })
  const packageJson = await Bun.file(path.join(packageFolder, 'package.json')).json() as {
    readonly dependencies?: Record<string, string>
  }
  for (const [dependencyName, dependencyVersion] of Object.entries(packageJson.dependencies || {})) {
    await ensureRuntimePackageTree({
      outputFolder,
      packageName: dependencyName,
      rootFolder,
      seen,
      version: dependencyVersion,
    })
  }
}
const isProduction = process.env.NODE_ENV === 'production'
const rootFolder = path.resolve(process.cwd())
const outputFolder = path.join(rootFolder, 'dist')
const rootPackageJson = await Bun.file(path.join(rootFolder, 'package.json')).json() as {
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
}
const getRootPackageVersion = (packageName: string) => rootPackageJson.dependencies?.[packageName] || rootPackageJson.devDependencies?.[packageName]
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
const seenRuntimePackages = new Set<string>
for (const packageName of runtimePackageTreeRoots) {
  await ensureRuntimePackageTree({
    outputFolder,
    packageName,
    rootFolder,
    seen: seenRuntimePackages,
    version: getRootPackageVersion(packageName),
  })
}
for (const packageName of rspackRuntimePackageNames) {
  await ensureRuntimePackageFolder({
    outputFolder,
    packageName,
    rootFolder,
    version: getRootPackageVersion(packageName),
  })
}
console.log(`Built action bundle: ${path.join(outputFolder, 'action.js')}`)
