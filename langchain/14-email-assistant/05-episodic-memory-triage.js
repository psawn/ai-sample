// =======================================================================
// EMAIL ASSISTANT - BƯỚC 5: EPISODIC MEMORY (BỘ NHỚ THEO SỰ KIỆN) CHO TRIAGE
//
// Triage học từ các email đã phân loại trước đó.
// - Semantic memory (bước 04): agent nhớ thông tin để dùng khi trả lời email.
// - Episodic memory (bước 05): triage nhớ các email đã phân loại + nhãn đúng.
//
// Với mỗi email mới, triage_router tìm email tương tự trong Store,
// rồi đưa vào prompt làm ví dụ mẫu (few-shot).
//
// Triage phân loại sai -> lưu email + nhãn đúng vào Store. Lần sau gặp email
// tương tự, triage tìm lại ví dụ đó và phân loại đúng, không phải sửa rules.
//
// response_agent vẫn dùng manage_memory và search_memory như bước 04.
// =======================================================================

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

// Model embedding: đổi text thành vector để Store tìm theo ý nghĩa.
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// Store dùng chung cho 2 loại bộ nhớ:
// 1. Semantic: thông tin agent lưu khi xử lý email, namespace "collection".
// 2. Episodic: ví dụ mẫu cho triage, namespace "examples".
// dims = số chiều vector của gemini-embedding-001.
const store = new InMemoryStore({ index: { embeddings, dims: 3072 } });

// ===== EPISODIC MEMORY: Ví dụ mẫu (few-shot) lưu trong Store =====

// Đường dẫn lưu ví dụ mẫu, chia theo user.
// Ví dụ: ["email_assistant", "lance", "examples"].
function examplesNamespace(userId) {
  return ["email_assistant", userId, "examples"];
}

// Chuyển 1 cặp email + nhãn thành đoạn văn bản để chèn vào prompt.
// Cắt thread còn 400 ký tự đầu để tiết kiệm token.
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

// Gộp các ví dụ tìm được thành 1 khối few-shot.
// Trả về null nếu Store chưa có ví dụ nào.
function formatFewShotExamples(matches) {
  if (matches.length === 0) return null;

  const blocks = matches.map((match) => formatExample(match.value));
  return ["Here are some previous examples:", ...blocks].join(
    "\n\n------------\n\n",
  );
}

// Nạp sẵn 2 ví dụ mẫu vào Store để triage có cái tham khảo ngay từ đầu.
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

// Tìm thử ví dụ mẫu bằng 1 email gần giống email của Sarah.
// Chỉ in kết quả, chưa đưa vào triage_router.
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

  console.log(formatFewShotExamples(results));
}

// ===== TRIAGE ROUTER & RESPONSE AGENT =====

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

// System prompt của response agent, liệt kê 5 tool:
// 3 tool xử lý email và lịch họp, 2 tool đọc ghi semantic memory.
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

// Đường dẫn lưu semantic memory của response_agent.
// Tách khỏi "examples" (episodic) để 2 loại bộ nhớ không lẫn nhau.
// "{langgraph_user_id}" được thay bằng userId thật lúc chạy.
const MEMORY_NAMESPACE = [
  "email_assistant",
  "{langgraph_user_id}",
  "collection",
];

const manageMemoryTool = createManageMemoryTool(MEMORY_NAMESPACE);
const searchMemoryTool = createSearchMemoryTool(MEMORY_NAMESPACE);

// Response agent chỉ tạo 1 lần vì instructions cố định, lấy từ profile.js.
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
  // Gắn Store để memory tools đọc ghi semantic memory.
  store,
});

// State: bộ nhớ ngắn hạn, sống trong 1 lượt chạy graph.
// - emailInput: email đang xử lý.
// - messages  : lịch sử trao đổi giữa response_agent và các tool.
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
async function triageRouterNode(state, config) {
  console.log("\n📍 Node: triage_router - đang phân loại email...");

  const userId = config?.configurable?.langgraph_user_id ?? "default";
  const { author, to, subject, emailThread } = state.emailInput;

  // 1. Tìm các email tương tự mà user này đã phân loại trước đó.
  //    Lấy Store qua getStore(config), không dùng biến store ở đầu file.
  //    Đây là cách chuẩn của LangGraph: node và tool lấy Store qua config.
  const graphStore = getStore(config);
  const examples = await graphStore.search(examplesNamespace(userId), {
    query: JSON.stringify({ email: state.emailInput }),
  });

  // 2. Prompt phân loại: quy tắc cố định trong profile.js + ví dụ mẫu vừa tìm được.
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

  // Agent trả về toàn bộ lịch sử message, ghi cả mảng vào state.
  // Không bị nhân đôi vì messagesStateReducer gộp message trùng id.
  return { messages: result.messages };
}

// Khai báo và biên dịch graph:
// 1. START -> triage_router.
// 2. respond -> response_agent. Nhãn khác -> END.
const emailAgent = new StateGraph(EmailAgentState)
  // ends: các node mà Command({ goto }) có thể nhảy tới.
  .addNode("triage_router", triageRouterNode, {
    ends: ["response_agent", END],
  })
  .addNode("response_agent", responseAgentNode)
  .addEdge(START, "triage_router")
  // Gắn Store để các node truy cập được bộ nhớ dài hạn.
  .compile({ store });

// Chạy graph với 1 email, in toàn bộ lịch sử message.
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

// ===== KỊCH BẢN MINH HỌA =====

// Email cố tình mơ hồ:
// - Nội dung giống câu hỏi thật, nên LLM dễ xếp RESPOND.
// - Người gửi là đối tác lạ ngoài công ty, John muốn IGNORE.
// Rules hiện tại không phân biệt được, nên lần đầu LLM xếp sai.
// Episodic memory dùng để sửa đúng trường hợp này.
const ambiguousEmail = {
  author: "Tom Jones <tom.jones@bar.com>",
  to: "John Doe <john.doe@company.com>",
  subject: "Quick question about API documentation",
  emailThread: `Hi John,

Quick question - does your team's documentation cover custom integrations? Would love to see a sample if you have one handy.

Thanks,
Tom`,
};

// Cùng ý với ambiguousEmail, khác câu chữ và người gửi.
// Kiểm tra tìm theo ý nghĩa có ra được ví dụ cũ không.
const paraphrasedEmail = {
  ...ambiguousEmail,
  author: "Jim Jones <jim.jones@bar.com>",
  emailThread: `Hi John,

Just a quick one - does your documentation support custom integrations? Could you share a sample?

Thanks,
Jim`,
};

// Chạy khi user "harrison" chưa có ví dụ nào trong Store.
async function runWithoutMemory() {
  await runEmail(ambiguousEmail, "harrison");
}

// Sửa sai: lưu email + nhãn đúng (IGNORE) vào Store của "harrison" rồi chạy lại.
// Chỉ cần sửa 1 lần, các lần sau triage phân loại đúng.
async function correctAndRunWithMemory() {
  await store.put(examplesNamespace("harrison"), randomUUID(), {
    email: ambiguousEmail,
    label: "ignore",
  });

  await runEmail(ambiguousEmail, "harrison");
}

async function demoEpisodicLearning() {
  // Nạp 2 ví dụ mẫu cho user "lance".
  await seedExamples("lance");

  // Demo tìm email tương tự trong Store, chỉ in ra.
  console.log("\n===== Demo: few-shot search =====");
  await demoFewShotSearch("lance");

  // Vòng 1: chưa có ví dụ, LLM tự phân loại, ra RESPOND (sai).
  console.log("\n===== TRƯỚC KHI SỬA - kỳ vọng RESPOND =====");
  await runWithoutMemory();

  // Vòng 2: đã có ví dụ nhãn IGNORE, triage tìm thấy và xếp IGNORE (đúng).
  console.log("\n===== SAU KHI SỬA - kỳ vọng IGNORE =====");
  await correctAndRunWithMemory();

  // Vòng 3: email khác câu chữ nhưng cùng ý, vẫn tìm được ví dụ cũ, ra IGNORE.
  console.log("\n===== EMAIL TƯƠNG TỰ VỚI CÂU CHỮ KHÁC - kỳ vọng IGNORE =====");
  await runEmail(paraphrasedEmail, "harrison");

  // Vòng 4: user andrew có namespace riêng, không thấy ví dụ của harrison -> RESPOND.
  console.log("\n===== USER KHÁC (USER=ANDREW) - kỳ vọng RESPOND =====");
  await runEmail(paraphrasedEmail, "andrew");
}

async function main() {
  await demoEpisodicLearning();
}

main();
