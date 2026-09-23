// =======================================================================
// EMAIL ASSISTANT (TYPESAFE) - BƯỚC 4: SEMANTIC MEMORY
//
// Email assistant có semantic memory: nhớ thông tin qua nhiều lượt, tìm lại theo ý nghĩa.
// Viết lại từ langchain/14-email-assistant/04-semantic-memory-agent.js (gọi tắt: "file gốc").
//
// Khác biệt kiến trúc:
// - File gốc: ReAct agent (createAgent). 1 LLM vừa chọn tool, vừa sinh tham số,
//   vừa quyết khi nào dừng. Vòng lặp do framework quản lý.
// - File này: vòng lặp tự viết. TypeSafe chọn hành động (kèm xác suất),
//   Gemini sinh tham số tool và câu trả lời cuối.
// - Giữ nguyên file gốc: graph, Store, memory tools, namespace, 2 kịch bản demo.
// =======================================================================

require("../langchain/_polyfill");
require("dotenv").config();

const { choice, TypeSafeClient } = require("@typesafe-ai/sdk");
const {
  StateGraph,
  START,
  END,
  Annotation,
  Command,
  InMemoryStore,
} = require("@langchain/langgraph");
const {
  ChatGoogleGenerativeAI,
  GoogleGenerativeAIEmbeddings,
} = require("@langchain/google-genai");
const {
  profile,
  triageRules,
  questionEmail,
} = require("../langchain/14-email-assistant/profile");
const {
  writeEmail,
  scheduleMeeting,
  checkCalendarAvailability,
} = require("../langchain/14-email-assistant/tools");
const {
  createManageMemoryTool,
  createSearchMemoryTool,
} = require("../langchain/14-email-assistant/memory-tools");

// Email hỏi lại, không nhắc nội dung câu hỏi trước.
// Agent chỉ trả lời đúng nếu tìm lại được memory của lượt trước.
const followUpEmail = {
  author: "Alice Smith <alice.smith@company.com>",
  to: "John Doe <john.doe@company.com>",
  subject: "Follow up",
  emailThread: `Hi John, Any update on my previous ask?`,
};

// Phân vai: TypeSafe ra quyết định, Gemini sinh nội dung.
const typesafe = new TypeSafeClient();
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Model embedding: đổi text thành vector để Store tìm memory theo ý nghĩa.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// ===== SEMANTIC MEMORY: Store + 2 memory tools =====

// Store lưu memory trong RAM. dims = số chiều vector của gemini-embedding-001.
const store = new InMemoryStore({ index: { embeddings, dims: 3072 } });

// Vị trí lưu memory trong Store, tách riêng theo user.
// "{langgraph_user_id}" được thay bằng userId thật khi tool chạy.
const MEMORY_NAMESPACE = [
  "email_assistant",
  "{langgraph_user_id}",
  "collection",
];

const manageMemoryTool = createManageMemoryTool(MEMORY_NAMESPACE);
const searchMemoryTool = createSearchMemoryTool(MEMORY_NAMESPACE);

// 5 tool, giống file gốc. toolsByName: tra tool theo tên TypeSafe trả về.
const tools = [
  writeEmail,
  scheduleMeeting,
  checkCalendarAvailability,
  manageMemoryTool,
  searchMemoryTool,
];
const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

// Config truyền xuống mọi tool: userId + store.
// Memory tools lấy store bằng getStore(config).
// File gốc gắn store qua createAgent({ store }); file này không có createAgent nên gắn vào config.
const config = {
  configurable: { langgraph_user_id: "lance" },
  store,
};

// Ngưỡng tin cậy của bước triage. Dưới ngưỡng -> dừng, để người xử lý.
// File gốc không có: withStructuredOutput chỉ trả nhãn, không trả xác suất.
const CONFIDENCE_THRESHOLD = 0.7;

// Số tool tối đa mỗi lần runAgent(), chống lặp vô hạn.
// Luồng dài nhất cần 5 tool, dư 1 bước:
// search_memory -> check_calendar -> schedule_meeting -> write_email -> manage_memory.
// File gốc dựa vào recursionLimit của LangGraph (mặc định 25).
const MAX_STEPS = 6;

// ===== TRIAGE: CÂU HỎI PHÂN LOẠI =====
// Phân email vào 1 trong 3 nhãn: ignore / notify / respond.
// Output: nhãn được chọn + xác suất. Không cần schema, không cần prompt.
// File gốc dùng zod Router + withStructuredOutput.
const triageQuestion = choice(
  `You are triaging emails for ${profile.fullName}. Classify this email.`,
  {
    ignore: triageRules.ignore,
    notify: triageRules.notify,
    respond: triageRules.respond,
  },
);

// ===== RESPONSE AGENT: CÂU HỎI CHỌN HÀNH ĐỘNG =====
// Mỗi vòng runAgent() hỏi câu này để chọn: tool kế tiếp, hoặc "done".
// Mô tả mỗi nhãn gồm 2 phần:
// 1. Khi nào dùng.
// 2. Khi nào không dùng (bước đó đã có trong stepsTaken).
//
// Không dùng lại tool.description: nó mô tả chức năng để sinh tham số,
// không nói khi nào nên gọi tool.
//
// "done": tín hiệu dừng rõ ràng. ReAct dừng ngầm khi LLM trả lời mà không gọi tool.
//
// File gốc: thông tin chọn tool nằm rải 3 nơi (mảng tools, khối < Tools > trong
// system prompt, goodInstructions). File này gom về 1 chỗ.
const actionQuestion = choice(
  `You are ${profile.fullName}'s executive assistant. ` +
    "Given the request and the steps already taken, which single action should be taken next?",
  {
    search_memory:
      "Search long-term memory for earlier context (people, previous requests). " +
      "Use it only if the request relies on context it does not contain, " +
      "and only if search_memory is not in the steps taken yet.",
    write_email:
      "Reply to the sender by email. Use it for emails that can be answered in writing, " +
      "and only if no email has been sent yet.",
    check_calendar_availability:
      "Look up free time slots. Use it only if a meeting is requested and availability has not been checked yet.",
    schedule_meeting:
      "Book a meeting. Use it only if a meeting is requested and free time slots are already known.",
    manage_memory:
      "Store new information for future reference (facts about people, requests, promises). " +
      "Use it once, after the request has been handled, and only if manage_memory is not in the steps taken yet.",
    done: "Everything needed has been done. Stop and give the final answer.",
  },
);

// Gọi systemOne(), in request và response.
async function askTypeSafe(params) {
  console.log("📤 TypeSafe request params:");
  console.dir(params, { depth: null });

  const response = await typesafe.systemOne(params);

  console.log("📦 TypeSafe response:");
  console.dir(response, { depth: null });

  return response;
}

// ===== runAgent(): VÒNG LẶP AGENT TỰ VIẾT =====
// Mỗi vòng:
// 1. TypeSafe chọn tool kế tiếp (hoặc "done") dựa trên request + stepsTaken.
// 2. Gemini điền tham số cho tool theo tool.schema.
// 3. Chạy tool, lưu kết quả vào steps.
// Hết vòng lặp: Gemini viết câu trả lời cuối.
// File gốc: createAgent gộp bước 1 + 2 vào 1 lượt gọi LLM có tool calling.
async function runAgent(request, runConfig) {
  // Lịch sử các bước đã chạy: [{ tool, args, result }].
  // Đưa vào prompt của TypeSafe và Gemini để biết đã làm gì.
  // Thay cho danh sách messages (AIMessage, ToolMessage) của file gốc.
  const steps = [];

  while (steps.length < MAX_STEPS) {
    // Bước 1: TypeSafe chọn hành động.
    const response = await askTypeSafe({
      state: { assistantFor: profile, request, stepsTaken: steps },
      questions: { action: actionQuestion },
    });
    const { action } = response.answers;

    console.log(`\n👉 Action: ${action.choice}`);
    if (action.choice === "done") break;

    // Bước 2: Gemini điền tham số theo schema của tool.
    const tool = toolsByName[action.choice];
    const args = await llm.withStructuredOutput(tool.schema).invoke([
      {
        role: "system",
        content:
          `You fill in arguments for the tool "${tool.name}" (${tool.description}) ` +
          `on behalf of ${profile.fullName} <john.doe@company.com>. ` +
          "Only use facts from the request and the previous steps; do not invent facts.\n" +
          `Previous steps: ${JSON.stringify(steps)}`,
      },
      { role: "user", content: request },
    ]);
    console.log("💬 Gemini response (tool args):");
    console.dir(args, { depth: null });

    // Bước 3: Chạy tool, lưu vào steps.
    // runConfig mang store + userId xuống memory tools.
    const result = await tool.invoke(args, runConfig);
    console.log(`🔧 Tool result: ${result}\n`);

    steps.push({ tool: tool.name, args, result });
  }

  if (steps.length >= MAX_STEPS) {
    console.log(`⛔ Reached MAX_STEPS (${MAX_STEPS}), stop calling tools`);
  }

  // Bước cuối: Gemini đọc steps, viết câu trả lời cho người dùng.
  // Tương đương result.messages.at(-1) của file gốc.
  const final = await llm.invoke([
    {
      role: "system",
      content:
        `You are ${profile.fullName}'s executive assistant. Reply briefly to ${profile.name} ` +
        `based on the steps taken: ${JSON.stringify(steps)}`,
    },
    { role: "user", content: request },
  ]);
  console.log(`💬 Gemini response:\n${final.content}`);

  return { steps, reply: final.content };
}

// ===== DEMO 1: MEMORY TOOLS, CHƯA DÙNG LUỒNG EMAIL =====
// 2 lượt runAgent() dùng chung store + userId: lượt 2 đọc được memory lượt 1 đã ghi.
async function demoMemoryTools() {
  console.log("\n========== Demo: manage_memory & search_memory ==========");

  // Ghi: agent chọn manage_memory.
  await runAgent("Jim is my friend", config);

  // Đọc: agent chọn search_memory.
  await runAgent("who is jim?", config);

  console.log("Namespaces:", await store.listNamespaces());

  // Đọc Store trực tiếp, không qua tool. Không query -> lấy toàn bộ namespace.
  console.log(
    "Toàn bộ memory:",
    await store.search(["email_assistant", "lance", "collection"]),
  );

  // Có query -> xếp hạng theo độ tương đồng embedding.
  console.log(
    "Memory khớp 'jim':",
    await store.search(["email_assistant", "lance", "collection"], {
      query: "jim",
    }),
  );
}

// ===== EMAIL GRAPH: triage_router -> response_agent =====

// State của graph: email đầu vào + các bước agent đã chạy.
// Reducer: có giá trị mới thì ghi đè, không có thì giữ nguyên.
// File gốc lưu lịch sử bằng messages + messagesStateReducer.
const EmailAgentState = Annotation.Root({
  emailInput: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => null,
  }),
  steps: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => [],
  }),
});

// Node 1: phân loại email, điều hướng bằng Command({ goto }).
// Chỉ "respond" đi tiếp. ignore/notify kết thúc, không gọi Gemini.
async function triageRouterNode(state) {
  console.log("\n📍 Node: triage_router");

  // Truyền thẳng object vào state, không cần tự build prompt
  // như file gốc (buildTriageSystemPrompt + buildTriageUserPrompt).
  const response = await askTypeSafe({
    state: { recipient: profile, email: state.emailInput },
    questions: { category: triageQuestion },
  });
  const { category } = response.answers;

  if (category.confidence < CONFIDENCE_THRESHOLD) {
    console.log(
      `\n👉 Action: 🤔 Low confidence (${category.confidence}) -> END`,
    );
    return new Command({ goto: END });
  }

  if (category.choice === "respond") {
    console.log("\n👉 Action: 📧 RESPOND -> response_agent");
    return new Command({ goto: "response_agent" });
  }

  console.log(
    `\n👉 Action: ${category.choice === "ignore" ? "🙈 IGNORE" : "🔔 NOTIFY"} -> END`,
  );
  return new Command({ goto: END });
}

// Node 2: chạy agent loop. nodeConfig mang store + userId xuống memory tools.
async function responseAgentNode(state, nodeConfig) {
  console.log("\n📍 Node: response_agent");

  const { steps } = await runAgent(
    `Respond to the email ${JSON.stringify(state.emailInput)}`,
    nodeConfig,
  );
  return { steps };
}

// Graph 2 node, giống file gốc.
// ends: khai báo các node mà Command({ goto }) có thể nhảy tới.
const emailAgent = new StateGraph(EmailAgentState)
  .addNode("triage_router", triageRouterNode, {
    ends: ["response_agent", END],
  })
  .addNode("response_agent", responseAgentNode)
  .addEdge(START, "triage_router")
  .compile({ store });

async function runEmail(emailInput) {
  console.log(`\n========== Email: "${emailInput.subject}" ==========`);

  const result = await emailAgent.invoke({ emailInput }, config);

  console.log("\n🧾 Steps taken:");
  console.dir(result.steps, { depth: null });
}

// ===== DEMO 2: MEMORY QUA LUỒNG EMAIL =====
// Email 1 ghi memory. Email 2 thiếu ngữ cảnh, phải tìm lại bằng search_memory.
async function demoEmailMemory() {
  await runEmail(questionEmail);
  await runEmail(followUpEmail);
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  await demoMemoryTools();
  // await demoEmailMemory();
}

main().catch((err) => {
  console.error("❌", err.name, err.status ?? "", err.message);
});
