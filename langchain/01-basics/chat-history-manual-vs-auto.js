// =======================================================================
// LANGCHAIN BASICS - QUẢN LÝ CHAT HISTORY: TỰ TAY vs TỰ ĐỘNG
//
// Model không tự nhớ. Mỗi lần gọi phải gửi kèm lịch sử chat (chat_history).
// 1. Manual: tự tạo mảng, tự push, tự truyền vào invoke().
// 2. Auto: RunnableWithMessageHistory làm hộ tất cả, theo sessionId.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  ChatPromptTemplate,
  MessagesPlaceholder,
} = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { RunnableWithMessageHistory } = require("@langchain/core/runnables");
const { InMemoryChatMessageHistory } = require("@langchain/core/chat_history");
const { HumanMessage, AIMessage } = require("@langchain/core/messages");

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// MessagesPlaceholder: chỗ trống để chèn cả mảng message lịch sử vào prompt.
// Thứ tự: system -> lịch sử -> câu hỏi mới.
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant."],
  new MessagesPlaceholder("chat_history"),
  ["human", "{input}"],
]);

// ===== CÁCH 1: MANUAL - TỰ QUẢN LÝ chat_history =====
// chat_history chỉ là mảng JS bình thường. LangChain không đụng vào nó.
// 1. Tự khai báo mảng chatHistory.
// 2. Mỗi lần hỏi, tự truyền chatHistory vào invoke().
// 3. Có câu trả lời -> tự push HumanMessage + AIMessage vào mảng.
//
// Khi nào dùng: chỉ 1 cuộc hội thoại, không cần phân biệt nhiều user.
// Ví dụ thật: 08-retrieval-qa/05-conversational-chat.js.
async function demoManual() {
  const chain = prompt.pipe(model).pipe(new StringOutputParser());
  const chatHistory = [];

  const question1 = "Tên tôi là An.";
  const answer1 = await chain.invoke({ input: question1, chat_history: chatHistory });
  chatHistory.push(new HumanMessage(question1), new AIMessage(answer1));

  const question2 = "Tên tôi là gì?";
  const answer2 = await chain.invoke({ input: question2, chat_history: chatHistory });

  console.log("=== Manual (tự tay) ===");
  console.log("Q1:", question1, "-> A1:", answer1);
  console.log("Q2:", question2, "-> A2:", answer2);
}

// ===== CÁCH 2: AUTO - RunnableWithMessageHistory =====
// Không tự tạo mảng, không tự push, không tự truyền chat_history.
// 1. Bọc chain bằng RunnableWithMessageHistory.
// 2. Khai báo getMessageHistory(sessionId): lấy/lưu lịch sử ở đâu.
// 3. Mỗi lần gọi chỉ cần truyền { input } + sessionId.
//    Tự nạp lịch sử trước khi gọi, tự lưu Q&A sau khi xong.
//
// Khi nào dùng: nhiều cuộc hội thoại song song (mỗi user 1 sessionId).
// Ví dụ thật: 11-tool-routing/06-agent-executor.js, 11-tool-routing/07-cli-chatbot.js.
async function demoAuto() {
  const chain = prompt.pipe(model).pipe(new StringOutputParser());

  // Mỗi sessionId có 1 lịch sử riêng, lưu trong RAM (tắt chương trình là mất).
  const messageHistories = {};
  const chainWithHistory = new RunnableWithMessageHistory({
    runnable: chain,
    getMessageHistory: (sessionId) => {
      if (!messageHistories[sessionId]) {
        messageHistories[sessionId] = new InMemoryChatMessageHistory();
      }
      return messageHistories[sessionId];
    },
    inputMessagesKey: "input", // Key chứa câu hỏi mới
    historyMessagesKey: "chat_history", // Key của MessagesPlaceholder trong prompt
  });

  // Cùng sessionId cho cả 2 câu -> câu 2 thấy được câu 1.
  const config = { configurable: { sessionId: "demo-session" } };

  const answer1 = await chainWithHistory.invoke({ input: "Tên tôi là An." }, config);
  const answer2 = await chainWithHistory.invoke({ input: "Tên tôi là gì?" }, config);

  console.log("\n=== Auto (RunnableWithMessageHistory) ===");
  console.log("Q1: Tên tôi là An. -> A1:", answer1);
  console.log("Q2: Tên tôi là gì? -> A2:", answer2);
}

// ===== KỊCH BẢN MINH HỌA =====
// Cả 2 cách đều trả lời đúng "An" ở câu hỏi thứ 2.
async function main() {
  try {
    await demoManual();
    await demoAuto();
  } catch (error) {
    console.error(error);
  }
}

main();
