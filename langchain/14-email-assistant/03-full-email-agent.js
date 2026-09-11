// Email Assistant - Bước 3: GHÉP TOÀN BỘ thành 1 Graph hoàn chỉnh
//
// Luồng: mỗi email đi qua Node "triage_router" trước. LLM phân loại xong sẽ dùng
// Command({ goto }) để tự điều hướng: email "respond" mới đi tiếp sang Node
// "response_agent" (LLM có Tool, có thể trả lời/xếp lịch); email "ignore"/"notify" thì
// dừng luôn (END), không tốn thêm 1 lượt gọi LLM nào để soạn trả lời.
//
// START -> triage_router
//                ├── ignore -> END
//                ├── notify -> END
//                └── respond -> response_agent -> END

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

const responseAgent = createAgent({
  model: llm,
  tools: [writeEmail, scheduleMeeting, checkCalendarAvailability],
  systemPrompt: buildAgentSystemPrompt({
    fullName: profile.fullName,
    name: profile.name,
    instructions: agentInstructions,
  }),
});

// State = "bộ nhớ chung" của Graph, nơi các Node đọc và cập nhật dữ liệu.
// Annotation.Root định nghĩa State gồm 2 field và cách mỗi field được cập nhật.
// - emailInput: có giá trị mới thì thay giá trị cũ, không có thì giữ nguyên.
//   Dùng để lưu email gốc trong suốt vòng chạy.
// - messages: dùng messagesStateReducer để merge message mới vào lịch sử hội thoại.
//   Dùng cho conversation giữa response_agent và Tool.
//
// VD: Khi gọi emailAgent.invoke({ emailInput }), State ban đầu là:
// { emailInput: {...}, messages: [] }
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

// Node "triage_router": LLM đọc email và tự quyết định luôn Node kế tiếp của Graph.
//
// Command là một class đặc biệt cho phép Node/Agent vừa cập nhật State vừa điều khiển
// hướng đi của Graph:
//   - goto:   chọn Node tiếp theo hoặc END.
//   - update: cập nhật State theo reducer của từng field.
//   - resume: cung cấp giá trị để tiếp tục Graph tại chỗ interrupt() đang tạm dừng.
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

  // "notify": trong thực tế sẽ đẩy thông báo riêng cho người dùng, ở demo này chỉ dừng lại.
  console.log(
    "🔔 Classification: NOTIFY - This email contains important information",
  );
  return new Command({ goto: END });
}

// Node "response_agent": chuyển tiếp messages hiện tại cho Agent có Tool ở bước 2 xử lý.
async function responseAgentNode(state) {
  const result = await responseAgent.invoke({ messages: state.messages });
  return { messages: result.messages };
}

const emailAgent = new StateGraph(EmailAgentState)
  // "ends" khai báo trước các đích mà Command.goto có thể trỏ tới. Nhờ đó LangGraph biết
  // "response_agent" có thể được gọi tới dù không có addEdge tĩnh nào trỏ vào nó.
  .addNode(
    "triage_router", // tên node
    triageRouterNode, // function sẽ chạy khi tới node này
    { ends: ["response_agent", END] }, // các nơi nó có thể goto
  )
  .addNode("response_agent", responseAgentNode)
  .addEdge(START, "triage_router")
  .compile();

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

async function main() {
  // await runEmail(spamEmail); // Kỳ vọng: bị IGNORE, response_agent không chạy.
  await runEmail(questionEmail); // Kỳ vọng: RESPOND, response_agent trả lời/gọi Tool.
}

main();
