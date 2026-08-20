require("./_polyfill");
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

const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant."],
  new MessagesPlaceholder("chat_history"),
  ["human", "{input}"],
]);

/**
 * 1. Quản lý chat_history TỰ TAY (Manual)
 * chat_history chỉ là 1 mảng JS bình thường, do MÌNH tự tạo, tự push(), tự truyền vào
 * mỗi lần invoke() - LangChain không đụng vào nó.
 *
 * Cách hoạt động:
 * 1. Tự khai báo `const chatHistory = []`.
 * 2. Mỗi lần hỏi, tự truyền chat_history hiện có vào chain.invoke({ input, chat_history }).
 * 3. Sau khi có câu trả lời, tự push HumanMessage + AIMessage vào lại chatHistory.
 *
 * Ví dụ thật: retrieval-qa/05-conversational-chat.js.
 *
 * Khi nào dùng: Chỉ có 1 cuộc hội thoại, chạy tuần tự trong 1 file - không cần phân biệt
 * nhiều user. Đơn giản, thấy rõ luồng dữ liệu.
 */
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

/**
 * 2. Quản lý chat_history TỰ ĐỘNG (RunnableWithMessageHistory)
 * Không tự tạo mảng, không tự push(), không tự truyền chat_history vào invoke() -
 * RunnableWithMessageHistory làm hộ, dựa theo sessionId.
 *
 * Cách hoạt động:
 * 1. Bọc chain lại bằng RunnableWithMessageHistory, khai báo getMessageHistory(sessionId)
 *    để nó biết lấy/lưu lịch sử ở đâu.
 * 2. Mỗi lần hỏi chỉ cần chainWithHistory.invoke({ input }, { configurable: { sessionId } }).
 * 3. Nó tự lấy lịch sử của đúng sessionId đó gán vào chat_history trước khi gọi chain, và
 *    tự lưu lại câu hỏi + câu trả lời sau khi xong.
 *
 * Ví dụ thật: tool-routing/06-agent-executor.js, tool-routing/07-cli-chatbot.js.
 *
 * Khi nào dùng: Cần quản lý nhiều cuộc hội thoại song song (nhiều user, mỗi người 1
 * sessionId riêng) - không phải tự tay truyền đúng lịch sử ứng với đúng user mỗi lần gọi.
 */
async function demoAuto() {
  const chain = prompt.pipe(model).pipe(new StringOutputParser());

  const messageHistories = {};
  const chainWithHistory = new RunnableWithMessageHistory({
    runnable: chain,
    getMessageHistory: (sessionId) => {
      if (!messageHistories[sessionId]) {
        messageHistories[sessionId] = new InMemoryChatMessageHistory();
      }
      return messageHistories[sessionId];
    },
    inputMessagesKey: "input",
    historyMessagesKey: "chat_history",
  });

  const config = { configurable: { sessionId: "demo-session" } };

  const answer1 = await chainWithHistory.invoke({ input: "Tên tôi là An." }, config);
  const answer2 = await chainWithHistory.invoke({ input: "Tên tôi là gì?" }, config);

  console.log("\n=== Auto (RunnableWithMessageHistory) ===");
  console.log("Q1: Tên tôi là An. -> A1:", answer1);
  console.log("Q2: Tên tôi là gì? -> A2:", answer2);
}

async function main() {
  try {
    await demoManual();
    await demoAuto();
  } catch (error) {
    console.error(error);
  }
}

main();
