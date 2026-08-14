const { InMemoryChatMessageHistory } = require("@langchain/core/chat_history");
const { HumanMessage, AIMessage } = require("@langchain/core/messages");

// Code không gọi AI. Chỉ mô phỏng việc lưu lịch sử hội thoại.
async function main() {
  // Tạo một Memory lưu trong RAM.
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
