#!/usr/bin/env node
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pngToIco from "png-to-ico";

const root = process.cwd();
const logo = path.join(root, "logo.png");
const buildDir = path.join(root, "build");

await mkdir(buildDir, { recursive: true });
await copyFile(logo, path.join(buildDir, "icon.png"));
await writeFile(path.join(buildDir, "icon.ico"), await pngToIco(logo));
