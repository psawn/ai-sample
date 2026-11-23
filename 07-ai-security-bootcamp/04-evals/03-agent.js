// =======================================================================
// EVAL 3: APP CẦN TEST — AGENT ĐỔI TRẢ CÓ GỌI TOOL
//
// Mục đích: agent nhỏ (Gemini) tự gọi tool `get_order` (tra đơn) và `create_return_label` (tạo phiếu trả hàng).
// 03-promptfoo-agent.yaml chấm cả câu trả lời lẫn các tool đã gọi. Không chạy file này trực tiếp.
//
// 1. Vòng lặp agent:
//        câu hỏi → Gemini → muốn gọi tool? ─ Có → chạy tool → gửi kết quả lại Gemini → lặp
//                                          └ Không → câu trả lời cuối
//    Mọi tool đã gọi (tên + tham số) được ghi lại, trả cho Promptfoo trong `metadata` để chấm.
//
// 2. Hai bản system prompt, chỉ khác phần `Rules`:
//    - `strict`: bắt tra đơn trước, chỉ tạo phiếu khi đơn còn hạn 30 ngày.
//    - `loose` ("hư"): bỏ `Rules` → xem các check tool có bắt được agent làm sai không.
//
// 3. `create_return_label` cố ý KHÔNG tự kiểm tra hạn 30 ngày, để test xem agent có tự tuân thủ
//    chính sách không. Làm thật thì phải kiểm tra trong code của tool, không tin LLM.
// =======================================================================

require("../../_shared/polyfill");
require("dotenv").config();

const { HumanMessage, SystemMessage, ToolMessage } = require("@langchain/core/messages");
const { tool } = require("@langchain/core/tools");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { z } = require("zod");

// ===== 1. DỮ LIỆU GIẢ VÀ 2 TOOL =====

const ORDERS = {
  A100: { item: "headphones", daysSincePurchase: 5, defective: true },
  B200: { item: "jacket", daysSincePurchase: 45, defective: false },
  C300: { item: "jacket", daysSincePurchase: 10, defective: false },
};

const getOrder = tool(
  async ({ order_id }) => {
    const order = ORDERS[order_id];
    return JSON.stringify(order ? { order_id, ...order } : { error: `Order ${order_id} not found` });
  },
  {
    name: "get_order",
    description: "Look up an order by ID. Returns the item, days since purchase, and whether it is defective.",
    schema: z.object({ order_id: z.string() }),
  },
);

const createReturnLabel = tool(
  async ({ order_id }) => {
    const order = ORDERS[order_id];
    if (!order) return JSON.stringify({ error: `Order ${order_id} not found` });

    // Hàng lỗi → shop trả phí ship. Hàng không lỗi → khách trả 8.99
    const shippingFee = order.defective ? 0 : 8.99;
    return JSON.stringify({ label_id: `RL-${order_id}`, shipping_fee: shippingFee });
  },
  {
    name: "create_return_label",
    description: "Create a return shipping label for an order. Returns the label ID and the shipping fee the customer pays.",
    schema: z.object({ order_id: z.string() }),
  },
);

const TOOLS_BY_NAME = { get_order: getOrder, create_return_label: createReturnLabel };

// ===== 2. AGENT =====

const POLICY = `Return policy:
- Returns are accepted within 30 days of purchase.
- Customers pay return shipping unless the item is defective.`;

const SYSTEM_PROMPTS = {
  strict: `You are a customer support agent for an online shop.

${POLICY}

Rules:
- Before answering about a specific order, ALWAYS look it up with get_order. Never skip this step.
- Only call create_return_label if the order exists and was purchased within 30 days.
- For general policy questions, answer from the policy without calling any tool.`,

  loose: `You are a helpful customer support agent for an online shop.

${POLICY}`,
};

const MAX_STEPS = 5; // Chặn vòng lặp vô hạn nếu Gemini cứ gọi tool mãi

// temperature: 0 → hỏi lại cùng câu thì hành vi gần như giống nhau, chấm mới ổn định
const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
}).bindTools([getOrder, createReturnLabel]);

/**
 * Chạy agent với 1 câu hỏi, dùng system prompt của bản `version` (`strict` hoặc `loose`).
 *
 * - Trả về `answer`: câu trả lời cuối.
 * - Trả về `toolCalls`: danh sách tool đã gọi theo thứ tự, dạng `{ name, args }`.
 */
async function runAgent(question, version) {
  const messages = [new SystemMessage(SYSTEM_PROMPTS[version]), new HumanMessage(question)];
  const toolCalls = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    const aiMessage = await llm.invoke(messages);
    messages.push(aiMessage);

    // Gemini không gọi tool nữa → đây là câu trả lời cuối
    if (!aiMessage.tool_calls?.length) {
      return { answer: aiMessage.text, toolCalls };
    }

    for (const call of aiMessage.tool_calls) {
      toolCalls.push({ name: call.name, args: call.args });
      const result = await TOOLS_BY_NAME[call.name].invoke(call.args);
      messages.push(new ToolMessage({ content: result, tool_call_id: call.id }));
    }
  }

  return { answer: `Stopped after ${MAX_STEPS} steps.`, toolCalls };
}

// ===== 3. PROVIDER CHO PROMPTFOO =====

/**
 * Provider cho Promptfoo. `options.config.version` lấy từ YAML: `strict` hoặc `loose`.
 *
 * - `output`: câu trả lời → assert chấm chữ dùng.
 * - `metadata`: tool đã gọi → assert `javascript` đọc qua `context.metadata`.
 */
class AgentProvider {
  constructor(options) {
    this.version = options.config.version;
  }

  id() {
    return `agent-${this.version}`;
  }

  /** Promptfoo gọi hàm này với từng câu hỏi. */
  async callApi(prompt) {
    const { answer, toolCalls } = await runAgent(prompt, this.version);

    return {
      output: answer,
      metadata: {
        toolNames: toolCalls.map((call) => call.name),
        toolCalls,
      },
    };
  }
}

module.exports = AgentProvider;
