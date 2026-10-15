#!/usr/bin/env node
/**
 * OpenRip Full Build Script
 * 
 * This script orchestrates the complete build process:
 * 1. Builds the Electron app with workspace packages
 * 2. Packages everything together with electron-builder

 * 
 * Usage:
 *   node scripts/build-app.js [options]
 * 
 * Options:
 *   --platform [darwin|linux|win32|all]  Target platform (default: current)
 *   --arch [x64|arm64|universal]         Target architecture (default: current)
 *   --skip-sign                          Skip code signing
 *   --publish                            Publish release after build
 *   --draft                              Create draft release
 *   --publish-timeout-ms <number>        Publish/upload request timeout in ms (default: 900000)
 *   --publish-debug                      Enable extra publish diagnostics (electron-builder debug logs)
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, cpSync, rmSync, readdirSync, statSync, chmodSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APP_ROOT = resolve(__dirname, "..");

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    platform: process.platform,
    arch: process.arch,
    cuda: "auto",
    skipSign: false,
    publish: false,
    draft: false,
    publishTimeoutMs: null,
    publishDebug: false,
  };

  const requireValue = (flag, value) => {
    if (!value || String(value).startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--platform":
        config.platform = requireValue("--platform", args[++i]);
        break;
      case "--arch":
        config.arch = requireValue("--arch", args[++i]);
        break;
      case "--skip-sign":
        config.skipSign = true;
        break;
      case "--publish":
        config.publish = true;
        break;
      case "--draft":
        config.draft = true;
        break;
      case "--publish-timeout-ms": {
        const raw = requireValue("--publish-timeout-ms", args[++i]);
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error(`Invalid --publish-timeout-ms value: ${JSON.stringify(raw)}`);
        }
        config.publishTimeoutMs = Math.floor(n);
        break;
      }
      case "--publish-debug":
        config.publishDebug = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return config;
}

function printHelp() {
  console.log(`
OpenRip Build Script

Usage:
  node scripts/build-app.js [options]

Options:
  --platform [darwin|linux|win32|all]  Target platform (default: current)
  --arch [x64|arm64|universal]         Target architecture (default: current)
  --skip-sign                          Skip code signing
  --publish                            Publish release after build
  --draft                              Create draft release
  --publish-timeout-ms <number>        Publish/upload request timeout in ms (default: 900000)
  --publish-debug                      Enable extra publish diagnostics (electron-builder debug logs)
  --help, -h                           Show this help message

Environment Variables:
  APPLE_ID              Apple ID for notarization
  APPLE_APP_SPECIFIC_PASSWORD    App-specific password for notarization
  APPLE_TEAM_ID         Apple Developer Team ID
  APPLE_IDENTITY        Code signing identity (certificate name)
  WINDOWS_CERT_FILE     Path to Windows code signing certificate (.pfx)
  WINDOWS_CERT_PASSWORD Password for the certificate
  GH_TOKEN / GITHUB_TOKEN / GITHUB_RELEASE_TOKEN   GitHub token for publishing releases
  ELECTRON_PUBLISH_TIMEOUT_MS                      Upload/API request timeout in ms (default: 900000)
  DEBUG                                           Set to "electron-builder" to see publish HTTP logs

Examples:
  # Build for current platform
  node scripts/build-app.js

  # Build for macOS with Apple Silicon
  node scripts/build-app.js --platform darwin --arch arm64

  # Build and publish release
  node scripts/build-app.js --publish

  # Publish with a longer timeout (20 minutes)
  node scripts/build-app.js --publish --publish-timeout-ms 1200000

  # Publish with verbose electron-builder logs
  node scripts/build-app.js --publish --publish-debug
`);
}

// Logging utilities
function log(message, type = "info") {
  const prefix = {
    info: "\x1b[34m[INFO]\x1b[0m",
    success: "\x1b[32m[SUCCESS]\x1b[0m",
    warning: "\x1b[33m[WARNING]\x1b[0m",
    error: "\x1b[31m[ERROR]\x1b[0m",
    step: "\x1b[35m[STEP]\x1b[0m",
  };
  console.log(`${prefix[type]} ${message}`);
}

// Run a command and return a promise
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    log(`Running: ${command} ${args.join(" ")}`, "info");
    
    const proc = spawn(command, args, {
      stdio: "inherit",
      shell: true,
      ...options,
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    proc.on("error", reject);
  });
}

// Step 2: Build Electron app packages
async function buildElectronPackages() {
  log("Building Electron app packages...", "step");

  try {
    await runCommand("npm", ["run", "build"], { cwd: APP_ROOT });
    log("Electron packages built successfully", "success");
    return true;
  } catch (error) {
    log(`Failed to build Electron packages: ${error.message}`, "error");
    throw error;
  }
}

// Step 3: Package with electron-builder
async function packageApp(config) {
  log("Packaging application with electron-builder...", "step");

  const args = ["electron-builder", "build", "--config", "electron-builder.cjs"];

  // Platform
  if (config.platform !== process.platform || config.platform === "all") {
    if (config.platform === "all") {
      args.push("--mac", "--win", "--linux");
    } else {
      const platformFlags = {
        darwin: "--mac",
        win32: "--win",
        linux: "--linux",
      };
      args.push(platformFlags[config.platform]);
    }
  }

  // Architecture
  if (config.arch && config.arch !== process.arch) {
    if (config.arch === "universal") {
      args.push("--universal");
    } else {
      args.push("--" + config.arch);
    }
  }

  // Publishing
  if (config.publish) {
    if (config.draft) {
      args.push("--publish", "always", "--prerelease");
    } else {
      args.push("--publish", "always");
    }
  }

  try {
    const env = {
      ...process.env
    };
    // Allow overriding publish timeout from CLI; electron-builder config reads this env var.
    if (config.publishTimeoutMs != null) {
      env.ELECTRON_PUBLISH_TIMEOUT_MS = String(config.publishTimeoutMs);
    }
    if (config.publishDebug) {
      // builder-util-runtime uses debug("electron-builder") for HTTP request/response logs.
      env.DEBUG = env.DEBUG ? `${env.DEBUG},electron-builder` : "electron-builder";
    }
    await runCommand("npx", args, { cwd: APP_ROOT, env });
    log("Application packaged successfully", "success");
    return true;
  } catch (error) {
    log(`Failed to package application: ${error.message}`, "error");
    throw error;
  }
}

// Main build process
async function main() {
  const startTime = Date.now();
  const config = parseArgs();

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                      OpenRip Build                             ║
╠════════════════════════════════════════════════════════════════╣
║  Platform: ${config.platform.padEnd(12)} Architecture: ${config.arch.padEnd(12)}  ║
║  Sign: ${(!config.skipSign).toString().padEnd(16)}  ║
╚════════════════════════════════════════════════════════════════╝
`);

  try {
    // Check prerequisites
    log("Checking prerequisites...", "step");
    
    // Check for Node.js
    try {
      execSync("node --version", { stdio: "ignore" });
    } catch {
      throw new Error("Node.js is required but not installed");
    }

    // Check for npm
    try {
      execSync("npm --version", { stdio: "ignore" });
    } catch {
      throw new Error("npm is required but not installed");
    }

    log("Prerequisites check passed", "success");

    // Build Electron packages
    await buildElectronPackages();

    // Package the app
    await packageApp(config);

    // Calculate duration
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    Build Complete! 🎉                          ║
╠════════════════════════════════════════════════════════════════╣
║  Duration: ${duration} minutes                                      ║
║  Output: ${join(APP_ROOT, "dist").padEnd(45)}║
╚════════════════════════════════════════════════════════════════╝
`);

    // List output files
    log("Build artifacts:", "info");
    const distDir = join(APP_ROOT, "dist");
    if (existsSync(distDir)) {
      const { readdirSync, statSync } = await import("node:fs");
      const files = readdirSync(distDir)
        .filter((f) => !f.startsWith(".") && statSync(join(distDir, f)).isFile())
        .map((f) => {
          const size = (statSync(join(distDir, f)).size / 1024 / 1024).toFixed(2);
          return `  - ${f} (${size} MB)`;
        });
      console.log(files.join("\n"));
    }

  } catch (error) {
    log(`Build failed: ${error.message}`, "error");
    console.error(error);
    process.exit(1);
  }
}

main();

