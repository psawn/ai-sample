// Email Assistant - Bước 4: THÊM semantic memory cho Agent trả lời email
//
// Agent trả lời email (response_agent) có thêm 2 tool:
// - manage_memory: lưu thông tin vào Store.
// - search_memory: tìm lại thông tin đã lưu.
//
// Cả 2 dùng chung một InMemoryStore và phân vùng memory theo từng user.
// Nhờ vậy, các lượt invoke() độc lập vẫn có thể dùng lại thông tin đã lưu,
// dù mỗi lượt có State và message history riêng.

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

// Email trả lời tiếp (follow-up) của questionEmail, không nhắc lại nội dung câu hỏi cũ.
// Dùng để kiểm tra Agent có thể tìm lại ngữ cảnh cũ qua search_memory hay không,
// dù đây là một lượt invoke() hoàn toàn mới và không có State của lượt trước.
const followUpEmail = {
  author: "Alice Smith <alice.smith@company.com>",
  to: "John Doe <john.doe@company.com>",
  subject: "Follow up",
  emailThread: `Hi John,

Any update on my previous ask?`,
};

// System prompt liệt kê 5 tool mà Agent có thể sử dụng:
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

// Dùng chung 1 LLM cho cả việc phân loại email (Router) và trả lời email (Agent).
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

const llmRouter = llm.withStructuredOutput(Router);

// Dùng Embedding Model để biến memory thành vector.
// Nhờ đó search_memory có thể tìm theo ngữ nghĩa thay vì chỉ tìm từ khóa giống nhau.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// Truyền embeddings vào Store qua field `index` để bật tìm kiếm theo vector (semantic
// search) cho search_memory. `dims` chỉ để ghi chú số chiều vector, Store không dùng
// giá trị này để kiểm tra hay tính toán gì.
const store = new InMemoryStore({ index: { embeddings, dims: 3072 } });

// Namespace = "đường dẫn" phân vùng memory trong Store, giống thư mục lồng nhau:
// email_assistant > {langgraph_user_id} > collection.
//
// "{langgraph_user_id}" là placeholder.
// resolveNamespace() trong memory-tools.js sẽ thay nó bằng user id thật
// lấy từ config.configurable khi memory tool chạy.
const MEMORY_NAMESPACE = [
  "email_assistant",
  "{langgraph_user_id}",
  "collection",
];

const manageMemoryTool = createManageMemoryTool(MEMORY_NAMESPACE);
const searchMemoryTool = createSearchMemoryTool(MEMORY_NAMESPACE);

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

    // ❌ BAD (nguyên nhân gây GraphRecursionError): dùng thẳng agentInstructions gốc - quá
    // chung chung, không có điều kiện dừng. Đã tái hiện thực tế: xử lý followUpEmail, agent
    // gọi search_memory 10 lần liên tiếp với từ khóa khác nhau dù đã tìm thấy thông tin cần
    // thiết ngay từ lần gọi đầu, không bao giờ gọi tới write_email -> chạm giới hạn 25 bước
    // (recursionLimit) và crash.
    // instructions: agentInstructions,

    // ✅ GOOD: nối thêm hướng dẫn dùng tool + điều kiện dừng rõ ràng, chỉ áp dụng riêng ở
    // file này (không sửa agentInstructions dùng chung trong profile.js, để không ảnh hưởng
    // bài học "over-agentic" ở 03-full-email-agent.js).
    instructions: `${agentInstructions}

< Tool usage >
- search_memory: 1 lần gọi là đủ, kết quả trả về đã là match tốt nhất - đừng gọi lại với
  từ khóa khác nếu đã có kết quả liên quan.
- manage_memory: chỉ gọi 1 lần, sau khi đã xử lý xong email.
- Khi đã có đủ thông tin để trả lời, dừng gọi tool và trả lời ngay.
</ Tool usage >`,
  }),
  // Gắn Store vào Agent để memory tools có thể lấy Store và đọc/ghi memory.
  store,
});

// Cùng 1 user id xuyên suốt demo -> mọi lượt invoke() dưới đây đều dùng chung
// một namespace memory của user này.
const config = {
  configurable: { langgraph_user_id: "lance" },
};

// Demo 2 memory tool riêng, không qua luồng email.
// Khác với 03-full-email-agent.js (mỗi invoke() độc lập, không nhớ gì): nhờ dùng chung
// `store` + cùng `config` (user id), lượt invoke() thứ 2 tìm lại được thông tin lượt 1 vừa lưu.
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

  // Gọi trực tiếp store.search() để xem dữ liệu trong Store,
  // không thông qua search_memory tool.
  //
  // "lance" phải khớp với user id trong config ở trên,
  // vì đây là namespace mà memory tools đã dùng để lưu dữ liệu.
  console.log(
    "Toàn bộ memory:",
    await store.search(["email_assistant", "lance", "collection"]),
  );

  // Không truyền query -> lấy các memory trong namespace.
  // Có query -> tìm memory theo ngữ nghĩa bằng embeddings.
  console.log(
    "Memory khớp 'jim':",
    await store.search(["email_assistant", "lance", "collection"], {
      query: "jim",
    }),
  );
}

// State = bộ nhớ ngắn hạn của một lượt chạy.
// Store = bộ nhớ dùng để lưu và tìm lại thông tin giữa nhiều lượt chạy.
//
// State và Store là 2 cơ chế khác nhau:
// - State chứa dữ liệu của Graph trong lúc xử lý một lượt invoke().
// - Store chứa memory để các lượt invoke() khác có thể truy cập lại.
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

  if (result.classification === "respond") {
    console.log("📧 Classification: RESPOND - This email requires a response");
    return new Command({
      goto: "response_agent",
      update: {
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
  const result = await responseAgent.invoke(
    { messages: state.messages },
    nodeConfig,
  );

  return { messages: result.messages };
}

const emailAgent = new StateGraph(EmailAgentState)
  .addNode("triage_router", triageRouterNode, {
    ends: ["response_agent", END],
  })
  .addNode("response_agent", responseAgentNode)
  .addEdge(START, "triage_router")
  // Gắn Store cho Graph để các Node/Tool bên trong có thể truy cập Store.
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

// Khác với 03-full-email-agent.js (không nhớ gì giữa các lần invoke()): responseAgent CÓ THỂ
// lưu thông tin lúc trả lời questionEmail, rồi tự tra lại bằng search_memory khi xử lý
// followUpEmail - dù 2 email này là 2 lượt invoke() hoàn toàn tách biệt.
async function demoEmailMemory() {
  await runEmail(questionEmail);
  // followUpEmail không nhắc lại câu hỏi cũ - Agent vẫn trả lời đúng /auth/refresh và
  // /auth/validate tức là đã tìm lại thông tin qua search_memory.
  await runEmail(followUpEmail);
}

async function main() {
  // await demoMemoryTools();
  await demoEmailMemory();
}

main();
