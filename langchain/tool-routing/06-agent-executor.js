// File này minh hoạ AgentExecutor - bộ phận tự động chạy Agent Loop.
//
// Agent = LLM + Tools
//
// LLM:
//   - Đọc câu hỏi
//   - Quyết định cần làm gì
//   - Chọn Tool nếu cần
//
// Tool:
//   - Thực hiện công việc mà LLM yêu cầu
//
// Flow:
//   User → LLM → chọn Tool → Tool thực thi → kết quả → LLM → Final Answer
//
// AgentExecutor tự lặp gọi Tool cho tới khi model trả lời xong (không cần tự viết vòng
// lặp bằng tay như route() ở 05-routing.js).
//
// File này còn thêm memory (nhớ lịch sử hội thoại) để agent trả lời đúng các câu hỏi nối
// tiếp nhau, vd: "tên tôi là bob" -> "tên tôi là gì?".
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

const tools = [getCurrentTemperature, searchWikipedia];

// "chat_history" và "agent_scratchpad" đều là danh sách message, nhưng trả lời 2 câu hỏi
// khác nhau:
//
// "chat_history" = "Trước đó chúng ta đã nói gì?"
//   - Là các lượt hỏi-đáp đã XONG ở những lần invoke() trước.
//   - Do RunnableWithMessageHistory quản lý (xem bên dưới), tồn tại xuyên suốt session.
//   - Vd: câu trước hỏi "tên tôi là bob", câu sau hỏi "tên tôi là gì" thì cần
//     chat_history mới trả lời đúng.
//
// "agent_scratchpad" = "Trong lần xử lý này, agent đã làm những gì?"
//   - Để trả lời 1 câu hỏi, agent có thể phải gọi tool nhiều bước (gọi tool -> xem kết
//     quả -> gọi tiếp hoặc trả lời). Đây là nơi lưu "đã gọi tool nào, kết quả gì".
//   - Do AgentExecutor tự tạo và xoá sau mỗi lần invoke(), KHÔNG tồn tại giữa các câu hỏi.
//   - Vd: hỏi "thời tiết ở sf?"
//       1. agent gọi get_current_temperature(sf)
//       2. nhận về "20°C"
//       3. lưu bước này vào scratchpad
//       4. trả lời user
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are helpful but sassy assistant"],
  new MessagesPlaceholder("chat_history"),
  ["human", "{input}"],
  ["placeholder", "{agent_scratchpad}"],
]);

// agent = LLM được cấu hình để dùng Tools và quyết định action (không tự chạy tool).
const agent = createToolCallingAgent({ llm, tools, prompt });

// agentExecutor = chạy Agent Loop, tự thực thi action của agent cho tới khi có Final Answer:
// 1. Gọi agent.
// 2. Nếu agent muốn gọi tool (vd: get_current_temperature) thì tự thực thi tool đó.
// 3. Đưa kết quả về cho agent.
// 4. Lặp lại từ bước 1 tới khi agent trả lời xong.
const agentExecutor = new AgentExecutor({
  agent,
  tools,
  verbose: false,
});

// Mỗi sessionId có 1 lịch sử hội thoại riêng, lưu trong RAM (mất khi tắt chương trình).
//
// InMemoryChatMessageHistory = class có sẵn của LangChain, chỉ để lưu 1 danh sách message.
// getMessageHistory (hàm bên dưới) là hàm TỰ VIẾT, chỉ để nối sessionId với đúng instance
// InMemoryChatMessageHistory tương ứng - không phải API bắt buộc của LangChain.
//
// Có thể đổi logic lưu trữ bên trong (vd: Redis, MongoDB, file...) tuỳ ý, miễn hàm trả về
// đúng 1 object implement BaseChatMessageHistory.
const messageHistories = {};
function getMessageHistory(sessionId) {
  if (!messageHistories[sessionId]) {
    messageHistories[sessionId] = new InMemoryChatMessageHistory();
  }
  return messageHistories[sessionId];
}

// RunnableWithMessageHistory: bọc agentExecutor lại để tự quản lý "chat_history".
//   - Trước khi gọi agent: tự lấy lịch sử cũ, đưa vào "chat_history".
//   - Sau khi agent trả lời: tự lưu lượt hỏi-đáp mới vào lại lịch sử.
//   - Đây là cách quản lý TỰ ĐỘNG (khác với cách TỰ TAY - so sánh 2 cách ở
//     ../chat-history-manual-vs-auto.js).
const agentWithMemory = new RunnableWithMessageHistory({
  runnable: agentExecutor,
  getMessageHistory,
  inputMessagesKey: "input",
  historyMessagesKey: "chat_history",
});

async function main() {
  // 1 sessionId = 1 cuộc hội thoại
  // -> dùng lại sessionId đó cho toàn bộ cuộc trò chuyện
  // -> agentWithMemory sẽ nhớ được ngữ cảnh giữa các câu hỏi.
  const config = { configurable: { sessionId: "bob-session" } };

  try {
    const result1 = await agentWithMemory.invoke(
      { input: "my name is bob" },
      config,
    );
    console.log("\n========== Lượt 1 ==========");
    console.log(result1.output);

    const result2 = await agentWithMemory.invoke(
      { input: "whats my name" },
      config,
    );
    console.log("\n========== Lượt 2 (agent phải nhớ tên) ==========");
    console.log(result2.output);

    const result3 = await agentWithMemory.invoke(
      { input: "whats the weather in sf?" },
      config,
    );
    console.log(
      "\n========== Lượt 3 (agent vẫn nhớ, và biết gọi tool) ==========",
    );
    console.log(result3.output);

    // Log lại messageHistories để xem RunnableWithMessageHistory đã tự lưu những gì sau
    // 3 lượt hỏi-đáp ở trên - mỗi sessionId ứng với 1 mảng HumanMessage/AIMessage riêng.
    console.log("\n========== messageHistories (nội bộ) ==========");
    for (const [sessionId, history] of Object.entries(messageHistories)) {
      console.log(sessionId, ":", await history.getMessages());
    }
  } catch (error) {
    console.error(error);
  }
}

main();
