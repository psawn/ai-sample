// Email Assistant - Bước 5: Thêm episodic memory cho bước triage
//
// triage_router tìm các email tương tự đã được phân loại trước đó
// và dùng chúng làm few-shot examples để phân loại email mới.
//
// Khi có email được sửa nhãn, ta lưu email + nhãn đúng vào Store.
// Lần sau gặp email tương tự, triage có thể tìm lại example này.
//
// Đây là episodic memory: nhớ lại các ví dụ cụ thể trong quá khứ.
// Khác với semantic memory ở 04-semantic-memory-agent.js:
// semantic memory lưu thông tin để Agent dùng lại khi xử lý email.
//
// response_agent vẫn dùng manage_memory/search_memory như bài 04.

require("../_polyfill");
require("dotenv").config();

const { randomUUID } = require("crypto");
const { z } = require("zod");
const {
  StateGraph,
  START,
  END,
  Annotation,
  Command,
  messagesStateReducer,
  InMemoryStore,
  getStore,
} = require("@langchain/langgraph");
const { createAgent } = require("langchain");
const {
  ChatGoogleGenerativeAI,
  GoogleGenerativeAIEmbeddings,
} = require("@langchain/google-genai");
const { profile, triageRules, agentInstructions } = require("./profile");
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

const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// `index` bật semantic search cho store.search().
// Nhờ vậy email khác câu chữ nhưng cùng ý vẫn có thể tìm được example phù hợp.
const store = new InMemoryStore({
  index: {
    embeddings,
    dims: 3072,
  },
});

// Namespace chia memory theo user:
// email_assistant > {userId} > examples.
function examplesNamespace(userId) {
  return ["email_assistant", userId, "examples"];
}

// Ghép email + nhãn thành một example.
// Chỉ lấy 400 ký tự đầu để prompt ngắn hơn.
function formatExample({ email, label }) {
  return `Email Subject: ${email.subject}
Email From: ${email.author}
Email To: ${email.to}
Email Content:
\`\`\`
${email.emailThread.slice(0, 400)}
\`\`\`
> Triage Result: ${label}`;
}

// Gộp các example thành một block few-shot.
// Không có example -> trả về null.
function formatFewShotExamples(items) {
  if (items.length === 0) return null;

  const blocks = items.map((item) => formatExample(item.value));
  return ["Here are some previous examples:", ...blocks].join(
    "\n\n------------\n\n",
  );
}

// Tạo sẵn 2 ví dụ cho user "lance" để triage tham khảo.
// Đây là dữ liệu mẫu có sẵn từ đầu.
async function seedExamples(userId) {
  const namespace = examplesNamespace(userId);

  await store.put(namespace, randomUUID(), {
    email: {
      author: "Alice Smith <alice.smith@company.com>",
      to: "John Doe <john.doe@company.com>",
      subject: "Quick question about API documentation",
      emailThread: `Hi John,

I was reviewing the API documentation for the new authentication service and noticed a few endpoints seem to be missing from the specs. Could you help clarify if this was intentional or if we should update the docs?

Specifically, I'm looking at:
- /auth/refresh
- /auth/validate

Thanks!
Alice`,
    },
    label: "respond",
  });

  await store.put(namespace, randomUUID(), {
    email: {
      author: "Sarah Chen <sarah.chen@company.com>",
      to: "John Doe <john.doe@company.com>",
      subject: "Update: Backend API Changes Deployed to Staging",
      emailThread: `Hi John,

Just wanted to let you know that I've deployed the new authentication endpoints we discussed to the staging environment. Key changes include:

- Implemented JWT refresh token rotation
- Added rate limiting for login attempts
- Updated API documentation with new endpoints

All tests are passing and the changes are ready for review. You can test it out at staging-api.company.com/auth/*

No immediate action needed from your side - just keeping you in the loop since this affects the systems you're working on.

Best regards,
Sarah`,
    },
    label: "ignore",
  });
}

// Tìm email tương tự trong Store để triage tham khảo.
// Chưa đưa example vào triage_router.
async function demoFewShotSearch(userId) {
  const email = {
    author: "Sarah Chen <sarah.chen@company.com>",
    to: "John Doe <john.doe@company.com>",
    subject: "Update: Backend API Changes Deployed to Staging",
    emailThread:
      "Wanted to let you know the new authentication endpoints are on staging...",
  };

  const results = await store.search(examplesNamespace(userId), {
    query: JSON.stringify({ email }),
    limit: 1,
  });

  console.log("\n===== Demo: few-shot search =====");
  console.log(formatFewShotExamples(results));
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

// System prompt liệt kê các tool Agent có thể dùng.
// 3 tool xử lý email/calendar và 2 tool để lưu/tra cứu semantic memory.
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

// Namespace semantic memory, dùng cho response_agent.
// Tách biệt với namespace "examples" của episodic memory.
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
    instructions: agentInstructions,
  }),
  // Gắn Store để memory tools có thể đọc và ghi memory.
  store,
});

// State = bộ nhớ ngắn hạn của Graph.
// emailInput giữ email gốc.
// messages giữ lịch sử hội thoại giữa response_agent và Tool.
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

async function triageRouterNode(state, config) {
  console.log("\n📍 Node: triage_router - đang phân loại email...");

  const userId = config?.configurable?.langgraph_user_id ?? "default";
  const { author, to, subject, emailThread } = state.emailInput;

  // Tìm các email tương tự đã được phân loại của user.
  // Đây là episodic memory của triage.
  const store = getStore(config);
  const examples = await store.search(examplesNamespace(userId), {
    query: JSON.stringify({ email: state.emailInput }),
  });

  const systemPrompt = buildTriageSystemPrompt({
    fullName: profile.fullName,
    name: profile.name,
    userProfileBackground: profile.userProfileBackground,
    triageIgnore: triageRules.ignore,
    triageNotify: triageRules.notify,
    triageRespond: triageRules.respond,
    examples: formatFewShotExamples(examples),
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
        // Thêm message để giao email cho response_agent xử lý.
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

  // Agent trả về toàn bộ message history.
  // Ghi cả mảng vào state để Graph giữ lại lịch sử xử lý.
  return { messages: result.messages };
}

const emailAgent = new StateGraph(EmailAgentState)
  .addNode("triage_router", triageRouterNode, {
    ends: ["response_agent", END],
  })
  .addNode("response_agent", responseAgentNode)
  .addEdge(START, "triage_router")
  // Gắn Store để các Node có thể truy cập long-term memory.
  .compile({ store });

async function runEmail(emailInput, userId) {
  console.log(
    `\n========== Email: "${emailInput.subject}" (user=${userId}) ==========`,
  );

  const result = await emailAgent.invoke(
    { emailInput },
    { configurable: { langgraph_user_id: userId } },
  );

  for (const message of result.messages) {
    console.log(
      JSON.stringify({ type: message.type, content: message.content }, null, 2),
    );
    console.log("-".repeat(60));
  }
}

// Email cố tình mơ hồ: đọc qua giống một câu hỏi thật (nên "respond"),
// nhưng người gửi là đối tác lạ, ngoài công ty - John muốn triage bỏ qua
// loại này. Rules hiện tại không phân biệt được nên LLM dễ đoán sai lần đầu,
// đúng lúc cần episodic memory (example) để sửa.
const edgeCaseEmail = {
  author: "Tom Jones <tom.jones@bar.com>",
  to: "John Doe <john.doe@company.com>",
  subject: "Quick question about API documentation",
  emailThread: `Hi John,

Quick question - does your team's documentation cover custom integrations? Would love to see a sample if you have one handy.

Thanks,
Tom`,
};

// Đổi nhẹ câu chữ nhưng vẫn cùng ý.
// Dùng để kiểm tra semantic search có tìm được example cũ không.
const similarEmail = {
  ...edgeCaseEmail,
  author: "Jim Jones <jim.jones@bar.com>",
  emailThread: `Hi John,

Just a quick one - does your documentation support custom integrations? Could you share a sample?

Thanks,
Jim`,
};

// Chưa có example -> LLM tự đoán -> trả về RESPOND (sai).
async function runWithoutMemory() {
  console.log("\n===== TRƯỚC KHI SỬA - kỳ vọng RESPOND =====");
  await runEmail(edgeCaseEmail, "harrison");
}

// Lưu nhãn đúng rồi chạy lại cùng email -> triage tìm được example -> trả về IGNORE (đúng).
async function correctAndRunWithMemory() {
  await store.put(examplesNamespace("harrison"), randomUUID(), {
    email: edgeCaseEmail,
    label: "ignore",
  });

  console.log("\n===== SAU KHI SỬA - kỳ vọng IGNORE =====");
  await runEmail(edgeCaseEmail, "harrison");
}

// Demo episodic memory
//
// runWithoutMemory():
// Chưa có example -> LLM tự phân loại -> RESPOND (sai)
//
// correctAndRunWithMemory():
// Có example với label IGNORE -> triage tìm example -> IGNORE (đúng)
async function demoEpisodicLearning() {
  await seedExamples("lance");
  await demoFewShotSearch("lance");

  await runWithoutMemory();
  await correctAndRunWithMemory();

  // // Email khác câu chữ nhưng cùng ý -> vẫn tìm được example cũ.
  // await runEmail(similarEmail, "harrison");

  // // User khác có namespace riêng -> không thấy memory của harrison.
  // await runEmail(similarEmail, "andrew");
}

async function main() {
  await demoEpisodicLearning();
}

main();
