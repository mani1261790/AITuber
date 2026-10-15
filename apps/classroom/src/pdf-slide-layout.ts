/** Letterbox the original page without changing its aspect ratio. */
export function pdfSlideLayout(width: number, height: number) {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new TypeError("Invalid PDF page size");
  const scale = Math.min(1280 / width, 720 / height);
  const w = width * scale, h = height * scale;
  return {scale, width:w, height:h, x:(1280-w)/2, y:(720-h)/2};
}
export function projectedPdfRegion(layout: ReturnType<typeof pdfSlideLayout>, region: {x:number;y:number;width:number;height:number}) {
  const x=(layout.x+region.x*layout.width)/1280;
  const y=(layout.y+region.y*layout.height)/720;
  const width=region.width*layout.width/1280, height=region.height*layout.height/720;
  return {x,y,width,height,anchorX:x+width/2};
}
