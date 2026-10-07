export function pdfAssetOptions(resolveRoot) { const root = resolveRoot(); return { cMapUrl: `${root}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${root}/standard_fonts/` }; }
