import { runtime } from './context';

// PDF.js 6 uses a single binary factory for CMaps and standard fonts.
// Read them through the asset binding: Node's default factory expects disk files.
class BinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const directory = kind === 'cMapUrl' ? 'cmaps' : kind === 'standardFontDataUrl' ? 'standard_fonts' : undefined;
    if (!directory || !/^[\w.-]+$/.test(filename)) throw new Error('Unsupported PDF asset');
    const response = await runtime().assets.fetch(new Request(`https://assets.internal/pdfjs/${directory}/${filename}`));
    if (!response.ok) throw new Error(`PDF asset unavailable: ${filename}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

export function pdfAssetOptions() {
  return {
    useSystemFonts: true, disableFontFace: true, isEvalSupported: false,
    useWorkerFetch: false, BinaryDataFactory, cMapPacked: true,
    cMapUrl: 'https://assets.internal/pdfjs/cmaps/',
    standardFontDataUrl: 'https://assets.internal/pdfjs/standard_fonts/',
  };
}
