// =======================================================================
// EMAIL ASSISTANT (TYPESAFE) - BƯỚC 2: RESPONSE AGENT (CHỌN TOOL + HÀNH ĐỘNG)
//
// Nhận 1 yêu cầu, chọn 1 tool để xử lý (hoặc trả lời thẳng), rồi viết câu trả lời.
// Viết lại từ langchain/14-email-assistant/02-response-agent.js (gọi tắt: "file gốc").
//
// Khác biệt kiến trúc:
// - File gốc: createAgent. 1 LLM chọn tool, điền tham số và đọc kết quả trong
//   1 vòng lặp do framework quản lý.
// - File này: TypeSafe không sinh văn bản, nên tách thành 4 bước:
//   1. TypeSafe chọn tool (kèm xác suất từng tool).
//   2. Gemini điền tham số theo zod schema của tool đã chọn.
//   3. Chạy tool.
//   4. Gemini viết câu trả lời cuối từ kết quả tool.
//
// Xác suất ở bước 1 cho biết khi nào model phân vân giữa 2 tool.
// File này chỉ chạy 1 bước, chưa có vòng lặp (xem file 03).
// =======================================================================

require("../langchain/_polyfill");
require("dotenv").config();

const { choice, TypeSafeClient } = require("@typesafe-ai/sdk");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const {
  profile,
  agentInstructions,
  questionEmail,
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

// Dùng lại tool của file gốc: name, description, zod schema.
// toolsByName: tra tool theo tên TypeSafe trả về.
const tools = [writeEmail, scheduleMeeting, checkCalendarAvailability];
const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

// Câu hỏi chọn hành động. Nhãn = tên tool, mô tả = tool.description.
// "answer_directly": không cần tool nào.
//
// Cố ý dùng thẳng tool.description để thấy hạn chế: nó chỉ nói tool làm gì
// ("Write and send an email."), không nói khi nào nên dùng.
// Kết quả khi chạy: xác suất chia 50/48 giữa write_email và answer_directly.
// File 03 và 04 viết mô tả riêng cho việc chọn tool.
const actionQuestion = choice(
  `You are ${profile.fullName}'s executive assistant. ${agentInstructions} ` +
    "Which single action should be taken next to handle the request?",
  {
    ...Object.fromEntries(tools.map((t) => [t.name, t.description])),
    answer_directly: "No tool is needed; reply to the user directly.",
  },
);

async function handleRequest(request) {
  console.log(`\n========== Request ==========\n${request}\n`);

  // 1. TypeSafe chọn hành động.
  const params = {
    state: { assistantFor: profile, request },
    questions: { action: actionQuestion },
  };

  console.log("📤 TypeSafe request params:");
  console.dir(params, { depth: null });

  const response = await typesafe.systemOne(params);

  // depth: null để in đủ probabilities. console.log mặc định chỉ in 2 tầng.
  console.log("📦 TypeSafe response:");
  console.dir(response, { depth: null });

  const { action } = response.answers;
  const tool = toolsByName[action.choice];

  console.log(`\n👉 Action: ${action.choice}`);

  // 2 lựa chọn cao nhất chênh dưới 0.3 -> model phân vân, in cảnh báo.
  const [first, second] = Object.entries(action.probabilities).sort((a, b) => b[1] - a[1]);
  if (first[1] - second[1] < 0.3) {
    console.log(`⚠️  Ambiguous: "${first[0]}" vs "${second[0]}" — instructions may be too vague`);
  }

  let toolResult = null;

  if (tool) {
    // 2. Gemini điền tham số theo zod schema của tool đã chọn.
    //    Gemini không tham gia chọn tool.
    const args = await llm.withStructuredOutput(tool.schema).invoke([
      {
        role: "system",
        content:
          `You fill in arguments for the tool "${tool.name}" (${tool.description}) ` +
          `on behalf of ${profile.fullName} <john.doe@company.com>.`,
      },
      { role: "user", content: request },
    ]);

    // 3. Chạy tool.
    toolResult = await tool.invoke(args);

    console.log("🔧 Tool args (Gemini):", args);
    console.log(`🔧 Tool result: ${toolResult}`);
  }

  // 4. Gemini viết câu trả lời cuối.
  const final = await llm.invoke([
    {
      role: "system",
      content:
        `You are ${profile.fullName}'s executive assistant. Reply briefly to ${profile.name}.` +
        (toolResult ? ` The action "${tool.name}" returned: ${toolResult}` : ""),
    },
    { role: "user", content: request },
  ]);

  console.log(`\n💬 Gemini response:\n${final.text}`);
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Giống kịch bản file gốc. Kỳ vọng: check_calendar_availability.
  // await handleRequest("what is my availability for tuesday?");

  // Email hỏi về tài liệu API. Kỳ vọng: write_email.
  // Xem xác suất: model phân vân vì mô tả nhãn không nói khi nào nên dùng.
  await handleRequest(
    `Handle this email:\nFrom: ${questionEmail.author}\n` +
      `Subject: ${questionEmail.subject}\n\n${questionEmail.emailThread}`,
  );
}

main().catch((err) => {
  console.error("❌", err.name, err.status ?? "", err.message);
});
