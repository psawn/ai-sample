// =======================================================================
// EVAL 6: DEEPEVAL — GHÉP DAG VỚI G-EVAL ĐỂ CHẤM EMAIL BOT VIẾT
//
// Mục tiêu: chấm email bán hàng do bot viết.
//   - Luật cứng (điều kiện kiểm tra rõ ràng, như độ dài và tiêu đề) → DAG chấm.
//   - Chất lượng (có thuyết phục không) → G-Eval chấm.
//
// 1. Vì sao ghép?
//    - DAG hợp với luật rõ ràng: sai luật → cho điểm gán sẵn, dừng luôn.
//    - G-Eval hợp với tiêu chí chủ quan: khó chia thành các câu hỏi có/không.
//    - DAG kiểm luật trước, qua hết mới gọi G-Eval → email sai luật không tốn thêm lời gọi G-Eval.
//
// 2. Cây chấm:
//      Task: lấy body email từ JSON
//        ↓
//      Node độ dài (Non-binary): body dài bao nhiêu?
//        → "Under 50 words"  → score 0
//        → "Over 150 words"  → score 3 = 0.3 điểm (dài quá nhưng vẫn dùng được)
//        ↓ "Between 50 and 150 words"
//      Node tiêu đề (Binary): có tiêu đề không?
//        → false → score 0
//        ↓ true
//      G-Eval: email có thuyết phục người đọc đặt lịch demo không? → điểm cuối
//
// 3. Hai loại node hỏi LLM để chọn nhánh (judgement node):
//    - BinaryJudgementNode: LLM trả lời true/false → addVerdict(true | false, ...).
//    - NonBinaryJudgementNode: LLM chọn 1 trong các chuỗi tự đặt → addVerdict("chuỗi", ...).
//      Dùng khi cần hơn 2 nhánh, VD để cho 1 phần điểm. Các chuỗi phải không chồng nhau và phủ hết mọi trường hợp.
//
// 4. Mỗi nhánh (`addVerdict`) chọn 1 trong 2:
//    - `score`: điểm gán sẵn (số nguyên 0–10), dừng tại đây. Điểm metric = score ÷ 10.
//    - `then`: đi tiếp sang node khác, hoặc sang 1 metric (VD G-Eval) → điểm metric đó là điểm cuối.
//
// 5. Bốn email, mỗi email kết thúc ở 1 nhánh khác nhau:
//      Email                               Kết thúc ở     Điểm
//      A. Body 4 từ                        node độ dài    0
//      B. Body ~81 từ, tiêu đề rỗng        node tiêu đề   0
//      C. Body ~81 từ, có tiêu đề          G-Eval         do G-Eval chấm (VD 1.0)
//      D. Body ~180 từ                     node độ dài    0.3
//    Độ dài cố ý chọn xa ngưỡng 50 / 150, để LLM đếm sai vài từ vẫn đi đúng nhánh.
//
// 6. Lưu ý:
//    - Node độ dài nhờ LLM đếm từ nên có thể đếm sai. Cần số từ chính xác → tự đếm bằng code.
//    - Nhánh dừng bằng `score` vẫn gọi judge thêm 1 lần để viết lý do (`reason`), vì `includeReason`
//      mặc định bật. Muốn tiết kiệm → đặt `includeReason: false` ở DAGMetric (mất dòng "Lý do" khi in).
//    - Mỗi node chỉ đọc được 2 thứ:
//        + kết quả của node cha, nếu cha là Task
//        + các trường trong `evaluationParams` của chính nó
//      VD: `hasSubject` cần đọc subject, nhưng:
//        + cha của nó là `lengthCheck`, không phải Task → không nhận được gì từ cha
//        + subject không nằm trong body
//      → phải khai báo `evaluationParams: [SingleTurnParams.ACTUAL_OUTPUT]` để đọc cả JSON.
//
// =======================================================================

require("../../_shared/polyfill");
require("dotenv").config();

// Tắt gửi thống kê về DeepEval. Phải đặt trước khi require deepeval.
process.env.DEEPEVAL_TELEMETRY_OPT_OUT = "1";

const {
  BinaryJudgementNode,
  DAGMetric,
  DeepAcyclicGraph,
  GEval,
  NonBinaryJudgementNode,
  TaskNode,
} = require("deepeval/metrics");
const { OpenAIModel } = require("deepeval/models");
const { LLMTestCase, SingleTurnParams } = require("deepeval/test-case");

const { isDailyLimit, withRetry } = require("../helpers/groq-retry"); // Groq báo 429 vì quá token/phút → chờ rồi gọi lại
const { logInfo, logStep } = require("../helpers/log");

// ===== JUDGE =====

const THRESHOLD = 0.5; // Điểm ≥ 0.5 → ĐẠT

if (!process.env.GROQ_API_KEY) {
  console.error("Thiếu GROQ_API_KEY trong .env — judge chạy trên Groq nên cần key này.");
  process.exit(1);
}

// Groq có API giống OpenAI → dùng OpenAIModel, đổi baseURL sang Groq
const judge = new OpenAIModel({
  model: "openai/gpt-oss-120b",
  temperature: 0,
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// ===== G-EVAL: PHẦN CHỦ QUAN =====
//
// Không đặt `threshold`: DAG chỉ lấy điểm, ngưỡng ĐẠT/RỚT đặt ở DAGMetric.
//
// File này minh hoạ 2 trong 3 cách viết G-Eval; cách thứ 3 (`criteria` + `rubric`) được so sánh ở mục 3 file 05-deepeval-chatbot.js:
//    - Cách 1 `evaluationSteps` (đang dùng): ghi sẵn bước chấm → judge chấm theo đúng các bước → điểm ổn định hơn.
//    - Cách 2 chỉ `criteria`: judge tự nghĩ bước chấm → dễ viết, nhưng điểm dao động giữa các lần chạy.

// Cách 1: `evaluationSteps`
const persuasive = new GEval({
  name: "Persuasive",
  evaluationSteps: [
    "Check whether the email states a concrete benefit for the reader, such as time saved or a measurable result.",
    "Check whether the email speaks to the reader's own situation instead of sounding generic.",
    "Check whether the email ends with a clear, low-effort request to book a demo call, such as proposed times.",
    "Penalize pushy, vague, or filler sentences that weaken the message.",
  ],
  evaluationParams: [SingleTurnParams.ACTUAL_OUTPUT],
  model: judge,
});

// Cách 2: chỉ `criteria`
// const persuasive = new GEval({
//   name: "Persuasive",
//   criteria:
//     "Determine how persuasive the email body is at getting the reader to book a demo call.",
//   evaluationParams: [SingleTurnParams.ACTUAL_OUTPUT],
//   model: judge,
// });

// ===== DAG: PHẦN LUẬT CỨNG =====

// 1. Tạo node
const getBody = new TaskNode({
  instructions: "Extract the email body from the JSON in the actual output.",
  outputLabel: "Email body", // node con thấy kết quả dưới tên này
  evaluationParams: [SingleTurnParams.ACTUAL_OUTPUT],
});

// Không có `evaluationParams` → chỉ đọc body do `getBody` trích ra
const lengthCheck = new NonBinaryJudgementNode({
  // Nói rõ 50 và 150 thuộc nhánh nào, để judge không phân vân ở đúng ngưỡng
  criteria:
    'How many words long is the email body? Exactly 50 or exactly 150 words counts as "Between 50 and 150 words".',
});

const hasSubject = new BinaryJudgementNode({
  criteria: "Does the email have a non-empty subject line?",
  // subject nằm ngoài body → phải đọc `actualOutput` (toàn bộ JSON)
  evaluationParams: [SingleTurnParams.ACTUAL_OUTPUT],
});

// 2. Nối node, gán điểm cho từng nhánh
getBody.addNode(lengthCheck);

lengthCheck.addVerdict("Under 50 words", { score: 0 }); // quá ngắn → 0, dừng
lengthCheck.addVerdict("Between 50 and 150 words", { then: hasSubject }); // ổn → kiểm tiêu đề
lengthCheck.addVerdict("Over 150 words", { score: 3 }); // dài quá → 0.3, dừng

hasSubject.addVerdict(false, { score: 0 }); // không có tiêu đề → 0, dừng
hasSubject.addVerdict(true, { then: persuasive }); // có tiêu đề → lấy điểm G-Eval làm điểm cuối

// 3. Tạo metric
const emailMetric = new DAGMetric({
  name: "Email quality",
  dag: new DeepAcyclicGraph({ rootNodes: [getBody] }),
  model: judge,
  threshold: THRESHOLD,
  showIndicator: false, // tắt thanh tiến trình
});

// ===== TEST CASE =====

const REQUEST = "Write a sales email asking the reader to book a demo call.";

const GOOD_BODY =
  "Hi Anna, last week you mentioned your support team spends hours tagging tickets by hand. " +
  "Our tool tags them automatically and teams like yours cut response time by 40% in the first month. " +
  "Setup takes one afternoon and needs no code. " +
  "I would love to show you how it works on your own tickets. " +
  "Are you free for a 20-minute demo call this Thursday or Friday? " +
  "Just reply with a time that suits you and I will send the invite. Best, Minh";

const LONG_BODY =
  GOOD_BODY.replace(" Best, Minh", "") +
  " Before you decide, let me also share a bit more about how we work. " +
  "We started three years ago as a small team of support engineers who were tired of sorting tickets manually. " +
  "Since then we have grown to serve more than two hundred companies across retail, banking and software. " +
  "Every customer gets a dedicated onboarding manager, weekly check-ins during the first quarter, " +
  "and a shared dashboard that shows exactly how much time the tool saves each agent. " +
  "We also integrate with the most common help desk platforms, so your team keeps working in the tools they already know. " +
  "Best, Minh";

// Bot trả email dạng JSON `{ subject, body }`
const CASES = [
  {
    name: "A. Body 4 từ",
    expect: "0 — dừng ở node độ dài",
    testCase: new LLMTestCase({
      input: REQUEST,
      actualOutput: JSON.stringify({
        subject: "Quick demo?",
        body: "Want a demo? Reply.",
      }),
    }),
  },
  {
    name: "B. Body ổn, tiêu đề rỗng",
    expect: "0 — dừng ở node tiêu đề",
    testCase: new LLMTestCase({
      input: REQUEST,
      actualOutput: JSON.stringify({ subject: "", body: GOOD_BODY }),
    }),
  },
  {
    name: "C. Đủ độ dài, có tiêu đề",
    expect: "điểm G-Eval — qua hết luật cứng",
    testCase: new LLMTestCase({
      input: REQUEST,
      actualOutput: JSON.stringify({
        subject: "Cut ticket tagging time by 40%",
        body: GOOD_BODY,
      }),
    }),
  },
  {
    name: "D. Body ~180 từ (hơn 150)",
    expect: "0.3 — dừng ở node độ dài, nhánh Over 150 words",
    testCase: new LLMTestCase({
      input: REQUEST,
      actualOutput: JSON.stringify({
        subject: "Cut ticket tagging time by 40%",
        body: LONG_BODY,
      }),
    }),
  },
];

// ===== CHẠY =====

async function main() {
  // Chấm lần lượt từng email, để giảm nguy cơ vượt giới hạn token/phút
  for (const { name, expect, testCase } of CASES) {
    logStep(`${name} (mong đợi: ${expect})`);
    // `measure()` ghi kết quả lên chính `emailMetric` (score, success, reason, verboseLogs)
    // → đọc ngay bên dưới, vì email sau sẽ ghi đè.
    try {
      await withRetry(() => emailMetric.measure(testCase));
    } catch (error) {
      // Hết token/ngày → các email sau cũng sẽ lỗi → dừng hẳn
      if (isDailyLimit(error)) throw error;
      // Lỗi khác → báo lỗi của email này rồi chấm tiếp email sau
      logInfo(`Lỗi khi chấm, bỏ qua email này: ${error.message}`);
      continue;
    }

    // `success` do DAGMetric tự tính từ `threshold` → không cần tự so với THRESHOLD
    const result = emailMetric.success ? "ĐẠT ✅" : "RỚT ❌";
    logInfo(`Điểm: ${emailMetric.score.toFixed(2)} ${result}`);
    logInfo(`Lý do: ${emailMetric.reason}`);
    // Trace: các node đã đi qua, LLM chọn đáp án gì ở mỗi node → đọc khi điểm lạ.
    // Trace chứa cả body email → đừng in khi chấm email thật của khách hàng.
    console.log(emailMetric.verboseLogs);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
