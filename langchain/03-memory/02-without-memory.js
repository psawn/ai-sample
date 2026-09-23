// =======================================================================
// MEMORY - BƯỚC 2: KHÔNG CÓ MEMORY THÌ SAO?
//
// Model không tự nhớ gì giữa các lần gọi. Mỗi lần invoke() là độc lập.
// -> Hỏi "Tên tôi là gì?" ở lần 2, model không biết vì không có lịch sử.
//
// Cách khắc phục: tự gửi kèm lịch sử mỗi lần gọi (03-all-history.js).
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Chỉ gửi câu hỏi hiện tại, không kèm lịch sử.
async function ask(input) {
  const response = await model.invoke(input);

  console.log(`User: ${input}`);
  console.log(`AI: ${response.content}\n`);
}

// ===== KỊCH BẢN MINH HỌA =====
// Kỳ vọng: câu 2 model không trả lời được tên "An".
async function main() {
  await ask("Xin chào, tôi tên là An.");
  console.log("\n==============================\n");

  await ask("Tên tôi là gì?");
  console.log("\n==============================\n");
}

main();
