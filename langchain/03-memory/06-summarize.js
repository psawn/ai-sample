// =======================================================================
// MEMORY - BƯỚC 6: TÓM TẮT LỊCH SỬ (SUMMARY MEMORY)
//
// 1. History vượt MAX_MESSAGES -> dùng chính LLM tóm tắt các message cũ.
// 2. Bản tóm tắt gộp vào SystemMessage, thay cho các message cũ.
//
// - Ưu: vừa giảm token, vừa giữ được thông tin quan trọng (tên, nghề, nơi ở...).
//   Khắc phục nhược điểm "quên" của window memory (04) và token limit (05).
// - Nhược: tốn thêm 1 lần gọi LLM mỗi khi tóm tắt. Chi tiết nhỏ có thể bị mất.
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

const BASE_SYSTEM_PROMPT = "Bạn là AI Assistant thân thiện.";

// Giữ nguyên văn tối đa 4 message gần nhất (không tính SystemMessage).
// Phần cũ hơn được tóm tắt.
const MAX_MESSAGES = 4;

// Bản tóm tắt hội thoại cũ, cập nhật dần mỗi lần tóm tắt.
let summary = "";

const history = [new SystemMessage(BASE_SYSTEM_PROMPT)];

// Tóm tắt các message cũ, gộp với bản tóm tắt trước đó (nếu có).
// Gửi bản tóm tắt cũ kèm theo -> thông tin từ các lần tóm tắt trước không bị mất.
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

  const summaryResponse = await model.invoke(summarizePrompt);
  summary = summaryResponse.content;

  // Ghi bản tóm tắt mới vào SystemMessage đầu tiên.
  history[0] = new SystemMessage(
    `${BASE_SYSTEM_PROMPT}\nTóm tắt hội thoại trước đó: ${summary}`
  );
}

// Hỏi 1 câu. Nếu history quá dài thì tóm tắt phần cũ.
async function ask(input) {
  // Lưu câu hỏi của user.
  history.push(new HumanMessage(input));

  // SystemMessage đã chứa bản tóm tắt -> model vẫn "nhớ" thông tin cũ.
  const response = await model.invoke(history);

  // Lưu câu trả lời của AI.
  history.push(new AIMessage(response.content));

  // Vượt giới hạn -> cắt các message cũ ra, đem đi tóm tắt.
  // Vd: lượt 3, history có 6 message -> cắt 2 message đầu (lượt 1) đi tóm tắt.
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

// ===== KỊCH BẢN MINH HỌA =====
// Kỳ vọng: dù message cũ đã bị cắt, model vẫn trả lời đúng tên, nơi ở, nghề
// nhờ bản tóm tắt.
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
