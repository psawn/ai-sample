// =======================================================================
// EMAIL ASSISTANT (TYPESAFE) - BƯỚC 4 (BẢN NHIỀU NODE): SEMANTIC MEMORY
//
// Email assistant có semantic memory, tách thành 5 node.
// Cùng bài toán với typesafe/04-semantic-memory-agent.js (gọi tắt: "bản 2 node").
//
// Khác biệt kiến trúc:
// - Bản 2 node: memory là tool, agent tự quyết có tìm, có lưu hay không.
//   Rủi ro: quên tìm, tìm nhiều lần, hoặc quên lưu.
// - Bản này: memory là node, graph luôn đi qua đúng 1 lần.
//   Không lặp, không quên, nên không cần rule "AT MOST ONCE" trong prompt.
//
// Luồng chạy:
//   1. triage_router : phân loại email. Chỉ nhãn "respond" mới đi tiếp.
//   2. recall_memory : tìm memory liên quan, nếu email cần ngữ cảnh cũ.
//   3. choose_action : chọn tool kế tiếp, hoặc "done".
//   4. run_tool      : chạy tool vừa chọn, rồi quay lại node 3.
//   5. save_memory   : tạo memory mới, hoặc cập nhật memory cũ.
//
// Phân vai: TypeSafe ra mọi quyết định (kèm xác suất), Gemini sinh nội dung
// (tham số tool, nội dung email, nội dung memory).
// =======================================================================

require("../langchain/_polyfill");
require("dotenv").config();

const { choice, noul, TypeSafeClient } = require("@typesafe-ai/sdk");
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
} = require("../langchain/14-email-assistant/memory-tools");

const typesafe = new TypeSafeClient();
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Biến văn bản thành vector, để Store tìm memory theo ý nghĩa (không cần khớp từ).
const embeddings = new GoogleGenerativeAIEmbeddings({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-embedding-001",
});

// Store = bộ nhớ dài hạn, dùng chung cho mọi email -> email sau đọc được email trước.
// dims = số chiều vector của gemini-embedding-001.
const store = new InMemoryStore({ index: { embeddings, dims: 3072 } });

// Mỗi user có ngăn memory riêng. "{langgraph_user_id}" được thay bằng "lance".
const config = { configurable: { langgraph_user_id: "lance" } };

// Dùng lại tool ghi memory của langchain/14-email-assistant/memory-tools.js.
const manageMemoryTool = createManageMemoryTool([
  "email_assistant",
  "{langgraph_user_id}",
  "collection",
]);

// Ngăn memory của "lance", dùng khi đọc Store trực tiếp.
// Không dùng search_memory tool: nó trả về chuỗi, không có key để cập nhật memory.
const MEMORY_NAMESPACE = ["email_assistant", "lance", "collection"];

// Memory là node riêng, nên chỉ còn 3 tool xử lý email.
// toolsByName: tra tool theo tên TypeSafe trả về.
const tools = [writeEmail, scheduleMeeting, checkCalendarAvailability];
const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

const CONFIDENCE_THRESHOLD = 0.7; // Phân loại dưới mức này -> nhờ người xem lại.
const MAX_STEPS = 4; // Chặn vòng lặp choose_action <-> run_tool.
const MEMORY_THRESHOLD = 0.5; // Xác suất từ mức này trở lên -> coi là "có".

// Email hỏi tiếp, KHÔNG nhắc lại nội dung cũ.
// Muốn trả lời đúng, phải tìm lại memory của email trước.
const followUpEmail = {
  author: "Alice Smith <alice.smith@company.com>",
  to: "John Doe <john.doe@company.com>",
  subject: "Follow up",
  emailThread: `Hi John, Any update on my previous ask?`,
};

// ===== CÁC CÂU HỎI GỬI TYPESAFE =====

// Dùng ở node 1: email thuộc nhóm nào?
const triageQuestion = choice(
  `You are triaging emails for ${profile.fullName}. Classify this email.`,
  {
    ignore: triageRules.ignore,
    notify: triageRules.notify,
    respond: triageRules.respond,
  },
);

// Dùng ở node 3: bước tiếp theo là gì?
// Mô tả mỗi nhãn ghi rõ khi nào dùng, khi nào không.
// Không dùng thẳng tool.description: nó viết cho việc điền tham số,
// chỉ nói tool làm gì ("Write and send an email.") -> model dễ phân vân.
const actionQuestion = choice(
  `You are ${profile.fullName}'s executive assistant handling an incoming email. ` +
    "Given the relevant memories and the steps already taken, which single action should be taken next?",
  {
    write_email:
      "Reply to the sender by email. Use this for questions that can be answered " +
      "in writing, and only if no reply has been sent yet.",
    schedule_meeting:
      "Book a meeting. Use this only if the sender explicitly asks for a meeting " +
      "and the available time slots are already known.",
    check_calendar_availability:
      "Look up free time slots. Use this only if a meeting is requested and " +
      "availability has not been checked yet.",
    done: "The email has been fully handled (e.g. a reply was already sent). Stop.",
  },
);

// Dùng ở node 2: email có nhắc tới chuyện cũ không?
const needsMemoryQuestion = noul(
  "Does this email refer to earlier conversations, requests or context " +
    "that are NOT contained in the email itself?",
  {
    true: "The email relies on earlier context (e.g. 'my previous ask', 'as discussed').",
    false: "The email is self-contained.",
  },
);

// Dùng ở node 5: làm gì với memory?
// Nhãn thay đổi theo từng email: mỗi memory cũ thêm 1 nhãn "update:<key>".
// -> 1 câu hỏi trả lời luôn 2 việc: làm gì, và cập nhật memory nào.
function buildMemoryActionQuestion(memories) {
  return choice(
    "After handling this email, what should be done with the assistant's long-term memory " +
      "(requests, decisions, promises, facts about people or projects)?",
    {
      skip: "Nothing new worth remembering.",
      create: "Store a NEW memory; no existing memory covers this topic.",
      ...Object.fromEntries(
        memories.map((m) => [
          `update:${m.key}`,
          `Update this existing memory on the same topic with the new information: "${m.content}"`,
        ]),
      ),
    },
  );
}

// ===== HÀM TRỢ GIÚP =====

// Gọi systemOne(), in request và response.
async function askTypeSafe(params) {
  console.log("📤 TypeSafe request params:");
  console.dir(params, { depth: null });

  const response = await typesafe.systemOne(params);

  console.log("📦 TypeSafe response:");
  console.dir(response, { depth: null });

  return response;
}

// ===== STATE: DỮ LIỆU CHUNG, CÁC NODE CÙNG ĐỌC / GHI =====
// - emailInput: email đang xử lý.
// - memories  : memory liên quan, node 2 ghi. Dạng [{ key, content }].
// - nextTool  : tool node 3 vừa chọn, node 4 đọc để chạy.
// - steps     : các tool đã chạy. Dạng [{ tool, args, result }].
//
// reducer quyết định cách ghi:
// - "update ?? current": có giá trị mới thì thay, không thì giữ.
// - "concat"           : nối thêm vào cuối (steps chỉ tăng, không mất).
const EmailAgentState = Annotation.Root({
  emailInput: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => null,
  }),
  memories: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => [],
  }),
  nextTool: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => null,
  }),
  steps: Annotation({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
});

// ===== NODE 1: PHÂN LOẠI EMAIL =====
// Chỉ "respond" đi tiếp. Còn lại dừng luôn, không gọi Gemini.
async function triageRouterNode(state) {
  console.log("\n📍 Node: triage_router");

  const response = await askTypeSafe({
    state: { recipient: profile, email: state.emailInput },
    questions: { category: triageQuestion },
  });
  const { category } = response.answers;

  // Model không chắc -> dừng, để user tự xem.
  if (category.confidence < CONFIDENCE_THRESHOLD) {
    console.log(
      `\n👉 Action: 🤔 Low confidence (${category.confidence}) -> ask the user to review`,
    );
    return new Command({ goto: END });
  }

  if (category.choice === "respond") {
    console.log("\n👉 Action: 📧 RESPOND -> recall_memory");
    return new Command({ goto: "recall_memory" });
  }

  console.log(
    `\n👉 Action: ${category.choice === "ignore" ? "🙈 IGNORE" : "🔔 NOTIFY"} -> END`,
  );
  return new Command({ goto: END });
}

// ===== NODE 2: TÌM MEMORY LIÊN QUAN =====
// 3 bước: có cần tìm không -> tìm -> lọc bỏ memory không liên quan.
async function recallMemoryNode(state) {
  console.log("\n📍 Node: recall_memory");

  // Bước 1: email tự đủ ý thì không cần tìm.
  const needs = await askTypeSafe({
    state: { email: state.emailInput },
    questions: { needsMemory: needsMemoryQuestion },
  });

  if (needs.answers.needsMemory.noul < MEMORY_THRESHOLD) {
    console.log("\n👉 Action: ⏭️  Email is self-contained -> skip memory search");
    return new Command({ goto: "choose_action" });
  }

  // Bước 2: tìm theo ý nghĩa. Dùng luôn nội dung email làm câu tìm kiếm.
  const { subject, emailThread, author } = state.emailInput;
  const found = await store.search(MEMORY_NAMESPACE, {
    query: `${author} ${subject} ${emailThread}`,
    limit: 5,
  });

  console.log(`\n🔎 Store search -> ${found.length} memories:`);
  found.forEach((item) =>
    console.log(`   - (score ${item.score?.toFixed(3)}) ${item.value.content}`),
  );

  if (found.length === 0) {
    console.log("\n👉 Action: 📭 No memories -> choose_action");
    return new Command({ goto: "choose_action" });
  }

  // Bước 3: lọc. Store luôn trả về memory "gần nhất", kể cả khi không liên quan.
  // Mỗi memory là 1 câu hỏi có/không, gửi chung trong 1 request.
  const questions = Object.fromEntries(
    found.map((item, i) => [
      `memory_${i}`,
      noul(`Is this memory relevant to handling the email? Memory: "${item.value.content}"`),
    ]),
  );
  const relevance = await askTypeSafe({
    state: { email: state.emailInput },
    questions,
  });

  const memories = found
    .filter((_, i) => relevance.answers[`memory_${i}`].noul >= MEMORY_THRESHOLD)
    .map((item) => ({ key: item.key, content: item.value.content }));

  console.log(`\n👉 Action: 🧠 Keep ${memories.length}/${found.length} relevant memories`);
  return new Command({ goto: "choose_action", update: { memories } });
}

// ===== NODE 3: CHỌN BƯỚC TIẾP THEO =====
// Nhìn email + memory + các bước đã làm, rồi chọn: chạy tool nào, hay đã xong.
async function chooseActionNode(state) {
  console.log(`\n📍 Node: choose_action (step ${state.steps.length + 1})`);

  // Chốt chặn an toàn: quá số bước thì dừng.
  if (state.steps.length >= MAX_STEPS) {
    console.log(`\n👉 Action: ⛔ Reached MAX_STEPS (${MAX_STEPS}) -> save_memory`);
    return new Command({ goto: "save_memory" });
  }

  const response = await askTypeSafe({
    state: {
      assistantFor: profile,
      email: state.emailInput,
      relevantMemories: state.memories.map((m) => m.content),
      stepsTaken: state.steps,
    },
    questions: { action: actionQuestion },
  });
  const { action } = response.answers;

  if (action.choice === "done") {
    console.log("\n👉 Action: ✅ done -> save_memory");
    return new Command({ goto: "save_memory" });
  }

  // Ghi tên tool vào state để node 4 biết cần chạy tool nào.
  console.log(`\n👉 Action: ${action.choice} -> run_tool`);
  return new Command({ goto: "run_tool", update: { nextTool: action.choice } });
}

// ===== NODE 4: CHẠY TOOL =====
// Gemini điền tham số -> chạy tool -> lưu kết quả -> quay lại node 3.
async function runToolNode(state) {
  const tool = toolsByName[state.nextTool];
  console.log(`\n📍 Node: run_tool (${tool.name})`);

  // Gemini trả tham số đúng theo tool.schema.
  // Prompt dặn: chỉ dùng thông tin có thật, không bịa.
  const args = await llm.withStructuredOutput(tool.schema).invoke([
    {
      role: "system",
      content:
        `You fill in arguments for the tool "${tool.name}" (${tool.description}) ` +
        `on behalf of ${profile.fullName} <john.doe@company.com>, ${profile.userProfileBackground}.\n` +
        "Only use facts from the email, the memories and the previous steps. " +
        "Do not invent facts; if something is unknown, say you will look into it.\n" +
        `Relevant memories: ${JSON.stringify(state.memories.map((m) => m.content))}\n` +
        `Previous steps: ${JSON.stringify(state.steps)}`,
    },
    {
      role: "user",
      content: `Handle this email: ${JSON.stringify(state.emailInput)}`,
    },
  ]);
  const result = await tool.invoke(args);

  console.log("💬 Gemini response (tool args):");
  console.dir(args, { depth: null });
  console.log(`🔧 Tool result: ${result}`);

  return new Command({
    goto: "choose_action",
    update: { steps: [{ tool: tool.name, args, result }] },
  });
}

// ===== NODE 5: LƯU MEMORY =====
// TypeSafe chọn làm gì -> Gemini viết nội dung -> manage_memory ghi vào Store.
// nodeConfig có sẵn store + userId, truyền cho manage_memory để ghi đúng ngăn.
async function saveMemoryNode(state, nodeConfig) {
  console.log("\n📍 Node: save_memory");

  // Bước 1: bỏ qua, tạo mới, hay cập nhật memory cũ?
  const response = await askTypeSafe({
    state: {
      email: state.emailInput,
      stepsTaken: state.steps,
      existingMemories: state.memories,
    },
    questions: { memoryAction: buildMemoryActionQuestion(state.memories) },
  });
  const decision = response.answers.memoryAction.choice;

  if (decision === "skip") {
    console.log("\n👉 Action: ⏭️  Nothing worth remembering -> END");
    return new Command({ goto: END });
  }

  // "update:abc" -> action = "update", id = "abc". "create" -> id = undefined.
  const [action, id] = decision.split(":");
  const existing = state.memories.find((m) => m.key === id);
  console.log(`\n👉 Action: 💾 ${action}${id ? ` memory ${id}` : ""}`);

  // Bước 2: Gemini viết 1 câu tự đủ ý, để sau này tìm lại được.
  // Nếu là cập nhật: gộp thông tin mới vào memory cũ.
  const memory = await llm.invoke([
    {
      role: "system",
      content:
        `Write a memory for ${profile.fullName}'s assistant about this handled email. ` +
        "Reply with ONE self-contained sentence only: who asked what, and what was answered or promised." +
        (existing ? ` Merge it with the existing memory: "${existing.content}"` : ""),
    },
    {
      role: "user",
      content: JSON.stringify({ email: state.emailInput, stepsTaken: state.steps }),
    },
  ]);

  console.log(`💬 Gemini response (memory): ${memory.text}`);

  // Bước 3: ghi vào Store.
  const result = await manageMemoryTool.invoke(
    { action, id, content: memory.text },
    nodeConfig,
  );
  console.log(`🔧 Tool result: ${result}`);

  return new Command({ goto: END });
}

// ===== KHAI BÁO GRAPH =====
// ends: các node mà Command({ goto }) có thể nhảy tới.
const emailAgent = new StateGraph(EmailAgentState)
  .addNode("triage_router", triageRouterNode, { ends: ["recall_memory", END] })
  .addNode("recall_memory", recallMemoryNode, { ends: ["choose_action"] })
  .addNode("choose_action", chooseActionNode, { ends: ["run_tool", "save_memory"] })
  .addNode("run_tool", runToolNode, { ends: ["choose_action"] })
  .addNode("save_memory", saveMemoryNode, { ends: [END] })
  .addEdge(START, "triage_router")
  // Gắn Store vào graph -> mọi node đều truy cập được qua nodeConfig.
  .compile({ store });

async function runEmail(emailInput) {
  console.log(`\n========== Email: "${emailInput.subject}" ==========`);

  const result = await emailAgent.invoke({ emailInput }, config);

  console.log("\n🧾 Steps taken:");
  console.dir(result.steps, { depth: null });
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Email 1: tự đủ ý -> không tìm memory -> trả lời -> TẠO memory mới.
  await runEmail(questionEmail);

  // Email 2: nhắc chuyện cũ -> TÌM ra memory email 1 -> trả lời đúng ngữ cảnh
  // -> CẬP NHẬT memory cũ (không tạo thêm bản gần trùng).
  await runEmail(followUpEmail);

  // Xem Store sau 2 email: chỉ còn 1 memory.
  console.log("\n🗂️  All memories in store:");
  const all = await store.search(MEMORY_NAMESPACE);
  all.forEach((item) => console.log(`   - ${item.value.content}`));
}

main().catch((err) => {
  console.error("❌", err.name, err.status ?? "", err.message);
});
