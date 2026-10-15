import type { Plugin } from "vite";
import {createReadStream} from "node:fs";
import {cp} from "node:fs/promises";
import {createRequire} from "node:module";
import {dirname,join} from "node:path";
export function pdfAssetsPlugin(): Plugin { return {
      name: "pdf-render-assets",
      async writeBundle(options) {
        const root=dirname(createRequire(new URL("../apps/server/package.json",import.meta.url)).resolve("pdfjs-dist/package.json"));
        for(const directory of ["cmaps","standard_fonts","wasm"]) await cp(join(root,directory),join(options.dir ?? "dist","pdfjs",directory),{recursive:true});
      },
      configureServer(server) {
        const root=dirname(createRequire(new URL("../apps/server/package.json",import.meta.url)).resolve("pdfjs-dist/package.json"));
        server.middlewares.use("/pdfjs", (req,res,next) => {
          const match=(req.url ?? "").split("?")[0]?.match(/^\/(cmaps|standard_fonts|wasm)\/([a-zA-Z0-9_.-]+)$/);
          if(!match){next();return;}
          const stream=createReadStream(join(root,match[1]!,match[2]!));
          res.setHeader("content-type",match[2]!.endsWith(".wasm")?"application/wasm":"application/octet-stream");
          stream.on("error",()=>{res.statusCode=404;res.end();});stream.pipe(res);
          res.on("close",()=>stream.destroy());
        });
      },
    }; }
