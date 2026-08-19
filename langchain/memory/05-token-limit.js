require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  HumanMessage,
  AIMessage,
  SystemMessage,
} = require("@langchain/core/messages");

// =======================================================
// Memory Strategy: Giới hạn theo số lượng token
//
// Ý tưởng:
// - Chỉ giữ Conversation History trong một giới hạn token nhất định.
// - Sau mỗi lượt hỏi/đáp, tính tổng số token của history.
// - Nếu vượt giới hạn, xóa dần message cũ nhất cho đến khi
//   tổng token quay về dưới giới hạn.
// - Giúp kiểm soát chi phí tốt hơn so với việc chỉ đếm số lượt hội thoại,
//   vì mỗi message có độ dài (số token) khác nhau.
// =======================================================

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Giới hạn số token tối đa cho phần Conversation History
const MAX_TOKENS = 200;

// Ước lượng số token của một chuỗi text.
// Không dùng tokenizer thật (vd: tiktoken) để giữ ví dụ đơn giản,
// quy ước tạm: trung bình 1 token ~ 4 ký tự.
function countTokens(text) {
  return Math.ceil(text.length / 4);
}

// Tính tổng số token của toàn bộ history
function countHistoryTokens(messages) {
  return messages.reduce((total, msg) => total + countTokens(msg.content), 0);
}

const history = [new SystemMessage("Bạn là AI Assistant thân thiện.")];

async function ask(input) {
  // Lưu câu hỏi của user
  history.push(new HumanMessage(input));

  // Gọi API Gemini, gửi kèm history (đã giới hạn theo MAX_TOKENS) để lấy câu trả lời.
  const response = await model.invoke(history);

  // Lưu câu trả lời của AI
  history.push(new AIMessage(response.content));

  // Cắt bớt history cho đến khi tổng token <= MAX_TOKENS:
  // 1. Giữ lại SystemMessage (không xóa).
  // 2. Xóa dần message cũ nhất, theo đúng thứ tự thời gian.
  while (countHistoryTokens(history) > MAX_TOKENS && history.length > 1) {
    history.splice(1, 1);
  }

  console.log(`\nUser: ${input}`);
  console.log(`AI: ${response.content}`);

  console.log(`\nTổng số token ước lượng: ${countHistoryTokens(history)}`);

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
