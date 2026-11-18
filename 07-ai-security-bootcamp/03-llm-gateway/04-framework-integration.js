require("../../_shared/polyfill");

// =======================================================================
// LLM GATEWAY 4: BIFROST — DÙNG VỚI LANGCHAIN, LANGGRAPH, STREAMING
//
// Mục đích: đưa code LangChain, LangGraph có sẵn qua gateway, nhận câu trả lời dạng stream.
//
// 1. Đổi gì khi chuyển sang gateway?
//    - Chỉ đổi chỗ tạo LLM: dùng `ChatOpenAI`, trỏ `baseURL` vào gateway.
//    - "OpenAI" trong `ChatOpenAI` = định dạng API của OpenAI (Bifrost hỗ trợ), không phải công ty OpenAI.
//    - Chain, agent, tool, graph giữ nguyên.
//
// 2. Luồng file:
//    - Phần 1: LangChain — chỉ đổi client, chain giữ nguyên
//    - Phần 2: LangGraph — chỉ đổi LLM, graph giữ nguyên
//    - Phần 3: Streaming — nhận từng đoạn câu trả lời
//
// 3. Chuẩn bị: bật gateway theo phần Chuẩn bị trong 01-gateway-basics.js.
//
// Chạy lệnh:
//    node 07-ai-security-bootcamp/03-llm-gateway/04-framework-integration.js
// =======================================================================

require("dotenv").config();

const { HumanMessage } = require("@langchain/core/messages");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} = require("@langchain/langgraph");
const { ToolNode } = require("@langchain/langgraph/prebuilt");
const { ChatOpenAI } = require("@langchain/openai");

// 3 tool giả lập (không gửi mail, đặt lịch thật), dùng ở Phần 2
const {
  checkCalendarAvailability,
  scheduleMeeting,
  writeEmail,
} = require("../../03-langchain/14-email-assistant/helpers/tools");
const { logInfo, logQuestion, logStep } = require("../helpers/log");

const {
  BIFROST_URL,
  PRIMARY_MODEL,
  bifrostClient,
  logAnswer,
  runLesson,
} = require("./helpers/bifrost");

// =======================================================================
// PHẦN 1: LANGCHAIN — CHỈ ĐỔI CLIENT, CHAIN GIỮ NGUYÊN
// =======================================================================

/**
 * Chạy chain LangChain qua Bifrost: chỉ đổi model sang `ChatOpenAI` trỏ vào gateway.
 *
 * - Chain, agent, tool giữ nguyên.
 * - Bifrost có endpoint riêng cho LangChain: `/langchain`.
 */
async function langchainIntegration() {
  logStep("Phần 1: LangChain");

  // Cách gọi trực tiếp: LangChain → Gemini.
  // const llm = new ChatGoogleGenerativeAI({
  //   apiKey: process.env.GEMINI_API_KEY,
  //   model: "gemini-3.5-flash",
  //   temperature: 0,
  // });

  // Cách gọi qua gateway: LangChain → Bifrost → Gemini.
  const llm = new ChatOpenAI({
    model: PRIMARY_MODEL,
    apiKey: "not-used",
    temperature: 0,
    // maxRetries: tắt retry của LangChain, để gateway retry
    maxRetries: 0,
    configuration: {
      baseURL: `${BIFROST_URL}/langchain`,
      defaultHeaders: { "x-bf-vk": process.env.BIFROST_VIRTUAL_KEY },
    },
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "Bạn là chuyên gia IT doanh nghiệp. Trả lời ngắn gọn."],
    ["human", "{question}"],
  ]);
  const chain = prompt.pipe(llm).pipe(new StringOutputParser());

  const question = "Pod affinity trong Kubernetes là gì?";
  logQuestion(question);
  const startedAt = Date.now();
  const answer = await chain.invoke({ question });
  logAnswer(answer, Date.now() - startedAt, "LCEL chain qua Bifrost");
}

// =======================================================================
// PHẦN 2: LANGGRAPH — CHỈ ĐỔI LLM, GRAPH GIỮ NGUYÊN
// =======================================================================

/**
 * Chạy agent trợ lý email (LangGraph) qua Bifrost, có 3 tool: xem lịch trống, đặt họp, gửi email.
 *
 * - Giống Phần 1: chỉ đổi LLM sang `ChatOpenAI` trỏ vào gateway. Node, edge, tool giữ nguyên.
 * - Graph: `START → agent → (có tool_calls) → tools → agent → ... → END`.
 * - Câu hỏi cần cả 3 tool theo thứ tự → agent lặp nhiều vòng.
 *   Mỗi vòng node `agent` gọi LLM 1 lần = 1 request qua gateway → log Bifrost thấy từng lần.
 */
async function langgraphIntegration() {
  logStep("Phần 2: LangGraph");

  const tools = [checkCalendarAvailability, scheduleMeeting, writeEmail];

  // bindTools: cho LLM biết có tool nào → LLM trả về `tool_calls` khi cần dùng
  const llm = new ChatOpenAI({
    model: PRIMARY_MODEL,
    apiKey: "not-used",
    temperature: 0,
    maxRetries: 0,
    configuration: {
      baseURL: `${BIFROST_URL}/langchain`,
      defaultHeaders: {
        "x-bf-vk": process.env.BIFROST_VIRTUAL_KEY,
        // x-bf-lh-feature: nhãn log, để lọc các call của graph này
        "x-bf-lh-feature": "langgraph-demo",
      },
    },
  }).bindTools(tools);

  const graph = new StateGraph(MessagesAnnotation)
    .addNode("agent", async (state) => ({
      messages: [await llm.invoke(state.messages)],
    }))
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "agent")
    // Có tool_calls → chạy tool, không có → kết thúc
    .addConditionalEdges(
      "agent",
      (state) => (state.messages.at(-1).tool_calls?.length ? "tools" : END),
      ["tools", END],
    )
    // Chạy tool xong quay lại LLM → tạo vòng lặp
    .addEdge("tools", "agent")
    .compile();

  const question =
    "Xem lịch trống thứ Ba, đặt họp 30 phút với alice@example.com về review RAG " +
    "vào khung giờ sớm nhất, rồi gửi email xác nhận cho alice.";
  logQuestion(question);
  const startedAt = Date.now();
  const result = await graph.invoke({ messages: [new HumanMessage(question)] });

  // In các tool agent đã gọi, theo thứ tự
  const toolCalls = result.messages.flatMap((m) => m.tool_calls ?? []);
  for (const call of toolCalls) {
    logInfo(`🔧 ${call.name}(${JSON.stringify(call.args)})`);
  }
  const llmCallCount = result.messages.filter((m) => m.type === "ai").length;
  logAnswer(
    result.messages.at(-1).content,
    Date.now() - startedAt,
    `${toolCalls.length} lần gọi tool, ${llmCallCount} lần gọi LLM qua Bifrost`,
  );
}

// =======================================================================
// PHẦN 3: STREAMING — NHẬN TỪNG ĐOẠN CÂU TRẢ LỜI
// =======================================================================

/**
 * `stream: true` → nhận từng đoạn câu trả lời ngay khi model sinh ra.
 *
 * - User thấy chữ hiện dần, không phải chờ cả câu trả lời.
 * - Request stream vẫn được ghi log.
 */
async function streaming() {
  logStep("Phần 3: Streaming");

  const question = "Giải thích LLM gateway làm gì, đúng 3 gạch đầu dòng.";
  logQuestion(question);

  const startedAt = Date.now();
  const stream = await bifrostClient.chat.completions.create({
    model: PRIMARY_MODEL,
    messages: [{ role: "user", content: question }],
    stream: true,
  });
  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
  }
  console.log();
  logInfo(`⏱  ${Date.now() - startedAt}ms cho cả stream`);
}

async function main() {
  await langchainIntegration(); // Phần 1
  await langgraphIntegration(); // Phần 2
  await streaming(); // Phần 3
}

runLesson(main);
