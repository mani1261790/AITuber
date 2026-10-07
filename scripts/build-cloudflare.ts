import { cp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const run=(args: string[])=>{const r=spawnSync("pnpm",args,{stdio:"inherit"});if(r.status!==0)process.exit(r.status??1);};
run(["--filter","@aituber/server...","build"]);
run(["--filter","@aituber/classroom","build"]);
run(["--filter","@aituber/operator","exec","vite","build","--base=/operator/"]);
await rm("dist/cloudflare",{recursive:true,force:true});
await mkdir("dist/cloudflare/operator",{recursive:true});
await cp("apps/classroom/dist","dist/cloudflare",{recursive:true});
await cp("apps/operator/dist","dist/cloudflare/operator",{recursive:true});
// Development-only comparison models and motion labs are not distribution assets.
await rm("dist/cloudflare/models/candidates",{recursive:true,force:true});
await rm("dist/cloudflare/models/tutor.vrm",{force:true});
await rm("dist/cloudflare/models/tutor-refined.vrm",{force:true});
