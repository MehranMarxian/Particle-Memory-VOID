/**
 * Deploy the landing page and the built app to GitHub Pages.
 *
 * Layout it publishes (the Pages root carries the landing page, the app sits
 * beside it so the landing page can embed it):
 *
 *   /            landing/index.html   (with the version stamped in)
 *   /app/        the built app        (dist/)
 *   /void-logo.png, /icons/           shared artwork for the landing page
 *
 * Usage:  node scripts/deploy-pages.mjs
 * The Pages site must be set to serve the `gh-pages` branch at the repo root.
 */
import { execFileSync } from "node:child_process";
import { cpSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const staging = join(root, ".openclaw", "tmp", "ghpages");
/** git is called without a shell so arguments with spaces stay intact; npm needs one on Windows. */
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: root }).toString().trim();
const userName = execFileSync("git", ["config", "user.name"], { cwd: root }).toString().trim() || "VOID";
const userEmail = execFileSync("git", ["config", "user.email"], { cwd: root }).toString().trim() || "void@localhost";

console.log(`deploying VOID ${version} to GitHub Pages`);
run("npm", ["run", "build"], { shell: true });

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

// The app, one level in.
cpSync(join(root, "dist"), join(staging, "app"), { recursive: true });

// The landing page at the root, with the version stamped in.
const landing = readFileSync(join(root, "landing", "index.html"), "utf8").replaceAll("{{VERSION}}", version);
writeFileSync(join(staging, "index.html"), landing, "utf8");

// Shared artwork for the landing page (logo + icons) at the site root.
copyFileSync(join(root, "dist", "void-logo.png"), join(staging, "void-logo.png"));
cpSync(join(root, "dist", "icons"), join(staging, "icons"), { recursive: true });

// Pages runs Jekyll by default; this keeps the files exactly as built.
writeFileSync(join(staging, ".nojekyll"), "", "utf8");

run("git", ["init", "-b", "gh-pages"], { cwd: staging });
run("git", ["add", "-A"], { cwd: staging });
run("git", ["-c", `user.name=${userName}`, "-c", `user.email=${userEmail}`, "commit", "-m", `site: VOID ${version}`], { cwd: staging });
run("git", ["remote", "add", "origin", remote], { cwd: staging });
run("git", ["push", "-f", "origin", "gh-pages"], { cwd: staging });

console.log("pushed gh-pages: landing at the root, app in /app/");
