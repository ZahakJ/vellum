#!/usr/bin/env node
// One command from a clean checkout to an APK in mobile/out/.
//
//   npm run apk:debug     · npm run apk:release
//
// It exists because three things have to be true at once and none of them is
// the default on this machine:
//
//   JAVA_HOME       must point at the JDK 21 next to the SDK. The system java
//                   is newer than the Android Gradle Plugin will accept, and
//                   the failure it gives is a Kotlin/Gradle stack trace that
//                   says nothing about Java versions.
//   ANDROID_HOME    must be set, or Gradle writes a local.properties that then
//                   goes stale on the next machine.
//   www/ must be fresh  — `cap sync` copies the shell into the APK's assets, so
//                   an APK built without it ships whatever was there last time.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const variant = process.argv[2] === "release" ? "release" : "debug";

const JAVA_HOME = process.env.VELLUM_JAVA_HOME ?? join(homedir(), "Android", "jdk-21.0.11+10");
const ANDROID_HOME = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(homedir(), "Android", "Sdk");

if (!existsSync(JAVA_HOME)) {
  console.error(`No JDK at ${JAVA_HOME}. Set VELLUM_JAVA_HOME to a JDK 21.`);
  process.exit(1);
}
if (!existsSync(ANDROID_HOME)) {
  console.error(`No Android SDK at ${ANDROID_HOME}. Set ANDROID_HOME.`);
  process.exit(1);
}

const env = { ...process.env, JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME };
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, env, stdio: "inherit" });

run("npx", ["--no-install", "vite", "build"], ROOT);
run("npx", ["--no-install", "cap", "sync", "android"], ROOT);

const task = variant === "release" ? "assembleRelease" : "assembleDebug";
run("./gradlew", ["--no-daemon", task], join(ROOT, "android"));

// Where AGP leaves it, and what it is called once it is somewhere a person
// would look for it.
const signed = existsSync(join(ROOT, "keystore.properties"));
const builtName =
  variant === "release" ? (signed ? "app-release.apk" : "app-release-unsigned.apk") : "app-debug.apk";
const built = join(ROOT, "android", "app", "build", "outputs", "apk", variant, builtName);

if (!existsSync(built)) {
  console.error(`Gradle succeeded but there is no APK at ${built}.`);
  process.exit(1);
}

const out = join(ROOT, "out");
mkdirSync(out, { recursive: true });
const suffix = variant === "release" && !signed ? "release-unsigned" : variant;
// The release owns the version string: read it from package.json rather than
// pinning it here, which is how a 1.8.0 build once shipped named 1.7.1.
const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const destination = join(out, `vellum-${version}-${suffix}.apk`);
copyFileSync(built, destination);

const mb = (statSync(destination).size / 1024 / 1024).toFixed(2);
console.log(`\n${destination}  (${mb} MB)`);
if (variant === "release" && !signed) {
  console.log("UNSIGNED: no mobile/keystore.properties. See README.md — 'Signing'.");
}
