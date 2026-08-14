// npm run hash-password — prompt for a password (no echo) and print an
// argon2id hash for ADMIN_PASSWORD_HASH in .env. Also works piped:
//   echo -n "secret" | npm run hash-password

import { stdin, stdout, stderr } from "node:process";
import argon2 from "argon2";

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    stderr.write(question);
    stdin.resume();
    stdin.setRawMode?.(true);
    let entered = "";
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          stdin.off("data", onData);
          stdin.setRawMode?.(false);
          stdin.pause();
          stderr.write("\n");
          resolve(entered);
          return;
        }
        if (ch === "\u0003") { // Ctrl-C
          stdin.setRawMode?.(false);
          stderr.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") entered = entered.slice(0, -1);
        else entered += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function readAll(): Promise<string> {
  let data = "";
  for await (const chunk of stdin) data += chunk;
  return data.replace(/\r?\n$/, "");
}

const password = stdin.isTTY ? await promptHidden("Password: ") : await readAll();
if (!password) {
  stderr.write("hash-password: empty password, nothing hashed\n");
  process.exit(1);
}

const hash = await argon2.hash(password, { type: argon2.argon2id });
stdout.write(hash + "\n");
stderr.write("\nAdd to .env:\n  ADMIN_PASSWORD_HASH='" + hash + "'\n");
