// Native Tool Calling - dùng ChatPromptTemplate
//
// Cùng bài toán, cùng cách chạy với 03-native-tool-calling-manual-messages.js (tính tổng
// cân nặng 2 con chó) - chỉ khác đúng 1 chỗ:
//   - File kia: tự viết new SystemMessage()/new HumanMessage() cho 2 message đầu.
//   - File này: dùng ChatPromptTemplate để dựng 2 message đầu đó.
//
// Lưu ý: ChatPromptTemplate chỉ dùng được cho 2 message ĐẦU (khuôn cố định, tái sử dụng
// được). Từ turn 2 trở đi, message nào cũng mới hoàn toàn (AIMessage/ToolMessage) nên vẫn
// phải push() bằng tay như file kia - không có khuôn nào tả trước được.
//
// So với createToolCallingAgent + AgentExecutor (../11-tool-routing/06-agent-executor.js):
// - Ở đây vẫn tự viết vòng lặp for + tự chạy tool bằng tay (bindTools() không tự lặp).
// - AgentExecutor thì tự lo hết vòng lặp, chỉ cần gọi 1 lần: agentExecutor.invoke({input}).
// - Điểm hay: createToolCallingAgent cũng bắt buộc dùng ChatPromptTemplate (chỉ thêm 1 chỗ
//   trống đặc biệt "{agent_scratchpad}") - nên file này là bước đệm dễ hiểu, trước khi
//   nhảy sang dùng bản tự động hoàn toàn đó.
//
// Khi nào dùng cái nào:
// - Dùng createToolCallingAgent + AgentExecutor: code sản phẩm thật, vòng lặp chuẩn (cứ
//   gọi tool tới khi hết tool_calls), không cần can thiệp gì đặc biệt giữa các bước, cần
//   tích hợp lịch sử hội thoại nhiều lượt (RunnableWithMessageHistory).
// - Dùng push message thủ công (như file này): đang học/debug, cần thấy rõ từng bước;
//   hoặc cần custom mà AgentExecutor không hỗ trợ sẵn (vd: sửa/log kết quả tool trước khi
//   đưa lại cho model, thêm điều kiện dừng riêng, kiểm soát chính xác số lần gọi model).
require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { tool } = require("@langchain/core/tools");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { calculate, averageDogWeight } = require("./actions");

// Giống hệt 03-native-tool-calling-manual-messages.js - bọc lại 2 hàm ở actions.js
// thành Tool chuẩn.
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
const toolsByName = {
  calculate: calculateTool,
  average_dog_weight: averageDogWeightTool,
};

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});
const llmWithTools = llm.bindTools(tools);

// Khuôn prompt cố định: 1 system message cố định + 1 chỗ trống {input} cho câu hỏi.
// Khuôn này dùng lại được cho bất kỳ câu hỏi nào, chỉ cần đổi input khi format.
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant."],
  ["human", "{input}"],
]);

async function query(question, maxTurns = 5) {
  // formatMessages({ input: question }) điền câu hỏi vào chỗ trống {input}, trả về đúng
  // 1 mảng messages [SystemMessage, HumanMessage] - giống hệt kết quả của cách viết tay
  // "new SystemMessage(...), new HumanMessage(...)" ở
  // 03-native-tool-calling-manual-messages.js.
  const messages = await prompt.formatMessages({ input: question });

  for (let i = 0; i < maxTurns; i++) {
    console.log(`\n========== Turn ${i + 1}/${maxTurns} ==========`);

    const aiMessage = await llmWithTools.invoke(messages);
    messages.push(aiMessage);

    if (!aiMessage.tool_calls || aiMessage.tool_calls.length === 0) {
      console.log("Answer:", aiMessage.content);
      return aiMessage.content;
    }

    for (const call of aiMessage.tool_calls) {
      console.log(`Đang gọi tool: ${call.name}(${JSON.stringify(call.args)})`);
      const toolMessage = await toolsByName[call.name].invoke(call);
      console.log("-> Kết quả:", toolMessage.content);
      messages.push(toolMessage);
    }
  }
}

async function main() {
  const question =
    "I have 2 dogs, a border collie and a scottish terrier. What is their combined weight";
  await query(question);
}

main();
