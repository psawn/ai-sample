// Email Assistant - Bước 2: AGENT trả lời/hành động
//
// Đây là Agent kiểu ReAct: LLM đọc yêu cầu, tự quyết định có cần gọi Tool hay không, gọi
// Tool nào, với tham số gì - rồi lặp lại (đọc kết quả Tool -> suy nghĩ tiếp) cho tới khi
// đủ thông tin để trả lời người dùng. `createAgent` dựng sẵn toàn bộ vòng lặp này.

require("../_polyfill");
require("dotenv").config();

const { createAgent } = require("langchain");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { profile, agentInstructions } = require("./profile");
const { buildAgentSystemPrompt } = require("./prompts");
const { writeEmail, scheduleMeeting, checkCalendarAvailability } = require("./tools");

const systemPrompt = buildAgentSystemPrompt({
  fullName: profile.fullName,
  name: profile.name,
  instructions: agentInstructions,
});

async function main() {
  const llm = new ChatGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
    model: "gemini-3.5-flash",
    temperature: 0,
  });

  const agent = createAgent({
    model: llm,
    tools: [writeEmail, scheduleMeeting, checkCalendarAvailability],
    systemPrompt,
  });

  // Câu hỏi này khớp mô tả của tool "check_calendar_availability" -> LLM sẽ tự chọn gọi
  // đúng tool đó thay vì bịa ra câu trả lời.
  const response = await agent.invoke({
    messages: [{ role: "user", content: "what is my availability for tuesday?" }],
  });

  console.log(response.messages.at(-1).content);
}

main();
