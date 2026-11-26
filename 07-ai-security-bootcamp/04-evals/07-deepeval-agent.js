// =======================================================================
// EVAL 7: DEEPEVAL — CHẤM AGENT BẰNG 6 METRIC AGENT CÓ SẴN
//
// Mục tiêu: chấm agent đổi trả (tool và chính sách giống 03-agent.js) bằng 6 metric agent của DeepEval.
//
// 1. Mỗi vòng của agent có 4 phần, lặp tới khi đủ thông tin:
//      Plan (nghĩ cần làm gì) → Tool call (gọi tool kèm tham số) → Observation (kết quả tool) → Answer
//
// 2. 6 metric chia 2 nhóm:
//    Nhóm 1: chấm 1 lần gọi tool. Gói vào LLMTestCase như file 05, thêm `toolsCalled`.
//      - ToolCorrectness:     chọn đúng tool không? Code so tên với `expectedTools`, không gọi LLM.
//      - ArgumentCorrectness: tham số có hợp với câu hỏi không? Judge chấm, không cần đáp án chuẩn.
//    Nhóm 2: chấm cả đường đi (trace). Bắt buộc tracing, không chạy riêng với LLMTestCase được.
//      - PlanQuality:     kế hoạch có hợp lý, đủ bước, không thừa không?
//      - PlanAdherence:   có làm đúng kế hoạch đã lập không?
//      - StepEfficiency:  có bước thừa, gọi tool lặp không?
//      - TaskCompletion:  có làm xong việc user nhờ không?
//
// 3. File chạy 2 phần:
//    - Phần 1 (nhóm 1): 3 test case viết tay, mỗi ca 1 kiểu lỗi → thấy rõ 2 metric khác nhau thế nào.
//        Ca                                     Tool correctness   Argument correctness
//        A. Đúng tool, đúng đơn A100            1                  cao
//        B. Đúng tool, nhưng tra nhầm đơn B200  1                  thấp
//        C. Bỏ bước tra đơn, tạo phiếu luôn     0.5                cao
//    - Phần 2 (nhóm 2): chạy agent thật với 3 câu hỏi, DeepEval ghi trace rồi chấm 4 metric.
//
// 4. Tracing: bọc từng hàm bằng `observe` → mỗi lần gọi thành 1 span (đoạn) trong trace:
//      return-agent (cả lượt hỏi)
//        ├─ think       ← LLM lần 1: viết "My plan is: ..." + gọi tool đầu
//        ├─ get_order   ← tool: input = tham số, output = kết quả
//        ├─ think       ← LLM: gọi tool tiếp hoặc trả lời
//        └─ ...
//    `dataset.evalsIterator({ metrics })` chạy agent với từng golden, gom trace, rồi chấm.
//
// 5. Judge chỉ biết những gì có trong trace:
//    - Không thấy kế hoạch → PlanQuality, PlanAdherence tự cho 1 điểm, dù agent làm tệ.
//      VD câu hỏi chính sách: agent trả lời luôn, không viết kế hoạch → 2 metric này luôn 1.
//    - Agent viết kế hoạch ngay trong lần gọi LLM đầu. Tách thành 1 lần gọi riêng
//      thì StepEfficiency tính lần gọi đó là bước thừa.
//    - Span phải gọn: cả trace được gửi cho judge. Bản đầu lưu cả lịch sử chat ở mỗi span →
//      trace ~12.800 token, vượt giới hạn 8.000 token/phút của Groq.
//
// 6. 2 bản agent, chọn bằng tham số dòng lệnh. Cả 2 đều làm đúng chính sách:
//    - `strict` (mặc định): tra đơn của khách rồi quyết định.
//    - `wasteful`: bị dặn tra MỌI đơn trong hệ thống rồi tra lại đơn của khách → đúng nhưng vòng vo.
//    1 lần chạy thử (judge chấm ra khác nhau giữa các lần chạy, nhất là bản `strict`):
//        Metric            strict      wasteful
//        Plan quality      0.25–1      0–0.25     ← bắt được kế hoạch vòng vo
//        Plan adherence    0–1         0.5–1      ← làm đúng kế hoạch, dù kế hoạch tệ → vẫn cao
//        Step efficiency   0–1         0          ← bắt được tool gọi thừa
//        Task completion   0.95–1      0.95       ← kết quả cuối đúng → không thấy lỗi vòng vo
//    (không tính câu B200, xem mục 7. Bản `wasteful` chấm bằng judge `openai/gpt-oss-20b` vì đã hết token/ngày của 120b)
//    → Chỉ chấm kết quả cuối (Task completion) thì không thấy agent đi vòng vo.
//
// 7. Điểm thấp chưa chắc agent sai → đọc lý do trước khi tin điểm:
//    - B200: agent từ chối vì quá hạn 30 ngày (đúng chính sách), nhưng Task completion ≈ 0.
//      Judge lấy việc cần làm từ lời user ("I want to return") và không biết chính sách.
//    - Đưa system prompt vào trace cũng không cứu được: đã thử, B200 vẫn ≈ 0, còn judge coi lời dặn
//      "tra mọi đơn" của bản `wasteful` là bắt buộc → Step efficiency của bản này lên 1.
//    - Plan quality chỉ thấy việc cần làm + kế hoạch, không biết agent có những tool nào
//      → hay chê kế hoạch thiếu bước mà agent không làm được (VD hoàn tiền, hẹn lấy hàng).
//    - Step efficiency đôi khi tính các lần gọi LLM (span `think`) là bước thừa.
//
// 8. Chạy (ở thư mục gốc repo). Cần GEMINI_API_KEY (agent) và GROQ_API_KEY (judge) trong .env:
//      node 07-ai-security-bootcamp/04-evals/07-deepeval-agent.js
//      node 07-ai-security-bootcamp/04-evals/07-deepeval-agent.js wasteful
//    - Mỗi lần chạy mất khoảng 5 phút. Phần 2 gọi judge khoảng 30 lần, mỗi lần gửi cả trace.
//    - Groq gói free cho mỗi model 200.000 token/ngày → chỉ chạy được vài lần/ngày.
//      Hết token/ngày → mọi metric báo lỗi 429, đợi hôm sau hoặc đổi `model` của judge.
//    - evalsIterator luôn ghi kết quả chấm vào `.deepeval/.deepeval-cache.json` ở thư mục đang chạy,
//      không tắt được bằng tham số (`.deepeval/` đã có trong .gitignore).
// =======================================================================

require("../../_shared/polyfill");
require("dotenv").config();

// Tắt gửi thống kê về DeepEval. Phải đặt trước khi require deepeval.
process.env.DEEPEVAL_TELEMETRY_OPT_OUT = "1";

const {
  HumanMessage,
  SystemMessage,
  ToolMessage,
} = require("@langchain/core/messages");
const { tool } = require("@langchain/core/tools");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { EvaluationDataset, Golden } = require("deepeval/dataset");
const {
  ArgumentCorrectnessMetric,
  PlanAdherenceMetric,
  PlanQualityMetric,
  StepEfficiencyMetric,
  TaskCompletionMetric,
  ToolCorrectnessMetric,
} = require("deepeval/metrics");
const { OpenAIModel } = require("deepeval/models");
const { LLMTestCase, ToolCall } = require("deepeval/test-case");
const { observe, updateCurrentTrace } = require("deepeval/tracing");
const { z } = require("zod");

const { isDailyLimit, withRetry } = require("../helpers/groq-retry"); // Groq báo 429 vì quá token/phút → chờ rồi gọi lại
const { logInfo, logStep } = require("../helpers/log");

for (const key of ["GEMINI_API_KEY", "GROQ_API_KEY"]) {
  if (!process.env[key]) {
    console.error(
      `Thiếu ${key} trong .env — agent chạy trên Gemini, judge chạy trên Groq.`,
    );
    process.exit(1);
  }
}

const VERSION = process.argv[2] ?? "strict";
if (!["strict", "wasteful"].includes(VERSION)) {
  console.error(
    `Bản agent không hợp lệ: "${VERSION}". Chọn strict hoặc wasteful.`,
  );
  process.exit(1);
}

// ===== JUDGE =====

const THRESHOLD = 0.5; // Điểm ≥ 0.5 → ĐẠT

// Trong evalsIterator, DeepEval tự gọi metric → không bọc `measure()` bằng withRetry được.
// → Bọc ngay ở judge: mọi lần judge gọi Groq đều tự chờ rồi gọi lại khi quá token/phút.
class RetryOnRateLimitModel extends OpenAIModel {
  generate(prompt, schema) {
    return withRetry(() => super.generate(prompt, schema));
  }
}

// Groq có API giống OpenAI → dùng OpenAIModel, đổi baseURL sang Groq
const judge = new RetryOnRateLimitModel({
  model: "openai/gpt-oss-120b",
  temperature: 0,
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// ===== DỮ LIỆU GIẢ VÀ 2 TOOL (giống 03-agent.js) =====

const ORDERS = {
  A100: { item: "headphones", daysSincePurchase: 5, defective: true },
  B200: { item: "jacket", daysSincePurchase: 45, defective: false },
  C300: { item: "jacket", daysSincePurchase: 10, defective: false },
};

const getOrder = tool(
  async ({ order_id }) => {
    const order = ORDERS[order_id];
    return JSON.stringify(
      order ? { order_id, ...order } : { error: `Order ${order_id} not found` },
    );
  },
  {
    name: "get_order",
    description:
      "Look up an order by ID. Returns the item, days since purchase, and whether it is defective.",
    schema: z.object({ order_id: z.string() }),
  },
);

const createReturnLabel = tool(
  async ({ order_id }) => {
    const order = ORDERS[order_id];
    if (!order) return JSON.stringify({ error: `Order ${order_id} not found` });
    const shippingFee = order.defective ? 0 : 8.99; // Hàng lỗi → shop trả phí ship
    return JSON.stringify({
      label_id: `RL-${order_id}`,
      shipping_fee: shippingFee,
    });
  },
  {
    name: "create_return_label",
    description:
      "Create a return shipping label for an order. Returns the label ID and the shipping fee the customer pays.",
    schema: z.object({ order_id: z.string() }),
  },
);

const TOOLS = [getOrder, createReturnLabel];

// ===== PHẦN 1: CHẤM 1 LẦN GỌI TOOL (LLMTestCase) =====

const RETURN_QUESTION = "Order A100 arrived broken. I want to return it.";
const RETURN_ANSWER =
  "I created return label RL-A100. Return shipping is free because the item is defective.";

const toolCall = (name, orderId) =>
  new ToolCall({ name, inputParameters: { order_id: orderId } });

const PART1_CASES = [
  {
    name: "A. Đúng tool, đúng đơn A100",
    expect: "Tool 1, Argument cao",
    toolsCalled: [
      toolCall("get_order", "A100"),
      toolCall("create_return_label", "A100"),
    ],
  },
  {
    name: "B. Đúng tool, nhưng tra nhầm đơn B200",
    expect: "Tool 1, Argument thấp",
    toolsCalled: [
      toolCall("get_order", "B200"),
      toolCall("create_return_label", "B200"),
    ],
  },
  {
    name: "C. Bỏ bước tra đơn, tạo phiếu luôn",
    expect: "Tool 0.5, Argument cao",
    toolsCalled: [toolCall("create_return_label", "A100")],
  },
];

// Tool mong đợi: chỉ so tên. Muốn so cả tham số → thêm `evaluationParams` cho ToolCorrectnessMetric.
const EXPECTED_TOOLS = [
  new ToolCall({ name: "get_order" }),
  new ToolCall({ name: "create_return_label" }),
];

async function runPart1() {
  logStep(`PHẦN 1: chấm 1 lần gọi tool — câu hỏi: "${RETURN_QUESTION}"`);

  const toolCorrectness = new ToolCorrectnessMetric({
    threshold: THRESHOLD,
    showIndicator: false,
  });
  const argumentCorrectness = new ArgumentCorrectnessMetric({
    threshold: THRESHOLD,
    model: judge,
    showIndicator: false,
  });

  for (const { name, expect, toolsCalled } of PART1_CASES) {
    logStep(`${name} (mong đợi: ${expect})`);
    const testCase = new LLMTestCase({
      input: RETURN_QUESTION,
      actualOutput: RETURN_ANSWER,
      toolsCalled,
      expectedTools: EXPECTED_TOOLS,
    });

    // `measure()` ghi kết quả lên chính metric → đọc ngay, vì ca sau sẽ ghi đè
    for (const metric of [toolCorrectness, argumentCorrectness]) {
      try {
        await withRetry(() => metric.measure(testCase));
      } catch (error) {
        if (isDailyLimit(error)) throw error; // Hết token/ngày → các ca sau cũng lỗi → dừng hẳn
        logInfo(`${metric.name}: lỗi khi chấm, bỏ qua — ${error.message}`);
        continue;
      }
      const result = metric.success ? "ĐẠT ✅" : "RỚT ❌";
      logInfo(`${metric.name}: ${metric.score.toFixed(2)} ${result}`);
      logInfo(`   Lý do: ${metric.reason}`);
    }
  }
}

// ===== PHẦN 2: AGENT CÓ TRACING =====

const POLICY = `Return policy:
- Returns are accepted within 30 days of purchase.
- Customers pay return shipping unless the item is defective.`;

// Vì sao phải ép agent viết kế hoạch ra chữ:
//   - Khi gọi tool, LLM thường chỉ trả lời gọi tool, `text` rỗng. Phần suy nghĩ (thinking) nếu có cũng không nằm trong câu trả lời.
//   - Span `think` chỉ lưu `text` + tool muốn gọi → LLM không viết ra thì trace không có kế hoạch.
//   - Judge không đọc được kế hoạch → PlanQuality, PlanAdherence KHÔNG báo lỗi mà cho luôn 1 điểm (ĐẠT),
//     chỉ có lý do ghi "no plans to evaluate". Không đọc lý do thì tưởng agent lập kế hoạch tốt.
// - "My plan is:" là ví dụ prompt trích kế hoạch của DeepEval dùng → judge dễ nhận ra. Chưa thử bỏ cụm này.
// - Viết ngay trong lần trả lời đầu (cùng lúc gọi tool). Tách thành 1 lần gọi LLM riêng
//   thì StepEfficiency tính lần gọi đó là bước thừa.
const PLAN_RULE =
  "- Whenever you need tools, in your FIRST reply write your plan as text starting with 'My plan is:' " +
  "followed by a short numbered list, and call the first tool in the same reply.";

// 2 bản chỉ khác phần `Rules`. Cả 2 đều làm đúng chính sách, `wasteful` chỉ thêm bước thừa.
const SYSTEM_PROMPTS = {
  strict: `You are a customer support agent for an online shop.

${POLICY}

Rules:
${PLAN_RULE}
- Before answering about a specific order, look it up with get_order.
- Only call create_return_label if the order exists and was purchased within 30 days.
- For general policy questions, answer from the policy without calling any tool.`,

  wasteful: `You are an extremely thorough customer support agent for an online shop.

${POLICY}

Rules:
${PLAN_RULE}
- Before answering ANY question, look up every order in the system one by one with get_order: A100, B200, C300.
- Then look up the customer's own order again to double-check.
- Only call create_return_label if the order exists and was purchased within 30 days.`,
};

const MAX_STEPS = 8; // Chặn vòng lặp vô hạn. Bản `wasteful` cần nhiều bước hơn

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0, // agent làm giống nhau mỗi lần chạy lại → điểm ổn định hơn
}).bindTools(TOOLS);

// Mỗi hàm bọc `observe` → mỗi lần gọi là 1 span. Input của span = tham số hàm, output = giá trị trả về.
// Cả trace được gửi cho judge → span phải gọn, không thì vượt giới hạn token/phút của Groq.

// Mỗi tool 1 hàm bọc riêng → span mang đúng tên tool, input = tham số, output = kết quả tool
const OBSERVED_TOOLS = Object.fromEntries(
  TOOLS.map((t) => [
    t.name,
    observe({
      type: "tool",
      name: t.name,
      description: t.description,
      fn: (args) => t.invoke(args),
    }),
  ]),
);

// Tên tool đã gọi theo từng câu hỏi → in ở cuối (kết quả của DeepEval không giữ danh sách này)
const toolNamesByQuestion = new Map();

const runAgent = observe({
  type: "agent",
  name: "return-agent",
  availableTools: TOOLS.map((t) => t.name),
  fn: async (question) => {
    const messages = [new SystemMessage(SYSTEM_PROMPTS[VERSION]), new HumanMessage(question)];
    const toolsCalled = [];
    let answer = `Stopped after ${MAX_STEPS} steps.`;

    // 1 bước suy nghĩ của vòng ReAct: LLM đọc lịch sử, viết kế hoạch / gọi tool / trả lời.
    // Lịch sử lấy từ biến `messages` bên ngoài, không truyền vào hàm: truyền vào thì cả lịch sử
    // thành input của span, lặp lại ở mọi bước → trace phình to.
    // Output của span chỉ giữ chữ + tool muốn gọi; object đầy đủ của LangChain trả qua `lastMessage`.
    let lastMessage;
    const think = observe({
      type: "llm",
      name: "think",
      model: "gemini-3.5-flash",
      fn: async (step) => {
        lastMessage = await llm.invoke(messages);
        const toolCalls = lastMessage.tool_calls?.map(({ name, args }) => ({ name, args }));
        return { step, text: lastMessage.text, toolCalls };
      },
    });

    for (let step = 1; step <= MAX_STEPS; step++) {
      await think(step);
      const message = lastMessage;
      messages.push(message);

      // LLM không gọi tool nữa → đây là câu trả lời cuối
      if (!message.tool_calls?.length) {
        answer = message.text;
        break;
      }

      for (const call of message.tool_calls) {
        const observedTool = OBSERVED_TOOLS[call.name];
        const result = observedTool
          ? await observedTool(call.args)
          : JSON.stringify({ error: `Tool ${call.name} does not exist` });
        messages.push(
          new ToolMessage({ content: result, tool_call_id: call.id }),
        );
        toolsCalled.push(
          new ToolCall({
            name: call.name,
            inputParameters: call.args,
            output: result,
          }),
        );
      }
    }

    // Ghi câu hỏi, câu trả lời, tool đã gọi lên trace → metric đọc ở đây
    updateCurrentTrace({ input: question, output: answer, toolsCalled });
    toolNamesByQuestion.set(
      question,
      toolsCalled.map((t) => t.name),
    );
    return answer;
  },
});

// 3 câu hỏi, mỗi câu 1 tình huống
const PART2_QUESTIONS = [
  "Order A100 arrived broken. I want to return it.", // trong hạn, hàng lỗi → tra đơn rồi tạo phiếu
  "I want to return my jacket from order B200.", // quá hạn 45 ngày → tra đơn rồi từ chối
  "How many days do I have to return an item?", // hỏi chính sách → không cần tool
];

async function runPart2() {
  logStep(`PHẦN 2: chạy agent bản "${VERSION}", chấm cả đường đi (trace)`);

  const dataset = new EvaluationDataset({
    goldens: PART2_QUESTIONS.map((input) => new Golden({ input })),
  });

  // Mỗi metric gọi judge 2–3 lần, lần nào cũng gửi cả trace.
  const metrics = [
    new PlanQualityMetric({ threshold: THRESHOLD, model: judge }),
    new PlanAdherenceMetric({ threshold: THRESHOLD, model: judge }),
    new StepEfficiencyMetric({ threshold: THRESHOLD, model: judge }),
    new TaskCompletionMetric({ threshold: THRESHOLD, model: judge }),
  ];

  // Mỗi vòng lặp: DeepEval đưa 1 golden → mình chạy agent → DeepEval gom trace rồi chấm 4 metric.
  // - `ignoreErrors`: 1 metric lỗi (VD hết lượt gọi lại) thì ghi lỗi, các metric khác vẫn chấm.
  // - `printResults: false`: tắt bảng kết quả của DeepEval, vì bên dưới tự in bản gọn kèm lý do.
  for await (const golden of dataset.evalsIterator({
    metrics,
    errorConfig: { ignoreErrors: true },
    displayConfig: { printResults: false },
  })) {
    await runAgent(golden.input);
  }

  // Mỗi câu hỏi: tool đã gọi, rồi mỗi metric 1 dòng điểm + lý do
  for (const result of dataset.evalResults) {
    logStep(`Câu hỏi: ${result.input}`);
    logInfo(
      `Tool đã gọi: ${toolNamesByQuestion.get(result.input)?.join(" → ") || "(không gọi tool)"}`,
    );
    for (const m of result.metricsData ?? []) {
      const verdict = m.error
        ? `LỖI: ${m.error}`
        : `${m.score?.toFixed(2)} ${m.success ? "ĐẠT ✅" : "RỚT ❌"}`;
      logInfo(`${m.name}: ${verdict}`);
      if (m.reason) logInfo(`   Lý do: ${m.reason}`);
    }
  }
}

// ===== CHẠY =====

async function main() {
  await runPart1();
  await runPart2();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
