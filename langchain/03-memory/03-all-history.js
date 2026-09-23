// =======================================================================
// MEMORY - BƯỚC 3: LƯU TOÀN BỘ LỊCH SỬ (BUFFER MEMORY)
//
// 1. Lưu tất cả message của user và AI vào mảng history.
// 2. Mỗi lần gọi LLM, gửi kèm toàn bộ history.
//
// - Ưu: dễ cài đặt, model nhớ đầy đủ.
// - Nhược: history càng dài càng tốn token, tới lúc vượt context window.
//
// Các cách giới hạn history: 04 (theo số message), 05 (theo token), 06 (tóm tắt).
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  HumanMessage,
  AIMessage,
  SystemMessage,
} = require("@langchain/core/messages");

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Lịch sử hội thoại, bắt đầu bằng SystemMessage.
const history = [new SystemMessage("Bạn là AI Assistant thân thiện.")];

// Hỏi 1 câu, gửi kèm toàn bộ history.
async function ask(input) {
  // Lưu câu hỏi của user.
  history.push(new HumanMessage(input));

  const response = await model.invoke(history);

  // Lưu câu trả lời của AI.
  history.push(new AIMessage(response.content));

  console.log(`\nUser: ${input}`);
  console.log(`AI: ${response.content}`);
}

// ===== KỊCH BẢN MINH HỌA =====
// Kỳ vọng: model trả lời đúng tên và nghề vì có đủ lịch sử.
async function main() {
  await ask("Xin chào, tôi tên là An.");
  console.log("\n==============================\n");

  await ask("Tôi làm lập trình JavaScript.");
  console.log("\n==============================\n");

  await ask("Tên tôi là gì?");
  console.log("\n==============================\n");
  await ask("Tôi làm ngôn ngữ gì?");

  console.log("\n===== Conversation History =====");

  console.log(history);
}

main();
