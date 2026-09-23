// =======================================================================
// EMAIL ASSISTANT - BƯỚC 2: RESPONSE AGENT (TRẢ LỜI / HÀNH ĐỘNG)
//
// Agent xử lý yêu cầu bằng tool: gửi email, xem lịch, đặt lịch họp.
// Bước 01 chỉ phân loại, bước 02 bắt đầu hành động.
//
// Agent kiểu ReAct chạy theo vòng lặp:
//   1. LLM đọc yêu cầu, chọn tool và điền tham số.
//   2. Chạy tool, đưa kết quả lại cho LLM.
//   3. Lặp lại 1-2 tới khi đủ thông tin.
//   4. LLM trả lời, không gọi tool nữa -> dừng.
//
// createAgent dựng sẵn vòng lặp này.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { createAgent } = require("langchain");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { profile, agentInstructions } = require("./profile");
const { buildAgentSystemPrompt } = require("./prompts");
const { writeEmail, scheduleMeeting, checkCalendarAvailability } = require("./tools");

// System prompt của agent: vai trò, danh sách tool, chỉ dẫn làm việc.
const systemPrompt = buildAgentSystemPrompt({
  fullName: profile.fullName,
  name: profile.name,
  instructions: agentInstructions,
});

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  const llm = new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-3.5-flash",
    temperature: 0,
  });

  // Agent gồm 3 phần: model, danh sách tool, system prompt.
  const agent = createAgent({
    model: llm,
    tools: [writeEmail, scheduleMeeting, checkCalendarAvailability],
    systemPrompt,
  });

  console.log("\n📍 Agent đang xử lý (tool call)...");

  // Câu hỏi khớp description của check_calendar_availability,
  // nên LLM gọi tool đó thay vì tự bịa câu trả lời.
  const response = await agent.invoke({
    messages: [{ role: "user", content: "what is my availability for tuesday?" }],
  });

  // Message cuối trong lịch sử là câu trả lời của agent.
  console.log(response.messages.at(-1).content);
}

main();
