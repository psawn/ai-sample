// =======================================================================
// EMAIL ASSISTANT - BƯỚC 3: GHÉP TRIAGE + RESPONSE AGENT THÀNH 1 GRAPH
//
// Ghép bước 01 và 02: phân loại email trước, chỉ email cần trả lời mới tới agent.
//
// Graph 2 node, triage_router tự điều hướng bằng Command({ goto }):
//   1. START -> triage_router: phân loại email.
//   2. respond -> response_agent (có tool) -> END.
//   3. ignore / notify -> END, không gọi LLM thêm.
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
} = require("@langchain/langgraph");
const { createAgent } = require("langchain");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  profile,
  triageRules,
  agentInstructions,
  questionEmail,
  spamEmail,
} = require("./profile");
const {
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
  buildAgentSystemPrompt,
} = require("./prompts");
const {
  writeEmail,
  scheduleMeeting,
  checkCalendarAvailability,
} = require("./tools");

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

// Response agent giống bước 02: model + 3 tool xử lý email và lịch họp.
const responseAgent = createAgent({
  model: llm,
  tools: [writeEmail, scheduleMeeting, checkCalendarAvailability],
  systemPrompt: buildAgentSystemPrompt({
    fullName: profile.fullName,
    name: profile.name,
    instructions: agentInstructions,
  }),
});

// State: dữ liệu chung, các node đọc và ghi.
// - emailInput: có giá trị mới thì thay, không thì giữ. Không đổi suốt lượt chạy.
// - messages  : messagesStateReducer nối message mới vào lịch sử.
// invoke({ emailInput }) tạo state ban đầu { emailInput: {...}, messages: [] }.
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

// Node 1: phân loại email, rồi chọn node kế tiếp.
// Command gồm 2 phần: update ghi vào state, goto chọn node tiếp theo.
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

  // "notify": bản thật sẽ gửi thông báo cho người dùng, demo này chỉ dừng.
  console.log(
    "🔔 Classification: NOTIFY - This email contains important information",
  );
  return new Command({ goto: END });
}

// Node 2: chuyển messages hiện tại cho agent có tool (bước 02) xử lý.
async function responseAgentNode(state) {
  console.log("\n📍 Node: response_agent - đang gọi Agent xử lý (tool call)...");

  const result = await responseAgent.invoke({ messages: state.messages });
  return { messages: result.messages };
}

// Khai báo và biên dịch graph.
const emailAgent = new StateGraph(EmailAgentState)
  // ends: các node mà Command({ goto }) có thể nhảy tới.
  // Bắt buộc khai báo vì không có addEdge nào trỏ vào response_agent.
  .addNode(
    "triage_router", // tên node
    triageRouterNode, // hàm chạy khi tới node này
    { ends: ["response_agent", END] }, // các đích node này có thể goto
  )
  .addNode("response_agent", responseAgentNode)
  .addEdge(START, "triage_router")
  .compile();

// Chạy graph với 1 email, in toàn bộ lịch sử message.
async function runEmail(emailInput) {
  console.log(`\n========== Email: "${emailInput.subject}" ==========`);
  const result = await emailAgent.invoke({ emailInput });
  for (const message of result.messages) {
    console.log(
      JSON.stringify({ type: message.type, content: message.content }, null, 2),
    );
    console.log("-".repeat(60));
  }
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // await runEmail(spamEmail); // Kỳ vọng: IGNORE, response_agent không chạy.
  await runEmail(questionEmail); // Kỳ vọng: RESPOND, response_agent gọi tool để trả lời.
}

main();
