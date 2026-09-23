// =======================================================================
// EMAIL ASSISTANT (TYPESAFE) - BƯỚC 1: TRIAGE (PHÂN LOẠI EMAIL)
//
// Phân loại email (ignore / notify / respond), kèm spam và mức khẩn, rồi chọn hành động.
// Viết lại từ langchain/14-email-assistant/01-triage-classifier.js (gọi tắt: "file gốc").
//
// Khác biệt kiến trúc:
// - File gốc: LLM sinh JSON theo schema zod (withStructuredOutput), cần tự viết
//   prompt system/user.
// - File này: TypeSafe không sinh văn bản. Chỉ khai báo câu hỏi + các lựa chọn,
//   output là xác suất của từng lựa chọn.
//
// 3 loại câu hỏi của TypeSafe:
// - choice(instructions, { label: mô tả, ... }) -> { choice, confidence, probabilities }
// - noul(instructions, { true, false })         -> { noul }: xác suất "có", 0..1
// - score(instructions, [mức 0, mức 1, ...])    -> { score, confidence, probabilities }
//   score là giá trị kỳ vọng, có thể lẻ (2.7).
//
// 1 lần gọi systemOne() hỏi được nhiều câu trên cùng 1 state.
// =======================================================================

require("dotenv").config();

const { choice, noul, score, TypeSafeClient } = require("@typesafe-ai/sdk");
const {
  profile,
  triageRules,
  questionEmail,
  spamEmail,
} = require("../langchain/14-email-assistant/profile");

// Client đọc TYPESAFE_API_KEY từ môi trường.
const client = new TypeSafeClient();

// Email mẫu cho nhãn "notify": cần báo cho user, không cần trả lời.
const notifyEmail = {
  author: "CI Bot <ci@company.com>",
  to: "John Doe <john.doe@company.com>",
  subject: "Build #1423 failed on branch main",
  emailThread: `Build #1423 on branch 'main' failed at step 'integration-tests'.
3 tests failed in auth-service. See logs: https://ci.company.com/builds/1423`,
};

// 3 câu hỏi cho mỗi email: thuộc loại nào, có phải spam, khẩn cấp tới đâu.
// Mô tả của từng nhãn chính là quy tắc phân loại. File gốc viết quy tắc này trong system prompt.
const triageQuestions = {
  category: choice(
    `You are triaging emails for ${profile.fullName}. Classify this email.`,
    {
      ignore: triageRules.ignore,
      notify: triageRules.notify,
      respond: triageRules.respond,
    },
  ),
  spam: noul("Is this email spam or unsolicited marketing?", {
    true: "The email is spam or unsolicited marketing.",
    false: "The email is legitimate work communication.",
  }),
  urgency: score("How urgent is this email for the recipient?", [
    "Not urgent at all, can be ignored",
    "Low urgency, can wait a few days",
    "Medium urgency, should be handled today",
    "High urgency, needs attention within the hour",
  ]),
};

async function runTriage(email) {
  const response = await client.systemOne({
    // state nhận chuỗi hoặc object bất kỳ, không cần prompt template.
    state: {
      recipient: {
        fullName: profile.fullName,
        name: profile.name,
        background: profile.userProfileBackground,
      },
      email,
    },
    questions: triageQuestions,
  });

  console.log(`\n========== Email: "${email.subject}" ==========`);

  console.log("📦 Response:", response);

  const { category, spam } = response.answers;

  // ===== CHỌN HÀNH ĐỘNG THEO XÁC SUẤT =====
  // Thứ tự xét:
  // 1. Chắc chắn là spam -> chuyển vào thư mục spam.
  // 2. confidence dưới ngưỡng -> nhờ user xem lại, không tự bỏ qua email.
  // 3. Còn lại -> làm theo nhãn.
  // File gốc chỉ có nhãn, không có độ tin cậy nên không làm được bước 2.
  const CONFIDENCE_THRESHOLD = 0.7;

  let action;

  if (spam.noul > 0.9) {
    action = "🚫 Move to spam folder";
  } else if (category.confidence < CONFIDENCE_THRESHOLD) {
    action = "🤔 Low confidence -> ask the user to review";
  } else if (category.choice === "respond") {
    action = "📧 Draft a reply (step 2: response agent)";
  } else if (category.choice === "notify") {
    action = "🔔 Notify the user";
  } else {
    action = "🙈 Ignore";
  }

  console.log(`👉 Action: ${action}`);
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  await runTriage(spamEmail); // Kỳ vọng: IGNORE, spam cao.
  await runTriage(questionEmail); // Kỳ vọng: RESPOND.
  await runTriage(notifyEmail); // Kỳ vọng: NOTIFY, urgency khá cao.
}

main();
