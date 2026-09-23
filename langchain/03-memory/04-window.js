// =======================================================================
// MEMORY - BƯỚC 4: CHỈ GIỮ K MESSAGE GẦN NHẤT (WINDOW MEMORY)
//
// 1. Chỉ giữ k message gần nhất, message cũ bị xóa.
// 2. SystemMessage luôn được giữ lại.
//
// - Ưu: số message gửi cho LLM luôn ổn định.
// - Nhược: quên thông tin cũ (vd: tên user nói ở đầu).
//   Message dài ngắn khác nhau nên số token vẫn dao động (cách khắc phục: 05).
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

// Giữ tối đa 4 message gần nhất (không tính SystemMessage).
const MAX_MESSAGES = 4;

const history = [new SystemMessage("Bạn là AI Assistant thân thiện.")];

// Hỏi 1 câu, sau đó cắt history về đúng kích thước cửa sổ.
// Cắt sau khi trả lời -> lượt sau gửi tối đa MAX_MESSAGES message cũ + 1 câu hỏi mới.
async function ask(input) {
  // Lưu câu hỏi của user.
  history.push(new HumanMessage(input));

  const response = await model.invoke(history);

  // Lưu câu trả lời của AI.
  history.push(new AIMessage(response.content));

  // Giữ SystemMessage (vị trí 0) + MAX_MESSAGES gần nhất.
  // splice(1, 1): xóa message cũ nhất, ngay sau SystemMessage.
  while (history.length > MAX_MESSAGES + 1) {
    history.splice(1, 1);
  }

  console.log(`\nUser: ${input}`);
  console.log(`AI: ${response.content}`);

  console.log("\nHistory:");

  console.log(history);
}

// ===== KỊCH BẢN MINH HỌA =====
// Kỳ vọng:
// - Câu "Tên tôi là gì?": message chứa tên "An" đã bị xóa -> model không nhớ tên.
// - Câu "Tôi sống ở đâu?": "Hà Nội" còn trong cửa sổ -> model trả lời đúng.
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
