require("./_polyfill");
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

/**
 * 1. model.invoke() — Gọi trực tiếp model.
 *
 * Model không tự nhận object { country: "Việt Nam" } để điền vào prompt.
 * Ta phải tự format prompt thành messages trước, rồi truyền messages cho model.
 *
 * Flow:
 * { country } → prompt.formatMessages() → messages → model.invoke() → AIMessage
 *
 * Output của model là AIMessage, nên nội dung text nằm trong aiMessage.content.
 *
 * Khi nào dùng: gọi model 1 lần với input đã chuẩn bị sẵn, không cần ghép nhiều bước.
 */
async function demoModelInvoke() {
  // Thay {country} bằng giá trị thực để tạo messages.
  const messages = await prompt.formatMessages({
    country: "Việt Nam",
  });

  // Gọi trực tiếp model với messages đã được format.
  const aiMessage = await model.invoke(messages);

  console.log("=== model.invoke ===");
  console.log("Input:  messages đã format");
  console.log("Output: AIMessage →", aiMessage.content);
}

/**
 * 2. chain.invoke() — Nối nhiều bước thành một pipeline.
 *
 * Thay vì tự format prompt → gọi model → lấy content,
 * LangChain cho phép nối các bước bằng .pipe().
 *
 * Pipeline:
 * { country } → prompt → model → StringOutputParser → string
 *
 * Vì pipeline đã biết cách xử lý từng bước nên khi invoke(),
 * ta chỉ cần truyền object chứa các biến của prompt.
 *
 * Khi nào dùng: hầu hết trường hợp thực tế, vì ngắn gọn và tự động hoá các bước lặp lại.
 */
async function demoChainInvoke() {
  const chain = prompt.pipe(model).pipe(new StringOutputParser());

  // Chain tự format prompt → gọi model → chuyển AIMessage thành string.
  const answer = await chain.invoke({
    country: "Nhật Bản",
  });

  console.log("\n=== chain.invoke ===");
  console.log("Input:  { country }");
  console.log("Output: string →", answer);
}

async function main() {
  await demoModelInvoke();
  await demoChainInvoke();
}

main();
