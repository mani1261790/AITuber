import {describe,it,expect} from "vitest";
import {speechCaption} from "./speech-caption.ts";
describe("speech captions",()=>{
  const segments=[{text:"モデル",startMs:0,endMs:300},{text:"を動かします。",startMs:300,endMs:1400},{text:"次は質問です。",startMs:1800,endMs:2800}];
  it("groups aligned words and keeps the cue during a short pause",()=>{
    expect(speechCaption(segments,200)).toBe("モデルを動かします。");
    expect(speechCaption(segments,1600)).toBe("モデルを動かします。");
    expect(speechCaption(segments,1900)).toBe("次は質問です。");
    expect(speechCaption(segments,2800)).toBe("");
  });
  it("uses the supplied playback position even when it moves backwards on recovery",()=>{
    expect(speechCaption(segments,2000)).toBe("次は質問です。");
    expect(speechCaption(segments,500)).toBe("モデルを動かします。");
  });
  it("shows technical spelling instead of pronunciation kana",()=>{
    expect(speechCaption([{text:"ラージ・ランゲージ・モデルです。",startMs:0,endMs:3000}],100)).toBe("Large Language Modelです。");
  });
});
