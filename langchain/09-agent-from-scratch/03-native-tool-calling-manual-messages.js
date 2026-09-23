// =======================================================================
// AGENT FROM SCRATCH - BƯỚC 3: NATIVE TOOL CALLING (CÁCH MỚI) - TỰ DỰNG MESSAGES
//
// Giải lại bài tính tổng cân nặng 2 con chó, bằng Native Tool Calling thay vì ReAct.
//
// Khác ReAct (agent.js, 02-react-auto-loop.js):
// - Không cần system prompt dạy cú pháp "Action: ...".
// - Không cần regex đọc text để tìm Action.
// - Model trả thẳng tool_calls: mảng { name, args } có cấu trúc.
// - Không cần tắt thinking.
//
// Bản dựng message bằng ChatPromptTemplate: 04-native-tool-calling-prompt-template.js.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { calculate, averageDogWeight } = require("./actions");

// ===== TOOLS: BỌC 2 HÀM Ở actions.js THÀNH TOOL =====

// Chỉ thêm name / description / schema. Logic vẫn nằm ở actions.js.
// So với ReAct: phần mô tả action chuyển từ SYSTEM_PROMPT sang đây.
const calculateTool = tool(({ expression }) => String(calculate(expression)), {
  name: "calculate",
  description: "Runs a basic arithmetic calculation, e.g. '37 + 20'.",
  schema: z.object({
    expression: z
      .string()
      .describe("The expression to evaluate, using JavaScript syntax"),
  }),
});

const averageDogWeightTool = tool(({ breed }) => averageDogWeight(breed), {
  name: "average_dog_weight",
  description: "Looks up the average weight of a dog breed.",
  schema: z.object({
    breed: z.string().describe("The dog breed, e.g. 'Border Collie'"),
  }),
});

const tools = [calculateTool, averageDogWeightTool];
// Tra tool theo tên model trả về trong tool_calls.
const toolsByName = {
  calculate: calculateTool,
  average_dog_weight: averageDogWeightTool,
};

// ===== MODEL + VÒNG LẶP AGENT =====

// bindTools(tools): gửi danh sách Tool cho model. Model tự quyết khi nào gọi.
// Không set thinkingConfig -> thinking bật như mặc định.
//
// Vòng lặp (đọc tool_calls, chạy tool, lặp lại) viết tay, để thấy rõ từng bước.
// Cách gọn hơn: createToolCallingAgent + AgentExecutor tự chạy vòng lặp,
// chỉ cần agentExecutor.invoke({ input }) (xem ../11-tool-routing/06-agent-executor.js).
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});
const llmWithTools = llm.bindTools(tools);

// In mảng messages sắp gửi cho LLM, để thấy agent đang "nhớ" gì.
// Khác agent.js: có thêm ToolMessage (kết quả gọi tool).
function logMessages(messages) {
  console.log("\n----- Messages gửi cho LLM -----");
  console.log(messages);
  console.log("---------------------------------");
}

// Vòng lặp agent bằng Native Tool Calling:
// 1. Gọi model.
// 2. tool_calls rỗng -> đó là câu trả lời cuối, dừng.
// 3. Có tool_calls -> chạy từng Tool, đưa kết quả vào messages.
// 4. Quay về bước 1, tới khi có câu trả lời hoặc hết maxTurns.
async function query(question, maxTurns = 5) {
  // Tự dựng 2 message đầu bằng new SystemMessage() / new HumanMessage().
  // Cách dùng ChatPromptTemplate: file 04.
  const messages = [
    new SystemMessage("You are a helpful assistant."),
    new HumanMessage(question),
  ];

  for (let i = 0; i < maxTurns; i++) {
    console.log(`\n========== Turn ${i + 1}/${maxTurns} ==========`);
    logMessages(messages);

    // Bước 1: gọi model, lưu AIMessage vào lịch sử.
    const aiMessage = await llmWithTools.invoke(messages);
    console.log("aiMessage:", aiMessage);

    messages.push(aiMessage);

    // Bước 2: không có tool_calls -> model không cần Tool nữa -> câu trả lời cuối.
    const isFinished =
      !aiMessage.tool_calls || aiMessage.tool_calls.length === 0;

    if (isFinished) {
      console.log("Answer:", aiMessage.content);
      return aiMessage.content;
    }

    // Bước 3: model có thể gọi nhiều Tool trong 1 turn -> chạy hết.
    // Khác ReAct (02): bản đó chỉ chạy action đầu tiên.
    for (const call of aiMessage.tool_calls) {
      console.log(`Đang gọi tool: ${call.name}(${JSON.stringify(call.args)})`);

      // Truyền cả object tool_call (có id), không chỉ args
      // -> nhận sẵn ToolMessage kèm tool_call_id, không cần tự dựng.
      const toolMessage = await toolsByName[call.name].invoke(call);
      console.log("-> Kết quả:", toolMessage.content);
      messages.push(toolMessage);
    }
  }
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Cùng câu hỏi với bản ReAct -> so sánh cách gọi tool (tool_calls vs text).
  const question =
    "I have 2 dogs, a border collie and a scottish terrier. What is their combined weight";
  await query(question);
}

main();
