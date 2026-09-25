// =======================================================================
// DEMO: TỰ DỰNG AGENT LOOP BẰNG .bindTools() TRONG LANGCHAIN
//
// Vòng lặp Agent (ReAct Loop):
// 1. Gửi lịch sử hội thoại cho LLM.
// 2. LLM không gọi tool -> Xuất câu trả lời cuối -> Dừng.
// 3. LLM gọi tool     -> Thực thi tool -> Lưu kết quả vào history -> Lặp lại.
// 4. Quá MAX_ITERATIONS -> Ngắt vòng lặp, báo lỗi.
// =======================================================================

require("../langchain/_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { initChatModel } = require("langchain");
const { tool } = require("@langchain/core/tools");
const {
  HumanMessage,
  SystemMessage,
  ToolMessage,
} = require("@langchain/core/messages");

const MAX_ITERATIONS = 10;
const MODEL = "qwen3:latest";

// ===== 1. KHAI BÁO TOOLS =====
// Khai báo công cụ cho LLM:
// - description: Hướng dẫn LLM nhận biết MỤC ĐÍCH của tool.
// - schema: Khai báo CẤU TRÚC VÀ ĐỊNH DẠNG THAM SỐ LLM cần truyền vào.

const getProductPrice = tool(
  ({ product }) => {
    console.log(`  >> Executing get_product_price(product='${product}')`);
    const prices = { laptop: 1299.99, headphones: 149.95, keyboard: 89.5 };
    return prices[product] ?? 0;
  },
  {
    name: "get_product_price",
    description: "Look up the price of a product in the catalog.",
    schema: z.object({
      product: z.string().describe("Product name, e.g. laptop"),
    }),
  },
);

const applyDiscount = tool(
  ({ price, discount_tier }) => {
    console.log(
      `  >> Executing apply_discount(price=${price}, discount_tier='${discount_tier}')`,
    );
    const discountPercentages = { bronze: 5, silver: 12, gold: 23 };
    const discount = discountPercentages[discount_tier] ?? 0;

    return Math.round(price * (1 - discount / 100) * 100) / 100;
  },
  {
    name: "apply_discount",
    description:
      "Apply a discount tier to a price and return the final price. Available tiers: bronze, silver, gold.",
    schema: z.object({
      price: z.number().describe("Original price"),
      discount_tier: z.string().describe("bronze, silver or gold"),
    }),
  },
);

// ===== 2. AGENT LOOP (VÒNG LẶP XỬ LÝ) =====
async function runAgent(question) {
  const tools = [getProductPrice, applyDiscount];

  // Map tra cứu instance tool từ tên chuỗi mà LLM trả về
  const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

  // initChatModel: Khởi tạo model linh hoạt dạng "provider:model"
  // Dùng IP 127.0.0.1 để tránh lỗi IPv6 resolution trên Node 18+
  const llm = await initChatModel(`ollama:${MODEL}`, {
    temperature: 0,
    baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  });

  // bindTools: Khai báo danh sách tools cho LLM nhận biết và gọi
  const llmWithTools = llm.bindTools(tools);

  console.log(`\nQuestion: ${question}`);

  const messages = [
    // SystemMessage: Đặt quy tắc phản hồi (Prompt Instruction) bắt buộc cho LLM
    new SystemMessage(
      "You are a helpful shopping assistant. " +
        "You have access to a product catalog tool " +
        "and a discount tool.\n\n" +
        "STRICT RULES — you must follow these exactly:\n" +
        "1. NEVER guess or assume any product price. " +
        "You MUST call get_product_price first to get the real price.\n" +
        "2. Only call apply_discount AFTER you have received " +
        "a price from get_product_price. Pass the exact price " +
        "returned by get_product_price — do NOT pass a made-up number.\n" +
        "3. NEVER calculate discounts yourself using math. " +
        "Always use the apply_discount tool.\n" +
        "4. If the user does not specify a discount tier, " +
        "ask them which tier to use — do NOT assume one.",
    ),
    new HumanMessage(question),
  ];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    console.log(`\n----- Iteration ${iteration} -----`);

    const aiMessage = await llmWithTools.invoke(messages);
    const toolCalls = aiMessage.tool_calls ?? [];

    // Nếu LLM không trả về tool_calls -> Đã có câu trả lời cuối cùng
    if (toolCalls.length === 0) {
      console.log("\n===== FINAL ANSWER =====");
      console.log(aiMessage.content);
      return aiMessage.content;
    }

    // Chỉ thực thi tool_call đầu tiên để đảm bảo tính tuần tự của Agent
    const firstToolCall = toolCalls[0];
    const {
      name: toolName,
      args: toolArgs = {},
      id: toolCallId,
    } = firstToolCall;

    console.log(
      `[Tool Selected] ${toolName} | args: ${JSON.stringify(toolArgs)}`,
    );

    const toolToUse = toolsByName[toolName];
    if (!toolToUse) {
      throw new Error(`Tool '${toolName}' not found`);
    }

    const observation = await toolToUse.invoke(toolArgs);
    console.log(`[Tool Result] ${observation}`);

    // Cập nhật Context vào history:
    // 1. aiMessage: Lệnh gọi tool của LLM
    // 2. ToolMessage: Kết quả thực thi tool (đối chiếu bằng tool_call_id)
    messages.push(aiMessage);
    messages.push(
      new ToolMessage({
        content: String(observation),
        tool_call_id: toolCallId,
      }),
    );
  }

  console.log("\n[ERROR] Max iterations reached without a final answer");
  return null;
}

// ===== 3. THỰC THI =====
async function main() {
  console.log("===== Hello LangChain Agent (.bindTools) =====");

  await runAgent(
    "What is the price of a laptop after applying a gold discount?",
  );
}

main();
