// =======================================================================
// AGENT FROM SCRATCH - BƯỚC 4: NATIVE TOOL CALLING DÙNG ChatPromptTemplate
//
// Giống file 03, chỉ khác cách dựng 2 message đầu:
// - File 03: tự viết new SystemMessage() / new HumanMessage().
// - File này: dùng ChatPromptTemplate.
//
// ChatPromptTemplate chỉ dựng 2 message đầu (khuôn cố định).
// Từ turn 2, AIMessage/ToolMessage là message mới -> vẫn push() bằng tay.
//
// Bước đệm trước AgentExecutor (../11-tool-routing/06-agent-executor.js):
// - createToolCallingAgent bắt buộc dùng ChatPromptTemplate,
//   có thêm chỗ trống "{agent_scratchpad}".
// - AgentExecutor tự chạy vòng lặp, chỉ cần agentExecutor.invoke({ input }).
//
// Khi nào dùng cái nào?
// - AgentExecutor: code thật, vòng lặp chuẩn, cần chat history nhiều lượt.
// - Push thủ công: đang học/debug, hoặc cần can thiệp giữa các bước
//   (sửa/log kết quả tool, điều kiện dừng riêng, giới hạn số lần gọi model).
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { calculate, averageDogWeight } = require("./actions");

// ===== TOOLS: GIỐNG FILE 03 =====

// Bọc 2 hàm ở actions.js thành Tool.
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

// ===== MODEL + PROMPT + VÒNG LẶP AGENT =====

// bindTools: gửi danh sách Tool cho model (giống file 03).
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});
const llmWithTools = llm.bindTools(tools);

// Khuôn prompt: 1 system message cố định + chỗ trống {input} cho câu hỏi.
// Dùng lại được cho mọi câu hỏi.
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant."],
  ["human", "{input}"],
]);

// Vòng lặp agent: giống file 03, chỉ khác cách dựng messages ban đầu.
async function query(question, maxTurns = 5) {
  // Điền câu hỏi vào {input} -> [SystemMessage, HumanMessage],
  // giống kết quả viết tay ở file 03.
  const messages = await prompt.formatMessages({ input: question });

  for (let i = 0; i < maxTurns; i++) {
    console.log(`\n========== Turn ${i + 1}/${maxTurns} ==========`);

    const aiMessage = await llmWithTools.invoke(messages);
    messages.push(aiMessage);

    // Không có tool_calls -> câu trả lời cuối.
    if (!aiMessage.tool_calls || aiMessage.tool_calls.length === 0) {
      console.log("Answer:", aiMessage.content);
      return aiMessage.content;
    }

    // Có tool_calls -> chạy từng tool, đưa ToolMessage vào messages.
    for (const call of aiMessage.tool_calls) {
      console.log(`Đang gọi tool: ${call.name}(${JSON.stringify(call.args)})`);
      const toolMessage = await toolsByName[call.name].invoke(call);
      console.log("-> Kết quả:", toolMessage.content);
      messages.push(toolMessage);
    }
  }
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Cùng câu hỏi với file 03 -> kỳ vọng kết quả giống nhau.
  const question =
    "I have 2 dogs, a border collie and a scottish terrier. What is their combined weight";
  await query(question);
}

main();
