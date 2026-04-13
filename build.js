// Build script to create an optimized build.
import { mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}`));
    });
  });
}

async function buildDist() {
  await rm("dist", { recursive: true, force: true });
  await mkdir("dist", { recursive: true });

  await run("bun", ["build", "src/index.ts", "--target", "bun", "--outfile", "dist/index.js", "--minify"]);

  await copyFile(".env", "dist/.env");

  const rootPkgRaw = await readFile("package.json", "utf8");
  const rootPkg = JSON.parse(rootPkgRaw);

  const distPkg = {
    name:  "nyx-prod",
    version: rootPkg.version,
    private: rootPkg.private ?? true,
    type: rootPkg.type ?? "module",
    main: "index.js",
    scripts: {
      start: "bun index.js",
    },
    dependencies: rootPkg.dependencies ?? {},
  };

  await writeFile("dist/package.json", `${JSON.stringify(distPkg, null, 2)}\n`, "utf8");

  console.log("Built dist with:");
  console.log("- dist/index.js");
  console.log("- dist/package.json");
  console.log("- dist/.env");
}

buildDist().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
