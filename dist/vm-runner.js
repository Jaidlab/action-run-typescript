// src/vm-runner.ts
import path2 from "node:path";

// src/lib/node/runVmRunner.ts
import { readFileSync } from "node:fs";

// src/lib/context/createCore.ts
import { appendFileSync, writeFileSync } from "node:fs";
var getEnvironmentFile = (name) => {
  const file = process.env[name];
  if (!file) {
    throw new Error(`Missing ${name}.`);
  }
  return file;
};
var toCommandValue = (value) => {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "" : serialized;
};
var escapeCommandValue = (value) => toCommandValue(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll(`
`, "%0A");
var escapeCommandProperty = (value) => escapeCommandValue(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
var toCommandPropertyString = (properties) => {
  if (!properties) {
    return "";
  }
  const entries = Object.entries(properties).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!entries.length) {
    return "";
  }
  return ` ${entries.map(([key, value]) => `${key}=${escapeCommandProperty(value)}`).join(",")}`;
};
var issueCommand = (command, message = "", properties) => {
  console.log(`::${command}${toCommandPropertyString(properties)}::${escapeCommandValue(message)}`);
};
var appendEnvironmentFileValue = (environmentFileName, name, value) => {
  const stringValue = toCommandValue(value);
  const delimiter = `gha_delimiter_${globalThis.crypto.randomUUID()}`;
  const serializedLine = /[\n\r]/.test(stringValue) ? `${name}<<${delimiter}
${stringValue}
${delimiter}
` : `${name}=${stringValue}
`;
  appendFileSync(getEnvironmentFile(environmentFileName), serializedLine, "utf8");
};
var appendEnvironmentFileLine = (environmentFileName, value) => {
  appendFileSync(getEnvironmentFile(environmentFileName), `${toCommandValue(value)}
`, "utf8");
};
var startGroup = (name) => {
  issueCommand("group", name);
};
var endGroup = () => {
  issueCommand("endgroup");
};
var createCore = () => {
  const summary = {
    append(value) {
      appendFileSync(getEnvironmentFile("GITHUB_STEP_SUMMARY"), toCommandValue(value), "utf8");
    },
    clear() {
      writeFileSync(getEnvironmentFile("GITHUB_STEP_SUMMARY"), "", "utf8");
    },
    write(value) {
      writeFileSync(getEnvironmentFile("GITHUB_STEP_SUMMARY"), toCommandValue(value), "utf8");
    }
  };
  return {
    addPath(inputPath) {
      appendEnvironmentFileLine("GITHUB_PATH", inputPath);
    },
    debug(message) {
      issueCommand("debug", message);
    },
    endGroup,
    error(message, properties) {
      issueCommand("error", message, properties);
    },
    exportVariable(name, value) {
      appendEnvironmentFileValue("GITHUB_ENV", name, value);
    },
    getState(name) {
      return process.env[`STATE_${name}`] || "";
    },
    async group(name, run) {
      startGroup(name);
      try {
        return await run();
      } finally {
        endGroup();
      }
    },
    info(message) {
      console.log(toCommandValue(message));
    },
    isDebug() {
      return process.env.RUNNER_DEBUG === "1";
    },
    notice(message, properties) {
      issueCommand("notice", message, properties);
    },
    saveState(name, value) {
      appendEnvironmentFileValue("GITHUB_STATE", name, value);
    },
    setFailed(message) {
      const normalizedMessage = message instanceof Error ? message.stack || message.message : message;
      issueCommand("error", normalizedMessage);
      process.exitCode = 1;
    },
    setOutput(name, value) {
      appendEnvironmentFileValue("GITHUB_OUTPUT", name, value);
    },
    setSecret(secret) {
      issueCommand("add-mask", secret);
    },
    startGroup,
    summary,
    warning(message, properties) {
      issueCommand("warning", message, properties);
    }
  };
};

// src/lib/context/createExecutionContext.ts
import vm from "node:vm";
var defineGlobalValue = (target, name, value) => {
  Reflect.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
};
var createGlobalValuesRecord = (...sources) => {
  const record = Object.create(null);
  for (const source of sources) {
    for (const [name, value] of Object.entries(source)) {
      defineGlobalValue(record, name, value);
    }
  }
  return record;
};
var createExecutionContext = (globalValues) => {
  const sandbox = Object.create(null);
  for (const key of Reflect.ownKeys(globalThis)) {
    if (key === "crypto" || key === "global" || key === "globalThis" || key === "self") {
      continue;
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(globalThis, key);
    if (descriptor) {
      Reflect.defineProperty(sandbox, key, descriptor);
    }
  }
  for (const [name, value] of Object.entries(globalValues)) {
    defineGlobalValue(sandbox, name, value);
  }
  Reflect.defineProperty(sandbox, "global", {
    configurable: true,
    enumerable: false,
    value: sandbox,
    writable: true
  });
  Reflect.defineProperty(sandbox, "globalThis", {
    configurable: true,
    enumerable: false,
    value: sandbox,
    writable: true
  });
  Reflect.defineProperty(sandbox, "self", {
    configurable: true,
    enumerable: false,
    value: sandbox,
    writable: true
  });
  Reflect.defineProperty(sandbox, "crypto", {
    configurable: true,
    enumerable: false,
    value: globalThis.crypto,
    writable: true
  });
  return vm.createContext(sandbox);
};

// src/lib/node/VmModuleRuntime.ts
import { createRequire, isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm2 from "node:vm";
class VmModuleRuntime {
  code;
  context;
  identifier;
  moduleCache = new Map;
  constructor(options) {
    this.code = options.code;
    this.context = createExecutionContext(options.globalValues);
    this.identifier = options.identifier;
  }
  async ensureEvaluated(module) {
    if (module.status === "unlinked") {
      await this.ensureLinked(module);
    }
    if (module.status === "linked") {
      await module.evaluate();
    }
  }
  async ensureLinked(module) {
    if (module.status === "unlinked") {
      await module.link((specifier, referencingModule) => this.linkModule(specifier, referencingModule));
    }
  }
  async evaluate() {
    const rootModule = new vm2.SourceTextModule(this.code, {
      context: this.context,
      identifier: this.identifier,
      importModuleDynamically: (specifier, referencingModule) => this.importModuleDynamically(specifier, referencingModule),
      initializeImportMeta: (importMeta) => {
        importMeta.url = this.identifier;
        if (this.identifier.startsWith("file:")) {
          const filename = fileURLToPath(this.identifier);
          importMeta.dirname = path.dirname(filename);
          importMeta.filename = filename;
        }
      }
    });
    await this.ensureLinked(rootModule);
    await this.ensureEvaluated(rootModule);
  }
  async importModuleDynamically(specifier, referencingModule) {
    const linkedModule = await this.linkModule(specifier, referencingModule);
    await this.ensureLinked(linkedModule);
    await this.ensureEvaluated(linkedModule);
    return linkedModule;
  }
  async linkModule(specifier, referencingModule) {
    const parentIdentifier = referencingModule?.identifier || this.identifier;
    const resolvedSpecifier = this.resolveExternalModuleSpecifier(specifier, parentIdentifier);
    const cachedModule = this.moduleCache.get(resolvedSpecifier);
    if (cachedModule) {
      return cachedModule;
    }
    const namespace = await import(resolvedSpecifier);
    const exportNames = Object.getOwnPropertyNames(namespace);
    const module = new vm2.SyntheticModule(exportNames, () => {
      for (const exportName of exportNames) {
        module.setExport(exportName, namespace[exportName]);
      }
    }, {
      context: this.context,
      identifier: resolvedSpecifier
    });
    this.moduleCache.set(resolvedSpecifier, module);
    return module;
  }
  resolveExternalModuleSpecifier(specifier, parentIdentifier) {
    if (specifier.startsWith("node:")) {
      return specifier;
    }
    if (isBuiltin(specifier)) {
      return `node:${specifier}`;
    }
    const requireParentPath = parentIdentifier.startsWith("file:") ? fileURLToPath(parentIdentifier) : path.join(process.cwd(), "__action_run_typescript_require__.mjs");
    const resolvedSpecifier = createRequire(requireParentPath).resolve(specifier);
    return resolvedSpecifier.startsWith("node:") ? resolvedSpecifier : pathToFileURL(resolvedSpecifier).href;
  }
}

// src/lib/node/runVmRunner.ts
var isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
var parsePayload = (payloadFile) => {
  const payload = JSON.parse(readFileSync(payloadFile, "utf8"));
  if (!isRecord(payload)) {
    throw new TypeError("Invalid VM runner payload.");
  }
  if (!isRecord(payload.bindings)) {
    throw new TypeError("Invalid VM runner bindings payload.");
  }
  if (!isRecord(payload.globals)) {
    throw new TypeError("Invalid VM runner globals payload.");
  }
  if (typeof payload.identifier !== "string" || !payload.identifier) {
    throw new TypeError("Invalid VM runner module identifier.");
  }
  return payload;
};
var getRequiredArgument = (value, label) => {
  if (!value) {
    throw new Error(`Missing ${label}.`);
  }
  return value;
};
var runVmRunner = async (payloadFile = process.argv[2], bundleFile = process.argv[3]) => {
  const resolvedPayloadFile = getRequiredArgument(payloadFile, "VM runner payload file path");
  const resolvedBundleFile = getRequiredArgument(bundleFile, "VM runner bundle file path");
  const payload = parsePayload(resolvedPayloadFile);
  const bundle = readFileSync(resolvedBundleFile, "utf8");
  const runtime = new VmModuleRuntime({
    code: bundle,
    globalValues: createGlobalValuesRecord({
      ...payload.bindings,
      core: createCore()
    }, payload.globals),
    identifier: payload.identifier
  });
  await runtime.evaluate();
};

// src/vm-runner.ts
var entryPath = import.meta.filename;
var isMainModule = () => {
  const mainModulePath = process.argv[1];
  if (!mainModulePath) {
    return false;
  }
  return path2.resolve(mainModulePath) === entryPath;
};
var vm_runner_default = runVmRunner;
if (isMainModule()) {
  await runVmRunner();
}
export {
  vm_runner_default as default
};
