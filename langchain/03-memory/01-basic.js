// =======================================================================
// MEMORY - BƯỚC 1: LƯU LỊCH SỬ HỘI THOẠI CƠ BẢN
//
// InMemoryChatMessageHistory: lưu các message (Human/AI) trong RAM.
// File này không gọi AI, chỉ mô phỏng cách thêm và đọc lại lịch sử.
// =======================================================================

require("../_polyfill");
const { InMemoryChatMessageHistory } = require("@langchain/core/chat_history");
const { HumanMessage, AIMessage } = require("@langchain/core/messages");

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Memory lưu trong RAM (tắt chương trình là mất).
  const history = new InMemoryChatMessageHistory();

  // User gửi tin nhắn.
  await history.addMessage(new HumanMessage("Xin chào, tôi tên là An."));

  // AI trả lời.
  await history.addMessage(new AIMessage("Chào An, rất vui được gặp bạn."));

  // User hỏi tiếp.
  await history.addMessage(new HumanMessage("Tên tôi là gì?"));

  // AI trả lời.
  await history.addMessage(new AIMessage("Tên bạn là An."));

  // Lấy toàn bộ lịch sử hội thoại.
  const messages = await history.getMessages();

  console.log(messages);
}

main();
