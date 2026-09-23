// =======================================================================
// TOOL ROUTING - BƯỚC 7: CHATBOT TERMINAL (AGENT + AgentExecutor + MEMORY)
//
// Chatbot hỏi đáp qua terminal. Cùng pattern Agent + Memory như 06-agent-executor.js,
// thêm 1 Tool tự viết.
//
// Flow mỗi câu hỏi:
// 1. User gõ câu hỏi.
// 2. Agent gọi Tool nếu cần, trả lời dựa trên lịch sử chat.
// 3. In câu trả lời, hỏi tiếp tới khi gõ "exit".
//
// Giao diện: readline trên terminal (giống 08-retrieval-qa/06-cli-chatbot.js).
// =======================================================================

require("../_polyfill");
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
const { AgentExecutor, createToolCallingAgent } = require("@langchain/classic/agents");
const { getCurrentTemperature } = require("./02-weather-tool");
const { searchWikipedia } = require("./03-wikipedia-tool");

// Tool tự viết để minh họa: đảo ngược chuỗi. Muốn Tool làm gì thì sửa logic ở đây.
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

// 3 Tool Agent được dùng: xem nhiệt độ + tra Wikipedia + tool tự viết.
const tools = [getCurrentTemperature, searchWikipedia, createYourOwn];

// Prompt:
// - chat_history: các lượt hỏi-đáp trước, giữ suốt session.
// - agent_scratchpad: các Tool đã gọi trong câu hỏi hiện tại, reset mỗi lần invoke().
// Giải thích chi tiết: 06-agent-executor.js.
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are helpful but sassy assistant"],
  new MessagesPlaceholder("chat_history"),
  ["human", "{input}"],
  ["placeholder", "{agent_scratchpad}"],
]);

// agent: LLM + Tools + Prompt. Chỉ quyết định bước tiếp theo, không tự chạy Tool.
const agent = createToolCallingAgent({ llm, tools, prompt });

// agentExecutor: vòng lặp gọi agent -> chạy Tool -> đưa kết quả về, tới khi có Final Answer.
const agentExecutor = new AgentExecutor({ agent, tools, verbose: false });

// RunnableWithMessageHistory: tự nạp + lưu chat_history.
// Chỉ có 1 cuộc hội thoại -> getMessageHistory luôn trả cùng 1 history.
// So sánh cách tự làm tay: ../01-basics/chat-history-manual-vs-auto.js.
const history = new InMemoryChatMessageHistory();
const agentWithMemory = new RunnableWithMessageHistory({
  runnable: agentExecutor,
  getMessageHistory: () => history,
  inputMessagesKey: "input",
  historyMessagesKey: "chat_history",
});

// RunnableWithMessageHistory bắt buộc có sessionId trong config.
// Ở đây getMessageHistory bỏ qua sessionId, vì chỉ có 1 history.
const config = { configurable: { sessionId: "cli-session" } };

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  console.log("QnA_Bot - gõ câu hỏi rồi Enter, gõ 'exit' để thoát.\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Vòng lặp hỏi-đáp: hỏi 1 câu -> Agent trả lời -> hỏi tiếp, tới khi gõ "exit".
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
