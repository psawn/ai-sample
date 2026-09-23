// =======================================================================
// EMAIL ASSISTANT (TYPESAFE) - BƯỚC 3: GHÉP TRIAGE + RESPONSE AGENT THÀNH 1 GRAPH
//
// Email agent hoàn chỉnh: phân loại email, rồi gọi tool nhiều bước tới khi xử lý xong.
// Viết lại từ langchain/14-email-assistant/03-full-email-agent.js (gọi tắt: "file gốc").
//
// Khác biệt kiến trúc:
// - File gốc: triage bằng withStructuredOutput, trả lời bằng createAgent.
//   Vòng lặp ReAct do framework quản lý.
// - File này: vẫn dùng LangGraph, nhưng TypeSafe ra mọi quyết định điều hướng,
//   Gemini chỉ sinh nội dung. Vòng lặp ReAct tự dựng bằng 2 node.
//
// Luồng chạy:
//   1. triage_router (TypeSafe): phân loại email.
//      - ignore / notify -> END, không gọi Gemini.
//      - confidence dưới ngưỡng -> END, để người xử lý.
//      - respond -> choose_action.
//   2. choose_action (TypeSafe): chọn bước tiếp theo từ email + steps.
//      - "done" hoặc vượt MAX_STEPS -> END.
//      - tên tool -> run_tool.
//   3. run_tool (Gemini + tool): điền tham số, chạy tool, ghi kết quả vào steps,
//      quay lại choose_action.
//
// Node 2 và 3 lặp qua lại = vòng lặp ReAct. File 02 chỉ chạy được 1 bước.
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
} = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  profile,
  triageRules,
  questionEmail,
  spamEmail,
} = require("../langchain/14-email-assistant/profile");
const {
  writeEmail,
  scheduleMeeting,
  checkCalendarAvailability,
} = require("../langchain/14-email-assistant/tools");

// Phân vai: TypeSafe ra quyết định, Gemini sinh nội dung.
const typesafe = new TypeSafeClient();
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// toolsByName: tra tool theo tên TypeSafe trả về.
const tools = [writeEmail, scheduleMeeting, checkCalendarAvailability];
const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

const CONFIDENCE_THRESHOLD = 0.7; // Phân loại dưới mức này -> để người xử lý.
const MAX_STEPS = 4; // Chống lặp vô hạn giữa choose_action <-> run_tool.

// ===== CÂU HỎI CHO TYPESAFE =====

// Dùng ở node 1: email thuộc nhóm nào?
const triageQuestion = choice(
  `You are triaging emails for ${profile.fullName}. Classify this email.`,
  {
    ignore: triageRules.ignore,
    notify: triageRules.notify,
    respond: triageRules.respond,
  },
);

// Dùng ở node 2: bước tiếp theo là gì?
// Mô tả mỗi nhãn ghi rõ khi nào dùng, khi nào không.
// Mô tả này dùng để chọn tool. tool.description dùng để điền tham số.
// File 02 dùng thẳng tool.description (chỉ nói tool làm gì) nên model phân vân.
const actionQuestion = choice(
  `You are ${profile.fullName}'s executive assistant handling an incoming email. ` +
    "Given the steps already taken, which single action should be taken next?",
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

// ===== STATE CỦA GRAPH =====
// - emailInput: email đang xử lý, giữ nguyên suốt lượt chạy.
// - nextTool  : tool choose_action vừa chọn, run_tool đọc để chạy.
// - steps     : các tool đã chạy [{ tool, args, result }], reducer nối thêm vào cuối.
//   TypeSafe đọc steps ở mỗi vòng để chọn bước tiếp.
const EmailAgentState = Annotation.Root({
  emailInput: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => null,
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
async function triageRouterNode(state) {
  console.log("\n📍 Node: triage_router");

  const response = await askTypeSafe({
    state: { recipient: profile, email: state.emailInput },
    questions: { category: triageQuestion },
  });
  const { category } = response.answers;

  if (category.confidence < CONFIDENCE_THRESHOLD) {
    console.log(
      `\n👉 Action: 🤔 Low confidence (${category.confidence}) -> ask the user to review`,
    );
    return new Command({ goto: END });
  }

  if (category.choice === "respond") {
    console.log("\n👉 Action: 📧 RESPOND -> choose_action");
    return new Command({ goto: "choose_action" });
  }

  // ignore / notify: kết thúc, không gọi Gemini lần nào.
  console.log(
    `\n👉 Action: ${category.choice === "ignore" ? "🙈 IGNORE" : "🔔 NOTIFY"} -> END`,
  );
  return new Command({ goto: END });
}

// ===== NODE 2: CHỌN BƯỚC TIẾP THEO =====
async function chooseActionNode(state) {
  console.log(`\n📍 Node: choose_action (step ${state.steps.length + 1})`);

  if (state.steps.length >= MAX_STEPS) {
    console.log(`\n👉 Action: ⛔ Reached MAX_STEPS (${MAX_STEPS}) -> END`);
    return new Command({ goto: END });
  }

  const response = await askTypeSafe({
    state: {
      assistantFor: profile,
      email: state.emailInput,
      stepsTaken: state.steps, // Vòng đầu là [].
    },
    questions: { action: actionQuestion },
  });
  const { action } = response.answers;

  if (action.choice === "done") {
    console.log("\n👉 Action: ✅ done -> END");
    return new Command({ goto: END });
  }

  console.log(`\n👉 Action: ${action.choice} -> run_tool`);
  return new Command({ goto: "run_tool", update: { nextTool: action.choice } });
}

// ===== NODE 3: SINH THAM SỐ + CHẠY TOOL =====
async function runToolNode(state) {
  const tool = toolsByName[state.nextTool];
  console.log(`\n📍 Node: run_tool (${tool.name})`);

  // Prompt gồm email + steps trước đó (ví dụ khung giờ vừa tra được),
  // để tham số sinh ra đúng ngữ cảnh.
  const args = await llm.withStructuredOutput(tool.schema).invoke([
    {
      role: "system",
      content:
        `You fill in arguments for the tool "${tool.name}" (${tool.description}) ` +
        `on behalf of ${profile.fullName} <john.doe@company.com>, ${profile.userProfileBackground}. ` +
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

// ===== KHAI BÁO GRAPH =====
// ends: các node mà Command({ goto }) có thể nhảy tới.
const emailAgent = new StateGraph(EmailAgentState)
  .addNode("triage_router", triageRouterNode, { ends: ["choose_action", END] })
  .addNode("choose_action", chooseActionNode, { ends: ["run_tool", END] })
  .addNode("run_tool", runToolNode, { ends: ["choose_action"] })
  .addEdge(START, "triage_router")
  .compile();

async function runEmail(emailInput) {
  console.log(`\n========== Email: "${emailInput.subject}" ==========`);

  const result = await emailAgent.invoke({ emailInput });

  console.log("\n🧾 Steps taken:");
  console.dir(result.steps, { depth: null });
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // await runEmail(spamEmail); // Kỳ vọng: IGNORE, không có step nào.
  await runEmail(questionEmail); // Kỳ vọng: RESPOND -> write_email -> done.
}

main();
