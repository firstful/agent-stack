import { loadDesired } from "./lib/services";
import { ensureApkBuild } from "./lib/reconcile";

const talaria = loadDesired().find((s: any) => s.name === "talaria");
if (!talaria) {
  console.error("talaria not found");
  process.exit(1);
}
ensureApkBuild(talaria);
