require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  HumanMessage,
  AIMessage,
  SystemMessage,
} = require("@langchain/core/messages");

// =======================================================
// Memory Strategy: Lưu toàn bộ Conversation History
//
// Ý tưởng:
// - Lưu tất cả các message của User và AI.
// - Mỗi lần gọi LLM, gửi toàn bộ History.
// - Dễ cài đặt nhưng History càng dài càng tốn token.
// =======================================================

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Conversation History
const history = [new SystemMessage("Bạn là AI Assistant thân thiện.")];

async function ask(input) {
  // Lưu câu hỏi của user
  history.push(new HumanMessage(input));

  // Gọi API Gemini, gửi kèm toàn bộ history để lấy câu trả lời.
  const response = await model.invoke(history);

  // Lưu câu trả lời của AI
  history.push(new AIMessage(response.content));

  console.log(`\nUser: ${input}`);
  console.log(`AI: ${response.content}`);
}

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
