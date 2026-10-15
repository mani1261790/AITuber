import {it,expect} from "vitest";
import {pdfSlideLayout,projectedPdfRegion} from "./pdf-slide-layout.ts";
it("preserves a portrait PDF and maps pointing into the letterboxed page",()=>{
  const layout=pdfSlideLayout(600,900);
  expect(layout).toMatchObject({width:480,height:720,x:400,y:0});
  const region=projectedPdfRegion(layout,{x:0,y:.25,width:1,height:.5});
  expect(region).toEqual({x:.3125,y:.25,width:.375,height:.5,anchorX:.5});
});
it("fits a wide page with top and bottom margins",()=>{
  expect(pdfSlideLayout(1600,400)).toMatchObject({width:1280,height:320,x:0,y:200});
  expect(()=>pdfSlideLayout(0,10)).toThrow();
});
