import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import {
  type CommandRunner,
  createTerminalSkahaAuthPrompter,
  runSkahaAuthCleanup,
  runSkahaAuthSetup,
  type SkahaAuthPrompter,
} from "../scripts/skaha-auth";

describe("skaha-auth-setup command", () => {
  test("is exposed as skaha-auth-setup and not skaha-auth", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["skaha-auth-setup"]).toBe("bun run scripts/skaha-auth.ts");
    expect(packageJson.scripts["skaha-auth-cleanup"]).toBe(
      "bun run scripts/skaha-auth.ts --cleanup",
    );
    expect(packageJson.scripts).not.toHaveProperty("skaha-auth-cleaup");
    expect(packageJson.scripts).not.toHaveProperty("skaha-auth");
  });

  test("applies username and password as the Skaha auth Kubernetes Secret without logging in", async () => {
    const commands: RecordedCommand[] = [];
    const originalFetch = globalThis.fetch;
    let loginWasAttempted = false;
    globalThis.fetch = Object.assign(
      async () => {
        loginWasAttempted = true;
        return new Response("unexpected-login-token", { status: 200 });
      },
      { preconnect: originalFetch.preconnect },
    );

    let result: Awaited<ReturnType<typeof runSkahaAuthSetup>>;
    try {
      result = await runSkahaAuthSetup({
        prompter: promptCredentials({ password: "test-password", username: "test-user" }),
        runner: recordCommands(commands),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(result).toEqual({
      namespace: "canfar-perfpulse",
      secretName: "perfpulse-skaha-auth",
    });
    expect(loginWasAttempted).toBe(false);
    expect(commands).toEqual([
      {
        args: ["apply", "--namespace", "canfar-perfpulse", "--filename", "-"],
        command: "kubectl",
        stdin: [
          "apiVersion: v1",
          "kind: Secret",
          "metadata:",
          "  name: perfpulse-skaha-auth",
          "  namespace: canfar-perfpulse",
          "type: Opaque",
          "data:",
          `  username: ${Buffer.from("test-user", "utf8").toString("base64")}`,
          `  password: ${Buffer.from("test-password", "utf8").toString("base64")}`,
          "",
        ].join("\n"),
      },
    ]);
    expect(JSON.stringify(commands[0]?.args)).not.toContain("test-password");
    expect(commands[0]?.stdin).not.toContain("test-password");
    expect(commands[0]?.stdin).not.toContain("test-user");
    expect(commands[0]?.stdin).not.toContain("token:");
    expect(JSON.stringify(result)).not.toContain("test-password");
  });

  test("rejects an empty username before applying a Kubernetes Secret", async () => {
    const commands: RecordedCommand[] = [];

    await expect(
      runSkahaAuthSetup({
        prompter: promptCredentials({ password: "test-password", username: " " }),
        runner: recordCommands(commands),
      }),
    ).rejects.toThrow("Skaha username must not be empty");

    expect(commands).toEqual([]);
  });

  test("rejects an empty password before applying a Kubernetes Secret", async () => {
    const commands: RecordedCommand[] = [];

    await expect(
      runSkahaAuthSetup({
        prompter: promptCredentials({ password: "", username: "test-user" }),
        runner: recordCommands(commands),
      }),
    ).rejects.toThrow("Skaha password must not be empty");

    expect(commands).toEqual([]);
  });

  test("refuses to echo a password when stdin is not an interactive TTY", async () => {
    const prompter = createTerminalSkahaAuthPrompter(
      { isTTY: false } as never,
      { write: () => true } as never,
    );

    await expect(prompter.promptPassword()).rejects.toThrow(
      "Skaha password prompt requires an interactive TTY",
    );
  });

  test("refuses to wait for a username when stdin is not an interactive TTY", async () => {
    const prompter = createTerminalSkahaAuthPrompter(
      { isTTY: false } as never,
      { write: () => true } as never,
    );

    await expect(prompter.promptUsername()).rejects.toThrow(
      "Skaha username prompt requires an interactive TTY",
    );
  });

  test("pauses raw stdin after hidden password entry so the command can exit", async () => {
    const input = new FakeRawModeInput();
    const output = new FakeOutput();
    const prompter = createTerminalSkahaAuthPrompter(input as never, output as never);

    const password = prompter.promptPassword();
    input.emit("test-password\r");

    await expect(password).resolves.toBe("test-password");
    expect(input.actions).toContain("pause");
    expect(input.actions.indexOf("pause")).toBeGreaterThan(
      input.actions.indexOf("setRawMode:false"),
    );
  });

  test("deletes the Skaha auth Secret created by setup", async () => {
    const commands: RecordedCommand[] = [];

    const result = await runSkahaAuthCleanup({
      runner: recordCommands(commands),
    });

    expect(result).toEqual({
      namespace: "canfar-perfpulse",
      secretName: "perfpulse-skaha-auth",
    });
    expect(commands).toEqual([
      {
        args: [
          "delete",
          "secret",
          "perfpulse-skaha-auth",
          "--namespace",
          "canfar-perfpulse",
          "--ignore-not-found=true",
        ],
        command: "kubectl",
      },
    ]);
  });
});

interface RecordedCommand {
  args: readonly string[];
  command: string;
  stdin?: string;
}

function promptCredentials(credentials: { password: string; username: string }): SkahaAuthPrompter {
  return {
    async promptPassword() {
      return credentials.password;
    },
    async promptUsername() {
      return credentials.username;
    },
  };
}

function recordCommands(commands: RecordedCommand[]): CommandRunner {
  return {
    async run(command, args, options) {
      commands.push(
        options?.stdin === undefined ? { args, command } : { args, command, stdin: options.stdin },
      );

      return { exitCode: 0, stderr: "", stdout: "" };
    },
  };
}

class FakeRawModeInput {
  readonly actions: string[] = [];
  readonly isTTY = true;
  private listener: ((chunk: Buffer) => void) | undefined;

  emit(text: string): void {
    this.listener?.(Buffer.from(text, "utf8"));
  }

  off(eventName: "data", listener: (chunk: Buffer) => void): this {
    this.actions.push(`off:${eventName}`);
    if (this.listener === listener) {
      this.listener = undefined;
    }
    return this;
  }

  on(eventName: "data", listener: (chunk: Buffer) => void): this {
    this.actions.push(`on:${eventName}`);
    this.listener = listener;
    return this;
  }

  pause(): this {
    this.actions.push("pause");
    return this;
  }

  resume(): this {
    this.actions.push("resume");
    return this;
  }

  setRawMode(mode: boolean): this {
    this.actions.push(`setRawMode:${mode}`);
    return this;
  }
}

class FakeOutput {
  readonly chunks: string[] = [];

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
}
