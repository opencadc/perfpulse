import { createInterface } from "node:readline/promises";

export interface CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface CommandRunner {
  run(
    command: string,
    args: readonly string[],
    options?: { stdin?: string },
  ): Promise<CommandResult>;
}

export interface SkahaAuthPrompter {
  promptPassword(): Promise<string>;
  promptUsername(): Promise<string>;
}

export interface SkahaAuthSetupOptions {
  namespace?: string;
  prompter?: SkahaAuthPrompter;
  runner?: CommandRunner;
  secretName?: string;
}

export interface SkahaAuthCleanupOptions {
  namespace?: string;
  runner?: CommandRunner;
  secretName?: string;
}

export interface SkahaAuthSetupResult {
  namespace: string;
  secretName: string;
}

const defaultNamespace = "canfar-perfpulse";
const defaultSecretName = "perfpulse-skaha-auth";

export async function runSkahaAuthSetup(
  options: SkahaAuthSetupOptions = {},
): Promise<SkahaAuthSetupResult> {
  const namespace = options.namespace ?? defaultNamespace;
  const prompter = options.prompter ?? terminalPrompter;
  const runner = options.runner ?? bunCommandRunner;
  const secretName = options.secretName ?? defaultSecretName;

  const username = await prompter.promptUsername();
  validateNonEmpty("username", username);

  const password = await prompter.promptPassword();
  validateNonEmpty("password", password);

  const secretManifest = createSecretManifest({
    namespace,
    password,
    secretName,
    username,
  });
  await applySecretManifest({ namespace, runner, secretManifest });

  return { namespace, secretName };
}

export async function runSkahaAuthCleanup(
  options: SkahaAuthCleanupOptions = {},
): Promise<SkahaAuthSetupResult> {
  const namespace = options.namespace ?? defaultNamespace;
  const runner = options.runner ?? bunCommandRunner;
  const secretName = options.secretName ?? defaultSecretName;

  const result = await runner.run("kubectl", [
    "delete",
    "secret",
    secretName,
    "--namespace",
    namespace,
    "--ignore-not-found=true",
  ]);
  if (result.exitCode !== 0) {
    throw new Error("Failed to delete Skaha auth Kubernetes Secret");
  }

  return { namespace, secretName };
}

function validateNonEmpty(fieldName: "password" | "username", value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`Skaha ${fieldName} must not be empty`);
  }
}

function createSecretManifest(options: {
  namespace: string;
  password: string;
  secretName: string;
  username: string;
}): string {
  return [
    "apiVersion: v1",
    "kind: Secret",
    "metadata:",
    `  name: ${options.secretName}`,
    `  namespace: ${options.namespace}`,
    "type: Opaque",
    "data:",
    `  username: ${encodeSecretValue(options.username)}`,
    `  password: ${encodeSecretValue(options.password)}`,
    "",
  ].join("\n");
}

function encodeSecretValue(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

async function applySecretManifest(options: {
  namespace: string;
  runner: CommandRunner;
  secretManifest: string;
}): Promise<void> {
  const result = await options.runner.run(
    "kubectl",
    ["apply", "--namespace", options.namespace, "--filename", "-"],
    { stdin: options.secretManifest },
  );
  if (result.exitCode !== 0) {
    throw new Error("Failed to apply Skaha auth Kubernetes Secret");
  }
}

export function createTerminalSkahaAuthPrompter(
  input: RawModeInput = process.stdin as RawModeInput,
  output: NodeJS.WritableStream = process.stdout,
): SkahaAuthPrompter {
  return {
    async promptPassword() {
      return promptHiddenLine("Skaha password: ", input, output);
    },
    async promptUsername() {
      if (!input.isTTY) {
        throw new Error("Skaha username prompt requires an interactive TTY");
      }
      return promptVisibleLine("Skaha username: ", input as NodeJS.ReadableStream, output);
    },
  };
}

const terminalPrompter = createTerminalSkahaAuthPrompter();

async function promptVisibleLine(
  question: string,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<string> {
  const readline = createInterface({
    input,
    output,
  });

  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}

async function promptHiddenLine(
  question: string,
  input: RawModeInput,
  output: NodeJS.WritableStream,
): Promise<string> {
  if (!input.isTTY || input.setRawMode === undefined) {
    throw new Error("Skaha password prompt requires an interactive TTY");
  }

  output.write(question);
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let value = "";

    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode?.(false);
      input.pause?.();
      output.write("\n");
    };

    const finish = (result: string) => {
      cleanup();
      resolve(result);
    };

    const cancel = () => {
      cleanup();
      reject(new Error("Skaha password prompt cancelled"));
    };

    function onData(chunk: Buffer): void {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          cancel();
          return;
        }
        if (character === "\r" || character === "\n") {
          finish(value);
          return;
        }
        if (character === "\b" || character === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    }

    input.on("data", onData);
  });
}

interface RawModeInput {
  isTTY?: boolean;
  off(eventName: "data", listener: (chunk: Buffer) => void): this;
  on(eventName: "data", listener: (chunk: Buffer) => void): this;
  pause?(): this;
  resume(): this;
  setRawMode?(mode: boolean): this;
}

const bunCommandRunner: CommandRunner = {
  async run(command, args, options) {
    const subprocess = Bun.spawn([command, ...args], {
      stderr: "pipe",
      stdin: options?.stdin === undefined ? "ignore" : "pipe",
      stdout: "pipe",
    });

    if (options?.stdin !== undefined && subprocess.stdin !== undefined) {
      subprocess.stdin.write(options.stdin);
      subprocess.stdin.end();
    }

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);

    return { exitCode, stderr, stdout };
  },
};

if (import.meta.main) {
  try {
    if (process.argv.includes("--cleanup")) {
      const result = await runSkahaAuthCleanup();
      console.log(
        `Skaha auth cleanup complete: Secret ${result.secretName} removed from namespace ${result.namespace}.`,
      );
    } else {
      const result = await runSkahaAuthSetup();
      console.log(
        `Skaha auth setup complete: Secret ${result.secretName} in namespace ${result.namespace}.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
