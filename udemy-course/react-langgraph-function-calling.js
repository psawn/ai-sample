// =======================================================================
// DEMO: REACT AGENT BẰNG LANGGRAPH + FUNCTION CALLING
//
// Tự dựng ReAct Agent bằng StateGraph (createAgent() dựng sẵn đúng graph này).
// Bản tự viết node chạy tool, không dùng ToolNode: ../langchain/13-langgraph/agent.js
//
// ReAct agent (có vòng lặp)
//   START -> agent_reason --+--(không tool_calls)--> END
//                 ↑         |
//                 |         +--(có tool_calls)-----> act
//                 |                                   |
//                 +-----------------------------------+
//
// - agent_reason: LLM quyết định gọi tool hay trả lời luôn.
// - act: chạy tool, rồi quay lại agent_reason.
//
// Điều hướng bằng addConditionalEdges: node chỉ lo xử lý,
// việc chọn đường do hàm riêng (shouldContinue) làm.
// Dùng khi: chỉ cần đọc state để rẽ nhánh (vd: vòng lặp ReAct).
// So sánh cách dùng Command: ../langchain/14-email-assistant/03-full-email-agent.js
// =======================================================================

require("../langchain/_polyfill");
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { z } = require("zod");
const {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} = require("@langchain/langgraph");
const { ToolNode } = require("@langchain/langgraph/prebuilt");
const { tool } = require("@langchain/core/tools");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { TavilySearch } = require("@langchain/tavily");

const AGENT_REASON = "agent_reason";
const ACT = "act";

const SYSTEM_MESSAGE =
  "You are a helpful assistant that can use tools to answer questions.";

// ===== 1. KHAI BÁO TOOLS =====

// LLM đọc description + schema để biết khi nào gọi tool, truyền tham số gì.
const triple = tool(({ num }) => num * 3, {
  name: "triple",
  description: "Triple the input number and return the result.",
  schema: z.object({
    num: z.number().describe("A number to triple"),
  }),
});

// TavilySearch: tìm kiếm internet, lấy 1 kết quả.
const tools = [new TavilySearch({ maxResults: 1 }), triple];

// bindTools: cho LLM biết có những tool nào, để nó trả về `tool_calls`.
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
}).bindTools(tools);

// ===== 2. KHAI BÁO NODES & ĐIỀU KIỆN =====

// Node suy luận: gửi system prompt + lịch sử cho LLM.
// Chỉ trả message mới, LangGraph tự nối vào `state.messages`.
async function runAgentReasoning(state) {
  const response = await llm.invoke([
    new SystemMessage(SYSTEM_MESSAGE),
    ...state.messages,
  ]);
  return { messages: [response] };
}

// Node chạy tool: chạy các tool_calls trong message cuối, trả về ToolMessage.
const toolNode = new ToolNode(tools);

// Router: có tool_calls -> ACT, không có -> END.
// Chỉ đọc state, không ghi được (khác Command).
function shouldContinue(state) {
  const lastMessage = state.messages.at(-1);
  return lastMessage.tool_calls?.length ? ACT : END;
}

// ===== 3. DỰNG GRAPH =====

// MessagesAnnotation: state có sẵn, chỉ gồm `messages`.
const app = new StateGraph(MessagesAnnotation)
  .addNode(AGENT_REASON, runAgentReasoning)
  .addNode(ACT, toolNode)
  .addEdge(START, AGENT_REASON)
  // [ACT, END]: các đích shouldContinue có thể trả về.
  .addConditionalEdges(AGENT_REASON, shouldContinue, [ACT, END])
  // Chạy tool xong quay lại LLM -> tạo vòng lặp.
  .addEdge(ACT, AGENT_REASON)
  .compile();

// ===== 4. THỰC THI =====

async function main() {
  // Xuất sơ đồ graph ra images/<tên file>-flow.png
  const graph = await app.getGraphAsync();
  const image = await graph.drawMermaidPng();
  const imagePath = path.join(
    __dirname,
    "../images",
    `${path.basename(__filename, ".js")}-flow.png`,
  );
  fs.writeFileSync(imagePath, Buffer.from(await image.arrayBuffer()));

  console.log("Hello ReAct LangGraph with Function Calling");

  // Câu hỏi cần 2 tool: Tavily tìm nhiệt độ, triple nhân 3.
  const res = await app.invoke({
    messages: [
      new HumanMessage(
        "What is the temperature in Tokyo? List it and then triple it",
      ),
    ],
  });

  // In câu trả lời cuối cùng.
  console.log(res.messages.at(-1).content);
}

main();
