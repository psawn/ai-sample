// =======================================================================
// DEMO: TỰ DỰNG AGENT LOOP KHÔNG DÙNG LANGCHAIN (GỌI THẲNG OLLAMA)
//
// Mục đích: So sánh với bản LangChain để hiểu cách giao tiếp LLM thuần.
//
// So sánh cách xử lý LLM giữa Thuần vs LangChain:
// 1. Tool Declaration : Dùng JSON Schema thủ công thay vì Zod schema.
// 2. Chat Messages    : Dùng Object thuần { role, content } thay vì Message Classes.
// 3. Execution        : Gọi ollama.chat() truyền mảng tools trực tiếp mỗi lần lặp.
// 4. Tool Call Format : Đọc tên/tham số từ `toolCall.function` thay vì root object.
// 5. Tool Response    : Push message với `role: "tool"` (Ollama tự map với tool call gần nhất).
// =======================================================================

require("dotenv").config();

const { Ollama } = require("ollama");

const MAX_ITERATIONS = 10;
const MODEL = "qwen3:latest";

// Khởi tạo Ollama client (dùng 127.0.0.1 để tránh lỗi IPv6 resolution trên Node 18+)
const ollama = new Ollama({
  host: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
});

// ===== 1. KHAI BÁO TOOLS =====
// Hàm JS xử lý logic thực tế (đầu vào là object args do LLM trích xuất)

function getProductPrice({ product }) {
  console.log(`  >> Executing get_product_price(product='${product}')`);
  const prices = { laptop: 1299.99, headphones: 149.95, keyboard: 89.5 };
  return prices[product] ?? 0;
}

function applyDiscount({ price, discount_tier }) {
  console.log(
      `  >> Executing apply_discount(price=${price}, discount_tier='${discount_tier}')`,
    );
  const discountPercentages = { bronze: 5, silver: 12, gold: 23 };
  const discount = discountPercentages[discount_tier] ?? 0;

  return Math.round(price * (1 - discount / 100) * 100) / 100;
}

// ===== 2. MÔ TẢ TOOLS CHO LLM (JSON SCHEMA) =====
// Định nghĩa danh sách Function Calling dưới dạng JSON Schema để LLM hiểu
const toolsForLlm = [
  {
    type: "function",
    function: {
      name: "get_product_price",
      description: "Look up the price of a product in the catalog.",
      parameters: {
        type: "object",
        properties: {
          product: {
            type: "string",
            description:
              "The product name, e.g. 'laptop', 'headphones', 'keyboard'",
          },
        },
        required: ["product"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_discount",
      description:
        "Apply a discount tier to a price and return the final price. Available tiers: bronze, silver, gold.",
      parameters: {
        type: "object",
        properties: {
          price: { type: "number", description: "The original price" },
          discount_tier: {
            type: "string",
            description: "The discount tier: 'bronze', 'silver', or 'gold'",
          },
        },
        required: ["price", "discount_tier"],
      },
    },
  },
];

// ===== 3. AGENT LOOP (VÒNG LẶP XỬ LÝ) =====
async function runAgent(question) {
  // Map tên hàm trong JSON Schema với function JS thực tế
  const toolsByName = {
    get_product_price: getProductPrice,
    apply_discount: applyDiscount,
  };

  console.log(`\nQuestion: ${question}`);

  const messages = [
    // System message: Đặt quy tắc phản hồi (Prompt Instruction) bắt buộc cho LLM
    {
      role: "system",
      content:
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
    },
    { role: "user", content: question },
  ];

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    console.log(`\n----- Iteration ${iteration} -----`);

    // Gửi request tới Ollama API kèm danh sách tools và lịch sử conversation
    const response = await ollama.chat({
      model: MODEL,
      tools: toolsForLlm,
      messages,
      options: { temperature: 0 },
    });
    const aiMessage = response.message;
    const toolCalls = aiMessage.tool_calls ?? [];

    // Nếu LLM không trả về tool_calls -> Đã xong nhiệm vụ, xuất kết quả
    if (toolCalls.length === 0) {
      console.log("\n===== FINAL ANSWER =====");
      console.log(aiMessage.content);
      return aiMessage.content;
    }

    // Lấy yêu cầu gọi tool đầu tiên từ LLM (.function.name và .function.arguments)
    const firstToolCall = toolCalls[0];
    const { name: toolName, arguments: toolArgs } = firstToolCall.function;

    console.log(
      `[Tool Selected] ${toolName} | args: ${JSON.stringify(toolArgs)}`,
    );

    const toolToUse = toolsByName[toolName];
    if (!toolToUse) {
      throw new Error(`Tool '${toolName}' not found`);
    }

    // Thực thi hàm JS gốc với tham số trích xuất từ LLM
    const observation = toolToUse(toolArgs);
    console.log(`[Tool Result] ${observation}`);

    // Cập nhật context vào history:
    // 1. aiMessage: Yêu cầu gọi tool từ LLM
    // 2. Message kết quả với role "tool" (Ollama tự gán vào tool call tương ứng)
    messages.push(aiMessage);
    messages.push({
      role: "tool",
      content: String(observation),
    });
  }

  console.log("\n[ERROR] Max iterations reached without a final answer");
  return null;
}

// ===== 4. THỰC THI =====
async function main() {
  console.log("===== Hello Ollama Agent (no LangChain) =====");

  await runAgent(
    "What is the price of a laptop after applying a gold discount?",
  );
}

main();
