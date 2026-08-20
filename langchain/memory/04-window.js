require("../_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  HumanMessage,
  AIMessage,
  SystemMessage,
} = require("@langchain/core/messages");

// =======================================================
// Memory Strategy: Chỉ lưu các cuộc hội thoại gần nhất
//
// Ý tưởng:
// - Chỉ giữ k message gần nhất.
// - Message cũ sẽ bị xóa.
// - Giúp giảm số token gửi cho LLM.
// =======================================================

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Chỉ giữ tối đa 4 message gần nhất (không tính SystemMessage)
const MAX_MESSAGES = 4;

const history = [new SystemMessage("Bạn là AI Assistant thân thiện.")];

async function ask(input) {
  // Lưu câu hỏi của user
  history.push(new HumanMessage(input));

  // Gọi API Gemini, gửi kèm history (chỉ giữ k message gần nhất) để lấy câu trả lời.
  const response = await model.invoke(history);

  // Lưu câu trả lời của AI
  history.push(new AIMessage(response.content));

  // Giữ lại SystemMessage + MAX_MESSAGES gần nhất
  while (history.length > MAX_MESSAGES + 1) {
    history.splice(1, 1);
  }

  console.log(`\nUser: ${input}`);
  console.log(`AI: ${response.content}`);

  console.log("\nHistory:");

  console.log(history);
}

async function main() {
  await ask("Xin chào, tôi tên là An.");
  console.log("\n==============================\n");

  await ask("Tôi làm lập trình JavaScript.");
  console.log("\n==============================\n");

  await ask("Tôi sống ở Hà Nội.");
  console.log("\n==============================\n");

  await ask("Tên tôi là gì?");
  console.log("\n==============================\n");

  await ask("Tôi sống ở đâu?");
  console.log("\n==============================\n");
}

main();
