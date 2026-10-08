import { cp, mkdir, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
const run=(args: string[])=>{const r=spawnSync("pnpm",args,{stdio:"inherit"});if(r.status!==0)process.exit(r.status??1);};
run(["--filter","@aituber/server...","build"]);
run(["--filter","@aituber/classroom","build"]);
run(["--filter","@aituber/operator","exec","vite","build","--base=/operator/"]);
await rm("dist/cloudflare",{recursive:true,force:true});
await mkdir("dist/cloudflare/operator",{recursive:true});
await cp("apps/classroom/dist","dist/cloudflare",{recursive:true});
await cp("apps/operator/dist","dist/cloudflare/operator",{recursive:true});
// Downloaded local candidate models are not distribution assets.
// Keep the original/refined teacher models for the hosted motion lab.
await rm("dist/cloudflare/models/candidates",{recursive:true,force:true});

const hostedTeacher = await stat("dist/cloudflare/models/teacher-floral-v9.vrm");
if(hostedTeacher.size > 25*1024*1024) throw new Error("Hosted teacher exceeds the static asset size limit");
await stat("dist/cloudflare/models/teacher-floral-v9-NOTICE.md");

// Japanese PDF extraction uses private binding requests to these static CMaps/fonts.
const requireServer = createRequire(new URL("../apps/server/package.json", import.meta.url));
const pdfRoot = dirname(requireServer.resolve("pdfjs-dist/package.json"));
await cp(join(pdfRoot,"cmaps"),"dist/cloudflare/pdfjs/cmaps",{recursive:true});
await cp(join(pdfRoot,"standard_fonts"),"dist/cloudflare/pdfjs/standard_fonts",{recursive:true});
