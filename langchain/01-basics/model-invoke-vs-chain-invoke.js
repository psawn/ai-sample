// =======================================================================
// LANGCHAIN BASICS - model.invoke() vs chain.invoke()
//
// 1. model.invoke(): tự format prompt -> gọi model -> tự lấy .content.
// 2. chain.invoke(): nối các bước bằng .pipe(), chỉ cần truyền biến của prompt.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

const prompt = ChatPromptTemplate.fromTemplate(
  `Trả lời trong đúng 1 câu: thủ đô của {country} là gì?`,
);

// ===== CÁCH 1: model.invoke() - GỌI TRỰC TIẾP MODEL =====
// Model không nhận object { country }, phải tự format thành messages trước.
// Flow:
// 1. { country } -> prompt.formatMessages() -> messages.
// 2. messages -> model.invoke() -> AIMessage.
// 3. Lấy text từ aiMessage.content.
//
// Khi nào dùng: gọi model 1 lần với input đã chuẩn bị sẵn.
async function demoModelInvoke() {
  // Thay {country} bằng giá trị thật để tạo messages.
  const messages = await prompt.formatMessages({
    country: "Việt Nam",
  });

  // Gọi trực tiếp model với messages đã format.
  const aiMessage = await model.invoke(messages);

  console.log("=== model.invoke ===");
  console.log("Input:  messages đã format");
  console.log("Output: AIMessage →", aiMessage.content);
}

// ===== CÁCH 2: chain.invoke() - NỐI CÁC BƯỚC THÀNH PIPELINE =====
// Pipeline: { country } -> prompt -> model -> StringOutputParser -> string.
// Chain tự lo từng bước, chỉ cần truyền object chứa biến của prompt.
//
// Khi nào dùng: hầu hết trường hợp thực tế, vì ngắn gọn, tự động.
async function demoChainInvoke() {
  const chain = prompt.pipe(model).pipe(new StringOutputParser());

  // Chain tự format prompt -> gọi model -> đổi AIMessage thành string.
  const answer = await chain.invoke({
    country: "Nhật Bản",
  });

  console.log("\n=== chain.invoke ===");
  console.log("Input:  { country }");
  console.log("Output: string →", answer);
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  await demoModelInvoke();
  await demoChainInvoke();
}

main();
