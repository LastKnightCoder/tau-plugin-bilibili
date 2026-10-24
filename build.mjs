import { buildPortablePluginManifest, PORTABLE_SHARED_MODULES } from "@tau/plugins/portable";
import { build } from "esbuild";
import AdmZip from "adm-zip";
import { mkdir, readFile, writeFile, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
if (!manifest.targets) throw new Error("插件只接受格式 3 作者清单");
if (!/^[a-z0-9][a-z0-9._-]*$/.test(manifest.id))
  throw new Error("插件 ID 应由小写字母、数字、点、横线或下划线组成");
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version)) throw new Error("插件版本无效");
const shared = [...PORTABLE_SHARED_MODULES];
await mkdir("dist", { recursive: true });
const staging = await mkdtemp(path.resolve("dist/.building-"));
const buildId = randomUUID();
const pointer = path.resolve("dist", `.building-pointer-${buildId}`);
try {
  const readme = await readFile("README.md", "utf8");
  if (!readme.trim()) throw new Error("README.md 必须包含插件介绍与使用说明");
  if (
    typeof manifest.description !== "string" ||
    !manifest.description.trim() ||
    manifest.description.length > 160
  )
    throw new Error("manifest.description 必须为1至160字简介");
  await writeFile(path.join(staging, "README.md"), readme);
  for (const name of ["LICENSE", "CHANGELOG.md"]) {
    try {
      await writeFile(path.join(staging, name), await readFile(name));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const result = await build({
    entryPoints: ["src/index.tsx"],
    outfile: path.join(staging, "main.js"),
    bundle: true,
    platform: "browser",
    format: "cjs",
    target: "es2022",
    jsx: "automatic",
    external: shared,
    metafile: true,
    loader: { ".svg": "dataurl" },
    define: {
      __PLUGIN_META__: JSON.stringify({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
      }),
    },
  });
  for (const output of Object.values(result.metafile.outputs)) {
    for (const dependency of output.imports) {
      if (dependency.external && !shared.includes(dependency.path))
        throw new Error(`插件构建包含未支持的外部依赖：${dependency.path}`);
    }
  }
  const styles = Object.keys(result.metafile.outputs).some(file => file.endsWith("main.css"));
  const integrity = {};
  for (const file of ["main.js", ...(styles ? ["main.css"] : [])])
    integrity[file] = createHash("sha256")
      .update(await readFile(path.join(staging, file)))
      .digest("hex");
  await writeFile(
    path.join(staging, "manifest.json"),
    JSON.stringify(buildPortablePluginManifest(manifest, { main: "main.js", integrity, ...(styles ? { styles: "main.css" } : {}) }), null, 2)
  );
  const destination = path.resolve("dist", `${manifest.version}-${buildId}`);
  await rename(staging, destination);
  await writeFile(
    pointer,
    JSON.stringify({
      formatVersion: 1,
      id: manifest.id,
      buildId,
      directory: path.basename(destination),
    })
  );
  await rename(pointer, path.resolve("dist", `tau-build-${manifest.id}.json`));
  const zip = new AdmZip();
  zip.addLocalFolder(destination, manifest.id);
  const archive = path.resolve("dist", `${manifest.id}-${manifest.version}.zip`);
  zip.writeZip(archive);
  console.log(
    `构建完成：${archive}`
  );
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
} finally {
  await rm(pointer, { force: true });
}
