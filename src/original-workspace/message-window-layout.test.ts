import { expect, it } from "vitest";
import { messageWindowLayout } from "./message-window-layout";
it("keeps short text compact and expands long or multiline drafts", () => {
  expect(messageWindowLayout({content:"你好"})).toBe("message");
  expect(messageWindowLayout({content:"进度".repeat(80)})).toBe("message-long");
  expect(messageWindowLayout({content:"一\n二\n三\n四"})).toBe("message-long");
});
it("reserves room for attachments", () => {
  expect(messageWindowLayout({content:"截图",attachments:[{id:"image",dataUrl:"",width:1,height:1}]})).toBe("message-attachments");
});
it("reserves space for unresolved recipient reasons and candidates",()=>{
 expect(messageWindowLayout({content:"你好",status:"ready",recipientQuery:"黄家俊"})).toBe("message-long");
});

it("accounts for the narrower 440px composer", () => {
 expect(messageWindowLayout({content:"字".repeat(75)})).toBe("message-long");
});
