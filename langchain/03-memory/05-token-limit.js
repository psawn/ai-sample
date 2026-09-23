// =======================================================================
// MEMORY - BƯỚC 5: GIỚI HẠN THEO SỐ TOKEN (TOKEN BUFFER MEMORY)
//
// 1. Sau mỗi lượt hỏi-đáp, tính tổng token của history.
// 2. Vượt MAX_TOKENS -> xóa dần message cũ nhất tới khi đủ giới hạn.
//
// Kiểm soát chi phí tốt hơn window memory (04, đếm số message),
// vì mỗi message dài ngắn khác nhau.
// Nhược điểm vẫn như 04: quên thông tin cũ.
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

// Số token tối đa cho history.
const MAX_TOKENS = 200;

// Ước lượng số token: 1 token ≈ 4 ký tự (quy ước cho tiếng Anh).
// Tiếng Việt có dấu thường tốn nhiều token hơn -> số thật cao hơn.
// Không dùng tokenizer thật (vd: tiktoken, xem ../04-document-processing/05-token-splitting.js)
// để ví dụ đơn giản.
function countTokens(text) {
  return Math.ceil(text.length / 4);
}

// Tính tổng token của toàn bộ history (tính cả SystemMessage).
function countHistoryTokens(messages) {
  return messages.reduce((total, msg) => total + countTokens(msg.content), 0);
}

const history = [new SystemMessage("Bạn là AI Assistant thân thiện.")];

// Hỏi 1 câu, sau đó cắt history về dưới MAX_TOKENS.
async function ask(input) {
  // Lưu câu hỏi của user.
  history.push(new HumanMessage(input));

  const response = await model.invoke(history);

  // Lưu câu trả lời của AI.
  history.push(new AIMessage(response.content));

  // Cắt history tới khi tổng token <= MAX_TOKENS:
  // giữ SystemMessage, xóa dần message cũ nhất.
  // history.length > 1: chỉ còn SystemMessage thì dừng, không xóa nó.
  while (countHistoryTokens(history) > MAX_TOKENS && history.length > 1) {
    history.splice(1, 1);
  }

  console.log(`\nUser: ${input}`);
  console.log(`AI: ${response.content}`);

  console.log(`\nTổng số token ước lượng: ${countHistoryTokens(history)}`);

  console.log("\nHistory:");

  console.log(history);
}

// ===== KỊCH BẢN MINH HỌA =====
// Theo dõi "Tổng số token ước lượng" để thấy message cũ bị xóa khi vượt giới hạn.
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
