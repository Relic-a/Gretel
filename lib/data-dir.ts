import path from "node:path";

export function getDataDir() {
  return process.env.GRETEL_DATA_DIR || path.join(process.cwd(), "data");
}
