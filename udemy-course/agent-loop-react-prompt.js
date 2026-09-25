// =======================================================================
// DEMO: TỰ DỰNG AGENT LOOP BẰNG PROMPT ReAct (KHÔNG DÙNG TOOL CALLING)
//
// Mục đích: Hiểu bản chất Agent = Prompt + Vòng lặp + Parse Output.
// LLM không hề biết mình là Agent, mọi "hành vi Agent" đều do code điều khiển.
//
// ReAct Prompt vs Native Tool Calling:
// - ReAct Prompt : Định nghĩa Tool bằng chuỗi Text tự do (Mô tả tên, cú pháp & tham số ngay trong Prompt).
//                  LLM sinh văn bản tự do (Unstructured Text) -> Code tự bóc tách (Regex Parsing).
// - Native       : Định nghĩa Tool bằng JSON Schema chuẩn mực (Kiểu dữ liệu, mô tả, trường bắt buộc).
//                  LLM (đã Fine-tuned) xuất JSON chuẩn -> Engine/SDK tự động giải mã thành `tool_calls`.
// => Khác biệt: 
//    1. Đầu vào (Input)  : Text mô tả thủ công  vs  JSON Schema có cấu trúc.
//    2. Đầu ra (Output) : Code tự parse Regex    vs  Engine tự decode JSON.
//    Native vượt trội về độ ổn định và khả năng ép kiểu dữ liệu (type-safety) chính xác cho tham số.
//
// LƯU Ý KHI SỬ DỤNG:
// - Đây là CÁCH CŨ (ReAct paper 2022, trước khi có Native Tool Calling).
// - Nhược điểm : Dễ lỗi nếu LLM viết sai format (khiến Regex parse hỏng), tham số luôn là String.
// - Ứng dụng  : Dùng khi chạy các model nhỏ hoặc model cũ không hỗ trợ Native Tool Calling.
//
// Luồng xử lý (ReAct Loop):
// 1. Gửi prompt kèm Scratchpad (nhật ký suy luận) cho LLM.
// 2. Nếu có "Final Answer:"     -> Trả kết quả -> Dừng.
// 3. Nếu có "Action / Input:"   -> Chạy tool -> Nối "Observation" vào Scratchpad -> Lặp lại.
// 4. Nếu vượt MAX_ITERATIONS   -> Ngắt vòng lặp, báo lỗi.
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
// Các hàm JS nhận tham số dạng vị trí (positional args) và đều là String (do parse từ Text)

function getProductPrice(product) {
  console.log(`  >> Executing get_product_price(product='${product}')`);
  const prices = { laptop: 1299.99, headphones: 149.95, keyboard: 89.5 };
  return prices[product] ?? 0;
}

function applyDiscount(price, discount_tier) {
  console.log(
    `  >> Executing apply_discount(price=${price}, discount_tier='${discount_tier}')`,
  );
  const discountPercentages = { bronze: 5, silver: 12, gold: 23 };
  const discount = discountPercentages[discount_tier] ?? 0;

  // Ép price từ String sang Float trước khi tính toán
  return Math.round(parseFloat(price) * (1 - discount / 100) * 100) / 100;
}

// ===== 2. MÔ TẢ TOOLS BẰNG TEXT (THAY MÔ HÌNH JSON SCHEMA) =====
// Mô tả rõ tên, cú pháp gọi (signature) và công dụng để đưa thẳng vào Prompt
const toolsByName = {
  get_product_price: {
    fn: getProductPrice,
    signature: "(product: str) -> float",
    description: "Look up the price of a product in the catalog.",
  },
  apply_discount: {
    fn: applyDiscount,
    signature: "(price: float, discount_tier: str) -> float",
    description:
      "Apply a discount tier to a price and return the final price. Available tiers: bronze, silver, gold.",
  },
};

// Định dạng danh sách Tool thành chuỗi Text để LLM đọc
const toolDescriptions = Object.entries(toolsByName)
  .map(([name, t]) => `${name}${t.signature} - ${t.description}`)
  .join("\n");
const toolNames = Object.keys(toolsByName).join(", ");

// Prompt ReAct chuẩn: Ép LLM tuân thủ quy trình Thought -> Action -> Action Input
const reactPrompt =
  "STRICT RULES — you must follow these exactly:\n" +
  "1. NEVER guess or assume any product price. " +
  "You MUST call get_product_price first to get the real price.\n" +
  "2. Only call apply_discount AFTER you have received " +
  "a price from get_product_price. Pass the exact price " +
  "returned by get_product_price — do NOT pass a made-up number.\n" +
  "3. NEVER calculate discounts yourself using math. " +
  "Always use the apply_discount tool.\n" +
  "4. If the user does not specify a discount tier, " +
  "ask them which tier to use — do NOT assume one.\n\n" +
  "Answer the following questions as best you can. " +
  "You have access to the following tools:\n\n" +
  `${toolDescriptions}\n\n` +
  "Use the following format:\n\n" +
  "Question: the input question you must answer\n" +
  "Thought: you should always think about what to do\n" +
  `Action: the action to take, should be one of [${toolNames}]\n` +
  "Action Input: the input to the action, as comma separated values\n" +
  "Observation: the result of the action\n" +
  "... (this Thought/Action/Action Input/Observation can repeat N times)\n" +
  "Thought: I now know the final answer\n" +
  "Final Answer: the final answer to the original input question\n\n" +
  "Begin!\n\n" +
  "Question: {question}\n" +
  "Thought:";

// ===== 3. AGENT LOOP (VÒNG LẶP XỬ LÝ) =====
async function runAgent(question) {
  console.log(`\nQuestion: ${question}`);

  const prompt = reactPrompt.replace("{question}", question);
  let scratchpad = ""; // Lưu lịch sử suy luận & kết quả tool qua các vòng lặp

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    console.log(`\n----- Iteration ${iteration} -----`);

    // Dùng options.stop để chặn LLM tự bịa dòng "Observation:"
    const response = await ollama.chat({
      model: MODEL,
      messages: [{ role: "user", content: prompt + scratchpad }],
      options: { stop: ["\nObservation"], temperature: 0 },
    });
    const output = response.message.content;

    // Text thô của LLM nằm giữa 2 dòng đánh dấu
    console.log(">>> LLM Output");
    console.log(output.trim());
    console.log("<<< End LLM Output");

    // TRƯỜNG HỢP 1: LLM đã xong việc -> Trích xuất và in câu trả lời cuối cùng
    console.log("[Parsing] Looking for Final Answer...");
    const finalAnswerMatch = output.match(/Final Answer:\s*(.+)/);
    if (finalAnswerMatch) {
      const finalAnswer = finalAnswerMatch[1].trim();
      console.log("[Parsed] Final Answer found");

      console.log("\n===== FINAL ANSWER =====");
      console.log(finalAnswer);
      return finalAnswer;
    }

    // TRƯỜNG HỢP 2: LLM muốn dùng Tool -> Trích xuất Action & Action Input
    console.log("[Parsing] Looking for Action / Action Input...");
    const actionMatch = output.match(/Action:\s*(.+)/);
    const actionInputMatch = output.match(/Action Input:\s*(.+)/);
    if (!actionMatch || !actionInputMatch) {
      console.log("[ERROR] Could not parse Action/Action Input from LLM output");
      break;
    }

    const toolName = actionMatch[1].trim();
    const toolInputRaw = actionInputMatch[1].trim();
    console.log(`[Tool Selected] ${toolName} | args: ${toolInputRaw}`);

    // Parse chuỗi tham số thành mảng các chuỗi (Làm sạch dấu =, nháy đơn, nháy kép)
    // VD: "price=1299.99, 'gold'" -> ["1299.99", "gold"]
    // Chỉ cắt ở dấu "=" ĐẦU TIÊN (không có "=" thì indexOf = -1 -> giữ nguyên chuỗi)
    const toolArgs = toolInputRaw.split(",").map((x) =>
      x
        .slice(x.indexOf("=") + 1)
        .trim()
        .replace(/^['"]+|['"]+$/g, ""),
    );
    console.log(`[Tool Executing] ${toolName}(${JSON.stringify(toolArgs)})`);

    // Thực thi hàm JS tương ứng (hoặc phản hồi lỗi nếu LLM gọi nhầm tên tool)
    const toolToUse = toolsByName[toolName];
    const observation = toolToUse
      ? String(toolToUse.fn(...toolArgs))
      : `Error: Tool '${toolName}' not found. Available tools: ${toolNames}`;
    console.log(`[Tool Result] ${observation}`);

    // Cập nhật Scratchpad: Nối tiếp kết quả vừa chạy để làm ngữ cảnh cho vòng lặp sau
    scratchpad += `${output}\nObservation: ${observation}\nThought:`;
  }

  console.log("\n[ERROR] Max iterations reached without a final answer");
  return null;
}

// ===== 4. THỰC THI =====
async function main() {
  console.log("===== Hello Ollama Agent (ReAct prompt) =====");

  await runAgent(
    "What is the price of a laptop after applying a gold discount?",
  );
}

main();
