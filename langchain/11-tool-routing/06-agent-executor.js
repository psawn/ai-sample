// =======================================================================
// TOOL ROUTING - BƯỚC 6: AgentExecutor + MEMORY (BẢN CŨ)
//
// Nâng cấp từ 05-routing.js:
// 1. AgentExecutor: tự chạy vòng lặp, đưa kết quả Tool về model tới khi model
//    trả lời xong. Không cần tự viết route().
// 2. Memory: nhớ lịch sử để trả lời câu hỏi nối tiếp.
//    Vd: "tên tôi là bob" -> "tên tôi là gì?".
//
// Flow mỗi câu hỏi:
// 1. Nạp lịch sử chat vào prompt.
// 2. Model chọn Tool -> Tool chạy -> kết quả về model. Lặp tới khi có Final Answer.
// 3. Lưu câu hỏi + câu trả lời vào lịch sử.
//
// Bản API mới (createAgent + checkpointer): 06-agent-executor-createagent.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  ChatPromptTemplate,
  MessagesPlaceholder,
} = require("@langchain/core/prompts");
const { RunnableWithMessageHistory } = require("@langchain/core/runnables");
const { InMemoryChatMessageHistory } = require("@langchain/core/chat_history");
const { AgentExecutor, createToolCallingAgent } = require("@langchain/classic/agents");
const { getCurrentTemperature } = require("./02-weather-tool");
const { searchWikipedia } = require("./03-wikipedia-tool");

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// 2 Tool Agent được dùng: xem nhiệt độ + tra Wikipedia.
const tools = [getCurrentTemperature, searchWikipedia];

// Prompt có 2 chỗ chèn danh sách message, khác nhau ở phạm vi:
// 1. chat_history: các lượt hỏi-đáp đã xong ở những lần invoke() trước.
//    - RunnableWithMessageHistory điền, giữ suốt session.
//    - Vd: câu "tên tôi là gì" cần câu "tên tôi là bob" ở lượt trước.
// 2. agent_scratchpad: các Tool đã gọi + kết quả, trong lần invoke() hiện tại.
//    - AgentExecutor điền, reset mỗi lần invoke().
//    - Vd: "thời tiết ở sf?" -> gọi get_current_temperature -> "20°C"
//      -> vào scratchpad -> model trả lời.
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are helpful but sassy assistant"],
  new MessagesPlaceholder("chat_history"),
  ["human", "{input}"],
  ["placeholder", "{agent_scratchpad}"],
]);

// agent: LLM + Tools + Prompt. Chỉ quyết định bước tiếp theo, không tự chạy Tool.
const agent = createToolCallingAgent({ llm, tools, prompt });

// agentExecutor: vòng lặp chạy agent.
// 1. Gọi agent -> nhận Tool cần gọi.
// 2. Chạy Tool, đưa kết quả vào scratchpad.
// 3. Lặp lại tới khi agent trả Final Answer.
const agentExecutor = new AgentExecutor({
  agent,
  tools,
  verbose: false,
});

// ===== MEMORY: LƯU LỊCH SỬ THEO sessionId =====

// Mỗi sessionId có 1 lịch sử riêng, lưu trong RAM (tắt chương trình là mất).
// - InMemoryChatMessageHistory: class có sẵn, lưu 1 danh sách message.
// - getMessageHistory: hàm tự viết, trả đúng history theo sessionId.
// Muốn lưu bền (Redis, MongoDB, file...): chỉ cần trả về 1 BaseChatMessageHistory khác.
const messageHistories = {};
function getMessageHistory(sessionId) {
  if (!messageHistories[sessionId]) {
    messageHistories[sessionId] = new InMemoryChatMessageHistory();
  }
  return messageHistories[sessionId];
}

// RunnableWithMessageHistory: bọc agentExecutor, tự quản lý chat_history.
// - Trước khi gọi: nạp lịch sử cũ vào "chat_history".
// - Sau khi trả lời: lưu lượt hỏi-đáp mới.
// So sánh cách tự làm tay: ../01-basics/chat-history-manual-vs-auto.js.
const agentWithMemory = new RunnableWithMessageHistory({
  runnable: agentExecutor,
  getMessageHistory,
  inputMessagesKey: "input",
  historyMessagesKey: "chat_history",
});

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // 1 sessionId = 1 cuộc hội thoại.
  // Dùng chung cho cả 3 lượt để agent nhớ ngữ cảnh.
  const config = { configurable: { sessionId: "bob-session" } };

  try {
    // Lượt 1: giới thiệu tên.
    const result1 = await agentWithMemory.invoke(
      { input: "my name is bob" },
      config,
    );
    console.log("\n========== Lượt 1 ==========");
    console.log(result1.output);

    // Lượt 2: hỏi lại tên -> agent phải nhớ "bob" từ lượt 1.
    const result2 = await agentWithMemory.invoke(
      { input: "whats my name" },
      config,
    );
    console.log("\n========== Lượt 2 (agent phải nhớ tên) ==========");
    console.log(result2.output);

    // Lượt 3: hỏi thời tiết -> agent vẫn nhớ ngữ cảnh, và gọi Tool.
    const result3 = await agentWithMemory.invoke(
      { input: "whats the weather in sf?" },
      config,
    );
    console.log(
      "\n========== Lượt 3 (agent vẫn nhớ, và biết gọi tool) ==========",
    );
    console.log(result3.output);

    // Xem history đã lưu: mỗi sessionId có 1 mảng HumanMessage/AIMessage.
    // Chỉ có text hỏi-đáp, không có bước gọi Tool (bản createAgent lưu cả 2).
    console.log("\n========== messageHistories (nội bộ) ==========");
    for (const [sessionId, history] of Object.entries(messageHistories)) {
      console.log(sessionId, ":", await history.getMessages());
    }
  } catch (error) {
    console.error(error);
  }
}

main();
