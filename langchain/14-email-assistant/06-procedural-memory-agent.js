// =======================================================================
// EMAIL ASSISTANT - BƯỚC 6: PROCEDURAL MEMORY & LLM SELF-OPTIMIZATION
//
// Agent tự sửa chỉ dẫn làm việc của mình theo góp ý của user.
//
// 3 loại bộ nhớ:
// 1. Semantic  : nhớ dữ liệu, sự việc.
// 2. Episodic  : nhớ tình huống cũ để làm ví dụ mẫu.
// 3. Procedural: nhớ chỉ dẫn làm việc (phần system prompt). Bước này thêm loại 3.
//
// Chỉ dẫn nằm trong Store, agent đọc lại ở mỗi lượt chạy.
// User góp ý -> Optimizer (1 LLM khác) sửa chỉ dẫn trong Store
// -> agent đổi hành vi mà không phải sửa code hay khởi động lại server.
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

// Store dùng chung cho 3 loại bộ nhớ:
// 1. Semantic  : thông tin cần nhớ, namespace "collection".
// 2. Episodic  : ví dụ mẫu cho triage, namespace "examples".
// 3. Procedural: chỉ dẫn làm việc, namespace [userId].
// dims = số chiều vector của gemini-embedding-001.
const store = new InMemoryStore({ index: { embeddings, dims: 3072 } });

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

Just wanted to let you know that I've deployed the new authentication endpoints we discussed to the staging environment. No immediate action needed from your side - just keeping you in the loop.

Best regards,
Sarah`,
    },
    label: "ignore",
  });
}

// ===== PROCEDURAL MEMORY: CHỈ DẪN LÀM VIỆC LƯU TRONG STORE =====

// Đường dẫn lưu chỉ dẫn, chia theo user. Ví dụ: ["lance"].
function proceduralNamespace(userId) {
  return [userId];
}

// Key của 4 chỉ dẫn trong Store: 1 cho response agent, 3 cho triage.
const PROCEDURAL_KEYS = {
  agentInstructions: "agent_instructions",
  triageIgnore: "triage_ignore",
  triageNotify: "triage_notify",
  triageRespond: "triage_respond",
};

// Đọc chỉ dẫn từ Store. Chưa có thì ghi giá trị mặc định rồi trả về.
async function getOrSeedInstruction({ store, userId, key, defaultPrompt }) {
  const namespace = proceduralNamespace(userId);
  const existing = await store.get(namespace, key);

  if (existing) return existing.value.prompt;

  await store.put(namespace, key, { prompt: defaultPrompt });
  return defaultPrompt;
}

// Cập nhật chỉ dẫn trong Store.
async function setInstruction({ store, userId, key, prompt }) {
  await store.put(proceduralNamespace(userId), key, { prompt });
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

// System prompt của response agent, kèm danh sách tool.
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
// "{langgraph_user_id}" được thay bằng userId thật lúc chạy.
const MEMORY_NAMESPACE = [
  "email_assistant",
  "{langgraph_user_id}",
  "collection",
];

const manageMemoryTool = createManageMemoryTool(MEMORY_NAMESPACE);
const searchMemoryTool = createSearchMemoryTool(MEMORY_NAMESPACE);

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
  const graphStore = getStore(config);

  // 1. Tìm các email mẫu tương tự của user này.
  const examples = await graphStore.search(examplesNamespace(userId), {
    query: JSON.stringify({ email: state.emailInput }),
  });

  // 2. Đọc 3 quy tắc phân loại từ Store.
  const ignorePrompt = await getOrSeedInstruction({
    store: graphStore,
    userId,
    key: PROCEDURAL_KEYS.triageIgnore,
    defaultPrompt: triageRules.ignore,
  });

  const notifyPrompt = await getOrSeedInstruction({
    store: graphStore,
    userId,
    key: PROCEDURAL_KEYS.triageNotify,
    defaultPrompt: triageRules.notify,
  });

  const respondPrompt = await getOrSeedInstruction({
    store: graphStore,
    userId,
    key: PROCEDURAL_KEYS.triageRespond,
    defaultPrompt: triageRules.respond,
  });

  // 3. Ghép prompt phân loại từ quy tắc mới nhất + ví dụ mẫu.
  const systemPrompt = buildTriageSystemPrompt({
    fullName: profile.fullName,
    name: profile.name,
    userProfileBackground: profile.userProfileBackground,
    triageIgnore: ignorePrompt,
    triageNotify: notifyPrompt,
    triageRespond: respondPrompt,
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

// Node 2: soạn phản hồi hoặc thực thi hành động.
async function responseAgentNode(state, config) {
  console.log(
    "\n📍 Node: response_agent - đang gọi Agent xử lý (tool call)...",
  );

  const userId = config?.configurable?.langgraph_user_id ?? "default";
  const graphStore = getStore(config);

  // Đọc chỉ dẫn mới nhất từ Store.
  const instructions = await getOrSeedInstruction({
    store: graphStore,
    userId,
    key: PROCEDURAL_KEYS.agentInstructions,
    defaultPrompt: agentInstructions,
  });

  // Tạo agent mới mỗi lượt chạy để luôn dùng chỉ dẫn mới nhất.
  // Bước 04, 05 chỉ tạo 1 lần vì chỉ dẫn cố định.
  const agent = createAgent({
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
      instructions,
    }),

    // Gắn Store cho các memory tools.
    store: graphStore,
  });

  const result = await agent.invoke({ messages: state.messages }, config);

  return { messages: result.messages };
}

// Khai báo và biên dịch graph. ends: các node mà Command({ goto }) có thể nhảy tới.
const emailAgent = new StateGraph(EmailAgentState)
  .addNode("triage_router", triageRouterNode, {
    ends: ["response_agent", END],
  })
  .addNode("response_agent", responseAgentNode)
  .addEdge(START, "triage_router")
  .compile({ store });

// Chạy graph với 1 email. Trả về result để Optimizer đọc lại messages.
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

  return result;
}

// Email thử: người gửi ngoài công ty, nội dung khẩn cấp.
// Với chỉ dẫn mặc định, kỳ vọng nhãn RESPOND.
const urgentEmail = {
  author: "Alice Jones <alice.jones@bar.com>",
  to: "John Doe <john.doe@company.com>",
  subject: "Quick question about API documentation",
  emailThread: `Hi John,

Urgent issue - your service is down. Is there a reason why`,
};

// In 4 chỉ dẫn hiện có của user.
async function printProceduralMemory(userId) {
  console.log(`\n===== Procedural memory hiện tại của '${userId}' =====`);
  console.log(
    "agent_instructions:",
    await getOrSeedInstruction({
      store,
      userId,
      key: PROCEDURAL_KEYS.agentInstructions,
      defaultPrompt: agentInstructions,
    }),
  );

  console.log(
    "triage_respond:",
    await getOrSeedInstruction({
      store,
      userId,
      key: PROCEDURAL_KEYS.triageRespond,
      defaultPrompt: triageRules.respond,
    }),
  );

  console.log(
    "triage_ignore:",
    await getOrSeedInstruction({
      store,
      userId,
      key: PROCEDURAL_KEYS.triageIgnore,
      defaultPrompt: triageRules.ignore,
    }),
  );

  console.log(
    "triage_notify:",
    await getOrSeedInstruction({
      store,
      userId,
      key: PROCEDURAL_KEYS.triageNotify,
      defaultPrompt: triageRules.notify,
    }),
  );
}

// ===== OPTIMIZER: LLM CẬP NHẬT CHỈ DẪN TỪ FEEDBACK =====

// Schema đầu ra của Optimizer: mảng { name, prompt }, đủ 4 chỉ dẫn.
const OptimizerResult = z.object({
  prompts: z.array(
    z.object({
      name: z.string().describe("Tên chỉ dẫn, giữ nguyên như đầu vào"),
      prompt: z
        .string()
        .describe(
          "Nội dung chỉ dẫn sau khi xử lý: viết lại nếu feedback liên quan, " +
            "giữ nguyên nếu không liên quan",
        ),
    }),
  ),
});

const optimizer = llm.withStructuredOutput(OptimizerResult);

// Prompt cho Optimizer: lượt chạy + feedback + các chỉ dẫn hiện có.
// Mỗi chỉ dẫn kèm when_to_update (khi nào sửa) và update_instructions (sửa thế nào).
function buildOptimizerPrompt({ trajectoryText, feedback, prompts }) {
  const promptsBlock = prompts
    .map(
      (p, i) => `${i + 1}. name: ${p.name}
   when_to_update: ${p.whenToUpdate}
   update_instructions: ${p.updateInstructions}
   current_prompt: """${p.prompt}"""`,
    )
    .join("\n\n");

  return `Bạn là bộ tối ưu prompt cho 1 AI agent xử lý email.

< Trajectory (lượt chạy thực tế của agent) >
${trajectoryText}
</ Trajectory >

< Feedback của người dùng về lượt chạy trên >
${feedback}
</ Feedback của người dùng về lượt chạy trên >

< Các chỉ dẫn hiện có >
${promptsBlock}
</ Các chỉ dẫn hiện có >

Với MỖI chỉ dẫn: nếu "when_to_update" khớp với feedback ở trên, viết lại chỉ dẫn đó
theo đúng "update_instructions". Nếu feedback không liên quan đến chỉ dẫn đó, giữ
nguyên "current_prompt". Trả về đủ tất cả chỉ dẫn, đúng "name", đúng thứ tự đầu vào.`;
}

// Gọi Optimizer, trả về đủ 4 chỉ dẫn (đã sửa hoặc giữ nguyên).
async function optimizePrompts({ messages, feedback, prompts }) {
  // Chuyển lịch sử message thành trajectory để Optimizer đọc ngữ cảnh.
  const trajectoryText = messages
    .map((message) => {
      const content =
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content);
      return `${message.type ?? message.role}: ${content}`;
    })
    .join("\n");

  const result = await optimizer.invoke([
    {
      role: "user",
      content: buildOptimizerPrompt({ trajectoryText, feedback, prompts }),
    },
  ]);

  return result.prompts;
}

// Lấy 4 chỉ dẫn hiện tại để gửi cho Optimizer.
// - key        : để ghi lại vào Store.
// - name       : tên Optimizer thấy.
// - whenToUpdate / updateInstructions: khi nào sửa, sửa thế nào.
async function buildPromptSpecs(userId) {
  return [
    {
      key: PROCEDURAL_KEYS.agentInstructions,
      name: "main_agent",
      prompt: await getOrSeedInstruction({
        store,
        userId,
        key: PROCEDURAL_KEYS.agentInstructions,
        defaultPrompt: agentInstructions,
      }),
      updateInstructions: "keep the instructions short and to the point",
      whenToUpdate:
        "Update this prompt whenever there is feedback on how the agent should write emails or schedule events",
    },
    {
      key: PROCEDURAL_KEYS.triageIgnore,
      name: "triage-ignore",
      prompt: await getOrSeedInstruction({
        store,
        userId,
        key: PROCEDURAL_KEYS.triageIgnore,
        defaultPrompt: triageRules.ignore,
      }),
      updateInstructions: "keep the instructions short and to the point",
      whenToUpdate:
        "Update this prompt whenever there is feedback on which emails should be ignored",
    },
    {
      key: PROCEDURAL_KEYS.triageNotify,
      name: "triage-notify",
      prompt: await getOrSeedInstruction({
        store,
        userId,
        key: PROCEDURAL_KEYS.triageNotify,
        defaultPrompt: triageRules.notify,
      }),
      updateInstructions: "keep the instructions short and to the point",
      whenToUpdate:
        "Update this prompt whenever there is feedback on which emails the user should be notified of",
    },
    {
      key: PROCEDURAL_KEYS.triageRespond,
      name: "triage-respond",
      prompt: await getOrSeedInstruction({
        store,
        userId,
        key: PROCEDURAL_KEYS.triageRespond,
        defaultPrompt: triageRules.respond,
      }),
      updateInstructions: "keep the instructions short and to the point",
      whenToUpdate:
        "Update this prompt whenever there is feedback on which emails should be responded to",
    },
  ];
}

// So sánh trước/sau theo thứ tự, chỉ ghi chỉ dẫn có thay đổi vào Store.
async function applyOptimizerUpdates(userId, prompts, updatedPrompts) {
  for (let i = 0; i < prompts.length; i += 1) {
    const before = prompts[i];
    const after = updatedPrompts[i];

    if (after.prompt !== before.prompt) {
      console.log(`  ✏️  Cập nhật "${before.name}"`);
      await setInstruction({
        store,
        userId,
        key: before.key,
        prompt: after.prompt,
      });
    }
  }
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const userId = "lance";

  // Nạp dữ liệu mẫu vào Store.
  await seedExamples(userId);

  // Demo gồm 2 vòng feedback, mỗi vòng 3 bước:
  //   1. Chạy trước khi có feedback.
  //   2. Optimizer cập nhật chỉ dẫn.
  //   3. Chạy lại để đối chiếu.
  // Cả 2 vòng dùng chung urgentEmail cho dễ so sánh.

  // Vòng 1: feedback về cách viết email, kỳ vọng thêm chữ ký "John Doe".

  // 1. Trước feedback: agent trả lời theo chỉ dẫn mặc định.
  //    Giữ lại messages cho Optimizer đọc.
  console.log("\n===== Vòng 1 - Bước 1: chạy TRƯỚC khi có feedback =====");
  const round1BeforeFeedback = await runEmail(urgentEmail, userId);

  // 2. Áp dụng feedback: Optimizer sửa chỉ dẫn rồi ghi vào Store.
  //    Kỳ vọng chỉ "main_agent" thay đổi.
  console.log(
    '\n===== Vòng 1 - Bước 2: áp dụng feedback "Always sign your emails `John Doe`" =====',
  );
  let prompts = await buildPromptSpecs(userId);
  let updated = await optimizePrompts({
    messages: round1BeforeFeedback.messages,
    feedback: "Always sign your emails `John Doe`",
    prompts,
  });

  await applyOptimizerUpdates(userId, prompts, updated);

  // 3. Sau feedback: chạy lại cùng email đó.
  //    Kỳ vọng email có chữ ký "John Doe".
  console.log(
    '\n===== Vòng 1 - Bước 3: chạy lại SAU feedback - kỳ vọng email ký tên "John Doe" =====',
  );
  const round1AfterFeedback = await runEmail(urgentEmail, userId);

  // Vòng 2: feedback về triage, kỳ vọng bỏ qua email của Alice Jones.

  // 1. Trước feedback: dùng kết quả bước 3 của vòng 1.
  //    Email đang bị xếp RESPOND và có chữ ký "John Doe".
  const round2BeforeFeedback = round1AfterFeedback;

  // 2. Áp dụng feedback. Kỳ vọng chỉ "triage-ignore" thay đổi.
  console.log(
    '\n===== Vòng 2 - Bước 2: áp dụng feedback "Ignore any emails from Alice Jones" =====',
  );
  prompts = await buildPromptSpecs(userId);
  updated = await optimizePrompts({
    messages: round2BeforeFeedback.messages,
    feedback: "Ignore any emails from Alice Jones",
    prompts,
  });

  await applyOptimizerUpdates(userId, prompts, updated);

  // 3. Sau feedback: chạy lại cùng email. Kỳ vọng IGNORE.
  console.log(
    "\n===== Vòng 2 - Bước 3: chạy lại SAU feedback - kỳ vọng IGNORE vì người gửi là Alice Jones =====",
  );
  await runEmail(urgentEmail, userId);

  // Kết quả cuối: in các chỉ dẫn để xem Optimizer đã sửa gì.
  // - agent_instructions: thêm chữ ký "John Doe".
  // - triage_ignore: bỏ qua email của Alice Jones.
  await printProceduralMemory(userId);
}

main();

