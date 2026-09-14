// Email Assistant - Bước 4: Thêm semantic memory cho Agent
//
// Agent trả lời email (response_agent) có thêm 2 tool:
// - manage_memory: lưu, cập nhật, xoá memory trong Store.
// - search_memory: tìm memory liên quan đã lưu trong Store.
//
// Các lượt invoke() dùng chung Store nên có thể nhớ dữ liệu cũ.
// Xem 05-episodic-memory-triage.js cho loại memory còn lại: episodic memory
// (few-shot examples) giúp bước triage tự học từ các email đã phân loại trước đó.

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

// Email tiếp theo của questionEmail, không nhắc lại câu hỏi cũ.
// Dùng để kiểm tra Agent có tìm lại được ngữ cảnh cũ qua search_memory hay không.
// Đây là một lượt invoke() hoàn toàn mới, không có State của lượt trước.
const followUpEmail = {
  author: "Alice Smith <alice.smith@company.com>",
  to: "John Doe <john.doe@company.com>",
  subject: "Follow up",
  emailThread: `Hi John, Any update on my previous ask?`,
};

// System prompt liệt kê các tool Agent có thể dùng.
// 3 tool xử lý email/calendar và 2 tool để lưu/tra cứu memory.
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

const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// `index` bật semantic search cho search_memory.
// `dims` là số chiều của embedding.
const store = new InMemoryStore({
  index: {
    embeddings,
    dims: 3072,
  },
});

// Namespace chia memory theo user: email_assistant > {langgraph_user_id} > collection.
// Placeholder "{langgraph_user_id}" sẽ được thay bằng user id
// khi tool chạy, thông qua resolveNamespace() trong memory-tools.js.
const MEMORY_NAMESPACE = [
  "email_assistant",
  "{langgraph_user_id}",
  "collection",
];

const manageMemoryTool = createManageMemoryTool(MEMORY_NAMESPACE);
const searchMemoryTool = createSearchMemoryTool(MEMORY_NAMESPACE);

// XẤU: instructions không có quy tắc rõ ràng về việc dùng tool.
// Thực tế khi sử dụng gọi search_memory nhiều lần với từ khóa khác nhau
// dù đã tìm thấy thông tin cần ngay từ lần gọi đầu
// -> chạm giới hạn 25 bước (recursionLimit) và crash
const badInstructions = agentInstructions;

// TỐT: quy tắc dùng số cứng (AT MOST ONCE / EXACTLY ONCE) thay vì điều kiện
// "retry nếu cần" - vì thực nghiệm cho thấy Agent vẫn lách rule có điều kiện
// (gọi search_memory 4-5 lần dù rule cho phép "retry once"). Rule càng ít
// nhánh rẽ, Agent càng khó diễn giải sai.
const goodInstructions = `${agentInstructions}

< Tool usage >
- search_memory: Call it AT MOST ONCE per email. Whatever it returns - relevant or empty - is final; do not call it again with a different keyword "to be safe". The store already returns the best match ranked by relevance on the first try.
- manage_memory: Call it EXACTLY ONCE per email, right after you finish handling it (after write_email/schedule_meeting).
- Never call the same tool more than once per email. As soon as you have enough information, stop calling tools and give your final answer immediately.
</ Tool usage >`;

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
  // Gắn Store để memory tools có thể đọc và ghi memory.
  store,
});

// Các lượt invoke() trong demo dùng chung một user id.
const config = {
  configurable: { langgraph_user_id: "lance" },
};

// Demo memory tools độc lập với luồng email.
// Các lượt chạy dùng chung Store và user id nên lượt sau có thể tìm lại
// memory đã lưu ở lượt trước - khác với 03-full-email-agent.js, nơi mỗi
// invoke() độc lập và không nhớ gì.
async function demoMemoryTools() {
  console.log("\n========== Demo: manage_memory & search_memory ==========");

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

  // Xem trực tiếp dữ liệu trong Store, không qua search_memory tool.
  console.log(
    "Toàn bộ memory:",
    await store.search(["email_assistant", "lance", "collection"]),
  );

  // Không truyền query -> lấy toàn bộ memory trong namespace.
  // Có query -> tìm memory theo ngữ nghĩa bằng embeddings.
  console.log(
    "Memory khớp 'jim':",
    await store.search(["email_assistant", "lance", "collection"], {
      query: "jim",
    }),
  );
}

// State = bộ nhớ ngắn hạn, chỉ tồn tại trong một lượt invoke() của Graph.
// Store = bộ nhớ dài hạn, dùng để lưu và tra cứu thông tin giữa các lượt invoke().
//
// LLM = bộ não biết suy luận và trả lời.
// Agent = LLM + tools + khả năng tự quyết định các bước xử lý.
//
// messages do 2 node ghi khác nhau:
//  - triage_router: chỉ thêm 1 message "human" khi email cần respond
//      -> LLM
//      -> object { reasoning, classification }
//      -> không lưu AI result vào state.messages
//  - response_agent: ghi toàn bộ message history: human/ai/tool
//      -> Agent
//      -> messages[]
//      -> lưu toàn bộ message history vào state.messages
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

async function triageRouterNode(state) {
  console.log("\n📍 Node: triage_router - đang phân loại email...");

  const { author, to, subject, emailThread } = state.emailInput;

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

  // result là object { reasoning, classification }, không phải AIMessage.
  // Chỉ dùng để phân loại, không lưu vào state.
  console.log(`🧠 Reasoning: ${result.reasoning}`);

  if (result.classification === "respond") {
    console.log("📧 Classification: RESPOND - This email requires a response");
    return new Command({
      goto: "response_agent",
      update: {
        // Thêm 1 message "human" để giao email cho response_agent xử lý.
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

// Truyền config xuống Agent để memory tools lấy được user id
// và truy cập đúng namespace memory của user hiện tại.
async function responseAgentNode(state, nodeConfig) {
  console.log(
    "\n📍 Node: response_agent - đang gọi Agent xử lý (tool call)...",
  );

  const result = await responseAgent.invoke(
    { messages: state.messages },
    nodeConfig,
  );

  // Agent trả về đủ message history:
  // HumanMessage -> AIMessage -> ToolMessage -> ... -> AIMessage.
  // Ghi cả mảng vào state để Graph giữ lại toàn bộ lịch sử xử lý.
  return { messages: result.messages };
}

const emailAgent = new StateGraph(EmailAgentState)
  .addNode("triage_router", triageRouterNode, {
    ends: ["response_agent", END],
  })
  .addNode("response_agent", responseAgentNode)
  .addEdge(START, "triage_router")
  // Gắn Store cho Graph cho phép Node/Tool có thể truy cập long term memory Store.
  .compile({ store });

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

// Khác với 03-full-email-agent.js (không nhớ gì giữa các lần invoke())
// mỗi invoke() ở đây vẫn dùng được long-term memory.
// Email trước lưu thông tin vào Store, email sau có thể tìm lại qua search_memory.
async function demoEmailMemory() {
  await runEmail(questionEmail);
  // followUpEmail không nhắc lại nội dung cũ,
  // nhưng Agent vẫn tìm được thông tin từ email trước.
  await runEmail(followUpEmail);
}

async function main() {
  // await demoMemoryTools();
  await demoEmailMemory();
}

main();
