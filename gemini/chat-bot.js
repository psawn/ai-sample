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

// Conversation history
let history = [];

function addMessage(role, text) {
  history.push({
    role,
    parts: [{ text }],
  });
}

// Đếm token bằng tokenizer của Gemini.
async function getHistoryTokens() {
  const { totalTokens } = await model.countTokens({
    contents: history,
  });

  return totalTokens;
}

// Xóa các turn cũ nhất cho tới khi đủ token budget.
// Mỗi turn gồm 1 user message + 1 model message.
async function trimHistory() {
  let totalTokens = await getHistoryTokens();

  while (totalTokens > MAX_HISTORY_TOKENS && history.length > 2) {
    // Xóa turn cũ nhất.
    history = history.slice(2);

    totalTokens = await getHistoryTokens();
  }

  return totalTokens;
}

async function logContext() {
  const totalTokens = await getHistoryTokens();

  console.log("\n========== Context ==========");
  console.log(JSON.stringify(history, null, 2));
  console.log(
    `(${history.length} tin nhắn, ${totalTokens}/${MAX_HISTORY_TOKENS} token)`,
  );
  console.log("=============================\n");
}

async function askGemini() {
  // Trim trước khi gửi request để không vượt budget.
  await trimHistory();

  await logContext();

  const result = await model.generateContent({
    contents: history,
  });

  return result.response.text();
}

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

      // Request lỗi → xóa user message vừa thêm.
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
