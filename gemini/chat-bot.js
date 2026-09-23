// =======================================================================
// GEMINI - CHATBOT CLI CÓ NHỚ LỊCH SỬ
//
// 1. Model không tự nhớ gì. Mỗi lượt phải gửi lại toàn bộ history.
// 2. History dài dần -> tốn token. Nên đặt token budget (MAX_HISTORY_TOKENS).
// 3. Vượt budget -> xóa các turn cũ nhất (sliding window theo token).
//
// Bản LangChain cùng ý tưởng: ../langchain/03-memory/05-token-limit.js.
// =======================================================================

require("dotenv").config();
const readline = require("readline");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = "gemini-3.5-flash";

const SYSTEM_INSTRUCTION =
  "You are a helpful assistant. Always answer in Vietnamese.";

// Token budget tối đa cho conversation history.
const MAX_HISTORY_TOKENS = 4000;

const genAI = new GoogleGenerativeAI(API_KEY);

const model = genAI.getGenerativeModel({
  model: MODEL_NAME,
  systemInstruction: SYSTEM_INSTRUCTION,
  generationConfig: {
    temperature: 0.7,
  },
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Lịch sử hội thoại, gửi kèm mỗi lần gọi model.
let history = [];

// Thêm 1 message vào history theo format của Gemini: { role, parts: [{ text }] }.
// role: "user" hoặc "model" (không phải "assistant" như OpenAI).
function addMessage(role, text) {
  history.push({
    role,
    parts: [{ text }],
  });
}

// Đếm token bằng tokenizer của Gemini: chính xác, nhưng mỗi lần đếm = 1 API call.
async function getHistoryTokens() {
  const { totalTokens } = await model.countTokens({
    contents: history,
  });

  return totalTokens;
}

// Xóa các turn cũ nhất tới khi đủ token budget.
// Mỗi turn gồm 1 user message + 1 model message -> xóa 2 phần tử 1 lần,
// để history luôn bắt đầu bằng "user".
// history.length > 2: luôn giữ lại câu hỏi mới nhất.
async function trimHistory() {
  let totalTokens = await getHistoryTokens();

  while (totalTokens > MAX_HISTORY_TOKENS && history.length > 2) {
    // Xóa turn cũ nhất.
    history = history.slice(2);

    totalTokens = await getHistoryTokens();
  }

  return totalTokens;
}

// In history hiện tại và số token đã dùng.
async function logContext() {
  const totalTokens = await getHistoryTokens();

  console.log("\n========== Context ==========");
  console.log(JSON.stringify(history, null, 2));
  console.log(
    `(${history.length} tin nhắn, ${totalTokens}/${MAX_HISTORY_TOKENS} token)`,
  );
  console.log("=============================\n");
}

// Gửi toàn bộ history lên Gemini, trả câu trả lời.
async function askGemini() {
  // Trim trước khi gửi request, để không vượt budget.
  await trimHistory();

  await logContext();

  const result = await model.generateContent({
    contents: history,
  });

  return result.response.text();
}

// Vòng lặp chat: hỏi -> gọi model -> in kết quả -> hỏi tiếp.
function chat() {
  rl.question("\nBạn: ", async (input) => {
    if (input.trim().toLowerCase() === "exit") {
      console.log("\nTạm biệt!");
      rl.close();
      return;
    }

    // Thêm câu hỏi vào history.
    addMessage("user", input);

    try {
      console.log("Gemini đang suy nghĩ...\n");

      const answer = await askGemini();

      console.log("Gemini:", answer);

      // Chỉ lưu response khi request thành công.
      addMessage("model", answer);
    } catch (error) {
      console.error("Lỗi:", error.message ?? error);

      // Request lỗi -> xóa user message vừa thêm.
      history.pop();
    }

    chat();
  });
}

console.log("===== Simple Gemini Chatbot =====");

console.log(
  `Gõ 'exit' để thoát. (Ngân sách context: ${MAX_HISTORY_TOKENS} token)`,
);

chat();
