// File này minh hoạ chatbot terminal dùng Agent + AgentExecutor + memory.
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
// Chatbot hỏi đáp qua terminal, cùng pattern agent + memory như 06-agent-executor.js.
// Bản Python gốc dùng thư viện Panel để vẽ giao diện web - ở đây thay bằng vòng lặp
// readline trên terminal (giống retrieval-qa/06-cli-chatbot.js), vì Panel không có bản
// tương đương trong Node.js.
require("dotenv").config();

const readline = require("readline");
const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  ChatPromptTemplate,
  MessagesPlaceholder,
} = require("@langchain/core/prompts");
const { RunnableWithMessageHistory } = require("@langchain/core/runnables");
const { InMemoryChatMessageHistory } = require("@langchain/core/chat_history");
const { AgentExecutor, createToolCallingAgent } = require("langchain/agents");
const { getCurrentTemperature } = require("./02-weather-tool");
const { searchWikipedia } = require("./03-wikipedia-tool");

// Tool tự viết để minh hoạ: nhận 1 chuỗi, trả về chuỗi đã đảo ngược. Muốn tool làm gì thì
// viết logic vào đây.
const createYourOwn = tool(
  async (query) => query.split("").reverse().join(""),
  {
    name: "create_your_own",
    description:
      "This function can do whatever you would like once you fill it in",
    schema: z.string(),
  },
);

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

const tools = [getCurrentTemperature, searchWikipedia, createYourOwn];

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
// 2. Nếu agent muốn gọi tool (vd: search_wikipedia) thì tự thực thi tool đó.
// 3. Đưa kết quả về cho agent.
// 4. Lặp lại từ bước 1 tới khi agent trả lời xong.
const agentExecutor = new AgentExecutor({ agent, tools, verbose: false });

// RunnableWithMessageHistory quản lý chat_history TỰ ĐỘNG
// So sánh với cách quản lý chat_history thủ công -> xem ../chat-history-manual-vs-auto.js.
const history = new InMemoryChatMessageHistory();
const agentWithMemory = new RunnableWithMessageHistory({
  runnable: agentExecutor,
  getMessageHistory: () => history,
  inputMessagesKey: "input",
  historyMessagesKey: "chat_history",
});

// 1 sessionId = 1 cuộc hội thoại
// -> dùng lại sessionId đó cho toàn bộ cuộc trò chuyện
// -> agentWithMemory sẽ nhớ được ngữ cảnh giữa các câu hỏi.
const config = { configurable: { sessionId: "cli-session" } };

async function main() {
  console.log("QnA_Bot - gõ câu hỏi rồi Enter, gõ 'exit' để thoát.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askLoop = () => {
    rl.question("User: ", async (query) => {
      if (query.trim().toLowerCase() === "exit") {
        rl.close();
        return;
      }

      try {
        const result = await agentWithMemory.invoke({ input: query }, config);
        console.log("ChatBot:", result.output, "\n");
      } catch (error) {
        console.log("exception on external access\n");
      }

      askLoop();
    });
  };

  askLoop();
}

main();
