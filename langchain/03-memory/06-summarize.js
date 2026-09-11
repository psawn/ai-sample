require("../_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  HumanMessage,
  AIMessage,
  SystemMessage,
} = require("@langchain/core/messages");

// =======================================================
// Memory Strategy: Tóm tắt lịch sử hội thoại
//
// Ý tưởng:
// - Khi Conversation History quá dài (vượt quá MAX_MESSAGES),
//   dùng chính LLM để tóm tắt các message cũ thành một đoạn ngắn gọn.
// - Bản tóm tắt được gộp vào SystemMessage, thay thế cho các message cũ.
// - Giữ lại thông tin quan trọng (tên, nghề nghiệp, sở thích...)
//   trong khi vẫn giảm được số token cần gửi cho LLM.
// =======================================================

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

const BASE_SYSTEM_PROMPT = "Bạn là AI Assistant thân thiện.";

// Chỉ giữ tối đa 4 message gần nhất (không tính SystemMessage) ở dạng chi tiết,
// phần còn lại sẽ được tóm tắt.
const MAX_MESSAGES = 4;

// Bản tóm tắt hội thoại cũ, sẽ được cập nhật dần theo thời gian
let summary = "";

const history = [new SystemMessage(BASE_SYSTEM_PROMPT)];

// Gọi API Gemini để tóm tắt các message cũ, gộp với bản tóm tắt trước đó (nếu có)
async function summarizeOldMessages(oldMessages) {
  const summarizePrompt = [
    new SystemMessage(
      "Bạn là trợ lý tóm tắt hội thoại. Hãy tóm tắt ngắn gọn, súc tích, " +
        "giữ lại các thông tin quan trọng về user (tên, nghề nghiệp, sở thích, nơi ở...)."
    ),
    new HumanMessage(
      `Bản tóm tắt trước đó (nếu có): ${summary || "(chưa có)"}\n\n` +
        `Các đoạn hội thoại mới cần gộp vào bản tóm tắt:\n` +
        oldMessages
          .map((m) => `${m._getType() === "human" ? "User" : "AI"}: ${m.content}`)
          .join("\n")
    ),
  ];

  // Gọi API Gemini để sinh bản tóm tắt mới.
  const summaryResponse = await model.invoke(summarizePrompt);
  summary = summaryResponse.content;

  // Cập nhật SystemMessage đầu tiên với bản tóm tắt mới nhất
  history[0] = new SystemMessage(
    `${BASE_SYSTEM_PROMPT}\nTóm tắt hội thoại trước đó: ${summary}`
  );
}

async function ask(input) {
  // Lưu câu hỏi của user
  history.push(new HumanMessage(input));

  // Gọi API Gemini, gửi kèm history (SystemMessage đã kèm bản tóm tắt) để lấy câu trả lời.
  const response = await model.invoke(history);

  // Lưu câu trả lời của AI
  history.push(new AIMessage(response.content));

  // Nếu số message chi tiết vượt quá giới hạn, tóm tắt bớt phần cũ
  if (history.length > MAX_MESSAGES + 1) {
    const oldMessages = history.splice(1, history.length - 1 - MAX_MESSAGES);
    await summarizeOldMessages(oldMessages);
  }

  console.log(`\nUser: ${input}`);
  console.log(`AI: ${response.content}`);

  console.log(`\nTóm tắt hiện tại: ${summary || "(chưa có)"}`);

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

  await ask("Tôi thích chơi bóng đá vào cuối tuần.");
  console.log("\n==============================\n");

  await ask("Tên tôi là gì?");
  console.log("\n==============================\n");

  await ask("Tôi sống ở đâu và làm nghề gì?");
  console.log("\n==============================\n");
}

main();
