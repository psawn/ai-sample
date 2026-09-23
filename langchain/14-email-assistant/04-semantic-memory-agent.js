// =======================================================================
// EMAIL ASSISTANT - BƯỚC 4: SEMANTIC MEMORY (BỘ NHỚ NGỮ NGHĨA)
//
// Bước 03: mỗi lần invoke() là độc lập, agent không nhớ gì từ lần trước.
// Bước 04: thêm bộ nhớ dài hạn (Store), sống qua nhiều lượt invoke().
//
// response_agent có thêm 2 tool:
// - manage_memory: tạo, cập nhật, xoá memory trong Store.
// - search_memory: tìm memory liên quan trong Store.
//
// Loại memory còn lại xem bước 05: episodic memory (ví dụ mẫu) giúp bước triage
// học từ các email đã phân loại trước đó.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const {
  StateGraph,
  START,
  END,
  Annotation,
  Command,
  messagesStateReducer,
  InMemoryStore,
} = require("@langchain/langgraph");
const { createAgent } = require("langchain");
const {
  ChatGoogleGenerativeAI,
  GoogleGenerativeAIEmbeddings,
} = require("@langchain/google-genai");
const {
  profile,
  triageRules,
  agentInstructions,
  questionEmail,
} = require("./profile");
const { buildTriageSystemPrompt, buildTriageUserPrompt } = require("./prompts");
const {
  writeEmail,
  scheduleMeeting,
  checkCalendarAvailability,
} = require("./tools");
const {
  createManageMemoryTool,
  createSearchMemoryTool,
} = require("./memory-tools");

// Email follow-up của questionEmail, không nhắc lại nội dung câu hỏi cũ.
// Chạy ở lượt invoke() mới, không còn state của lượt trước,
// nên chỉ trả lời đúng nếu agent tìm lại được memory qua search_memory.
const followUpEmail = {
  author: "Alice Smith <alice.smith@company.com>",
  to: "John Doe <john.doe@company.com>",
  subject: "Follow up",
  emailThread: `Hi John, Any update on my previous ask?`,
};

// System prompt của response agent, liệt kê 5 tool:
// 3 tool xử lý email và lịch họp, 2 tool đọc ghi memory.
function buildAgentSystemPromptMemory({ fullName, name, instructions }) {
  return `< Role >
You are ${fullName}'s executive assistant. You are a top-notch executive assistant who cares about ${name} performing as well as possible.
</ Role >

< Tools >
You have access to the following tools to help manage ${name}'s communications and schedule:
1. write_email(to, subject, content) - Send emails to specified recipients
2. schedule_meeting(attendees, subject, duration_minutes, preferred_day) - Schedule calendar meetings
3. check_calendar_availability(day) - Check available time slots for a given day
4. manage_memory - Store any relevant information about contacts, actions, discussion, etc. in memory for future reference
5. search_memory - Search for any relevant information that may have been stored in memory
</ Tools >

< Instructions >
${instructions}
</ Instructions >`;
}

// Schema đầu ra của bộ phân loại.
const Router = z.object({
  reasoning: z
    .string()
    .describe("Step-by-step reasoning behind the classification."),
  classification: z
    .enum(["ignore", "respond", "notify"])
    .describe(
      "The classification of an email: 'ignore' for irrelevant emails, " +
        "'notify' for important information that doesn't need a response, " +
        "'respond' for emails that need a reply",
    ),
});

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

const llmRouter = llm.withStructuredOutput(Router);

// Model embedding: đổi text thành vector để Store tìm memory theo ý nghĩa.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// ===== SEMANTIC MEMORY: Store + 2 memory tools =====

// Store dùng chung cho cả 3 loại bộ nhớ. Bước 04 mới dùng loại 1:
// 1. Semantic  : thông tin agent lưu khi xử lý email, namespace "collection".
// 2. Episodic  : ví dụ mẫu cho triage, namespace "examples". Bước 05.
// 3. Procedural: chỉ dẫn làm việc theo từng user. Bước 06.
// dims = số chiều vector của gemini-embedding-001.
const store = new InMemoryStore({ index: { embeddings, dims: 3072 } });

// Đường dẫn lưu memory, chia theo user.
// "{langgraph_user_id}" được resolveNamespace() trong memory-tools.js
// thay bằng userId thật lúc tool chạy.
const MEMORY_NAMESPACE = [
  "email_assistant",
  "{langgraph_user_id}",
  "collection",
];

const manageMemoryTool = createManageMemoryTool(MEMORY_NAMESPACE);
const searchMemoryTool = createSearchMemoryTool(MEMORY_NAMESPACE);

// 2 bản chỉ dẫn cho response agent. Agent dùng goodInstructions.
//
// badInstructions: không có quy tắc dùng tool. Giữ lại để so sánh.
// Kết quả khi chạy: agent gọi search_memory nhiều lần với từ khoá khác nhau,
// dù lần đầu đã tìm thấy, rồi chạm recursionLimit 25 bước và crash.
const badInstructions = agentInstructions;

// goodInstructions: giới hạn số lần gọi cố định (AT MOST ONCE / EXACTLY ONCE),
// không dùng điều kiện kiểu "retry nếu cần".
// Lý do: rule có điều kiện vẫn bị lách, agent gọi search_memory 4-5 lần dù rule
// chỉ cho retry 1 lần. Rule càng ít nhánh rẽ càng khó hiểu sai.
const goodInstructions = `${agentInstructions}

< Tool usage >
- search_memory: Call it AT MOST ONCE per email. Whatever it returns - relevant or empty - is final; do not call it again with a different keyword "to be safe". The store already returns the best match ranked by relevance on the first try.
- manage_memory: Call it EXACTLY ONCE per email, right after you finish handling it (after write_email/schedule_meeting).
- Never call the same tool more than once per email. As soon as you have enough information, stop calling tools and give your final answer immediately.
</ Tool usage >`;

// Response Agent: 3 tool email/lịch họp + 2 memory tools, dùng goodInstructions.
//
// LLM chọn tool dựa trên 3 nguồn, cả 3 được gửi kèm mỗi lượt gọi LLM:
//   1. Mảng tools bên dưới: name + description + zod schema của từng tool.
//      LangChain chuyển thành function declarations.
//   2. Khối < Tools > viết tay trong buildAgentSystemPromptMemory.
//   3. goodInstructions: số lần được gọi mỗi tool.
//
// Hệ quả:
// - Mô tả tool lặp ở nguồn 1 và 2: sửa 1 nơi mà quên nơi kia thì 2 nơi lệch nhau.
// - description chỉ nói tool làm gì ("Write and send an email."),
//   không nói khi nào nên dùng -> LLM dễ chọn nhầm khi 2 tool cùng hợp lý.
//   Khi nào nên dùng phải viết thêm ở nguồn 3 (xem ghi chú ở profile.js).
const responseAgent = createAgent({
  model: llm,
  tools: [
    writeEmail,
    scheduleMeeting,
    checkCalendarAvailability,
    manageMemoryTool,
    searchMemoryTool,
  ],
  systemPrompt: buildAgentSystemPromptMemory({
    fullName: profile.fullName,
    name: profile.name,
    instructions: goodInstructions,
  }),
  // Gắn Store để memory tools đọc ghi được.
  store,
});

// Mọi lượt invoke() trong demo dùng chung 1 userId.
const config = {
  configurable: { langgraph_user_id: "lance" },
};

// ===== DEMO 1: MEMORY TOOLS, CHƯA DÙNG LUỒNG EMAIL =====
// 2 lượt chạy dùng chung Store + userId: lượt 2 đọc được memory lượt 1 đã ghi.
// Bước 03 không làm được vì mỗi invoke() độc lập.
async function demoMemoryTools() {
  console.log("\n========== Demo: manage_memory & search_memory ==========");

  // Lượt 1: cung cấp 1 thông tin, agent gọi manage_memory để lưu.
  const rememberResponse = await responseAgent.invoke(
    {
      messages: [
        {
          role: "user",
          content: "Jim is my friend",
        },
      ],
    },
    config,
  );

  console.log("Agent:", rememberResponse.messages.at(-1).content);

  // Lượt 2: hỏi lại, agent gọi search_memory để tìm.
  const recallResponse = await responseAgent.invoke(
    {
      messages: [
        {
          role: "user",
          content: "who is jim?",
        },
      ],
    },
    config,
  );

  console.log("Agent:", recallResponse.messages.at(-1).content);

  console.log("Namespaces:", await store.listNamespaces());

  // Đọc Store trực tiếp, không qua tool. Không có query -> lấy toàn bộ namespace.
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

// ===== EMAIL GRAPH: Triage Router + Response Agent (có memory) =====

// State là bộ nhớ ngắn hạn, chỉ sống trong 1 lượt invoke().
// Store là bộ nhớ dài hạn, dùng chung giữa các lượt invoke().
//
// 2 node ghi messages khác nhau:
// - triage_router : chỉ thêm 1 message "human" khi cần respond.
//                   Kết quả { reasoning, classification } không ghi vào messages.
// - response_agent: ghi toàn bộ lịch sử human/ai/tool mà agent trả về.
const EmailAgentState = Annotation.Root({
  emailInput: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => null,
  }),
  messages: Annotation({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

// Node 1: phân loại email.
async function triageRouterNode(state) {
  console.log("\n📍 Node: triage_router - đang phân loại email...");

  const { author, to, subject, emailThread } = state.emailInput;

  // Prompt phân loại: hồ sơ người dùng + 3 quy tắc. Chưa dùng ví dụ mẫu.
  const systemPrompt = buildTriageSystemPrompt({
    fullName: profile.fullName,
    name: profile.name,
    userProfileBackground: profile.userProfileBackground,
    triageIgnore: triageRules.ignore,
    triageNotify: triageRules.notify,
    triageRespond: triageRules.respond,
    examples: null,
  });

  const userPrompt = buildTriageUserPrompt({
    author,
    to,
    subject,
    emailThread,
  });

  const result = await llmRouter.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  // result là object { reasoning, classification }, không phải AIMessage,
  // nên chỉ dùng để điều hướng, không ghi vào state.
  console.log(`🧠 Reasoning: ${result.reasoning}`);

  // Điều hướng theo nhãn LLM trả về.
  if (result.classification === "respond") {
    console.log("📧 Classification: RESPOND - This email requires a response");
    return new Command({
      goto: "response_agent",
      update: {
        // Giao email cho response_agent dưới dạng 1 message của user.
        messages: [
          {
            role: "user",
            content: `Respond to the email ${JSON.stringify(state.emailInput)}`,
          },
        ],
      },
    });
  }

  if (result.classification === "ignore") {
    console.log("🚫 Classification: IGNORE - This email can be safely ignored");
    return new Command({ goto: END });
  }

  console.log(
    "🔔 Classification: NOTIFY - This email contains important information",
  );
  return new Command({ goto: END });
}

// Node 2: chuyển messages cho agent có tool xử lý.
async function responseAgentNode(state, nodeConfig) {
  console.log(
    "\n📍 Node: response_agent - đang gọi Agent xử lý (tool call)...",
  );

  // Truyền config xuống agent để memory tools lấy được userId,
  // từ đó đọc ghi đúng namespace của user hiện tại.
  const result = await responseAgent.invoke(
    { messages: state.messages },
    nodeConfig,
  );

  // Agent trả về đủ lịch sử: HumanMessage -> AIMessage -> ToolMessage -> ... -> AIMessage.
  // Ghi cả mảng vào state. Không bị nhân đôi vì messagesStateReducer gộp message trùng id.
  return { messages: result.messages };
}

// Khai báo và biên dịch graph.
const emailAgent = new StateGraph(EmailAgentState)
  .addNode("triage_router", triageRouterNode, {
    ends: ["response_agent", END],
  })
  .addNode("response_agent", responseAgentNode)
  .addEdge(START, "triage_router")
  // Gắn Store cho graph, để node và tool truy cập được bộ nhớ dài hạn.
  .compile({ store });

// Chạy graph với 1 email, in toàn bộ lịch sử message.
async function runEmail(emailInput) {
  console.log(`\n========== Email: "${emailInput.subject}" ==========`);

  const result = await emailAgent.invoke({ emailInput }, config);

  for (const message of result.messages) {
    console.log(
      JSON.stringify({ type: message.type, content: message.content }, null, 2),
    );

    console.log("-".repeat(60));
  }
}

// ===== DEMO 2: MEMORY QUA LUỒNG EMAIL =====
// Email trước ghi thông tin vào Store, email sau tìm lại bằng search_memory.
async function demoEmailMemory() {
  // Email 1: agent trả lời câu hỏi và ghi thông tin vào Store.
  await runEmail(questionEmail);

  // Email 2: không nhắc lại nội dung cũ, agent phải tìm lại từ Store.
  await runEmail(followUpEmail);
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // await demoMemoryTools();
  await demoEmailMemory();
}

main();
