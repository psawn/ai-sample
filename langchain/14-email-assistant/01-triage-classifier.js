// =======================================================================
// EMAIL ASSISTANT - BƯỚC 1: TRIAGE (PHÂN LOẠI EMAIL)
//
// Phân loại email vào 1 trong 3 nhãn: ignore / notify / respond.
//
// withStructuredOutput ép LLM trả về object đúng schema, thay vì văn bản tự do.
// Object gồm reasoning (giải thích) và classification (nhãn).
// Code đọc thẳng result.classification, không phải tự parse văn bản.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { profile, triageRules, questionEmail, spamEmail } = require("./profile");
const { buildTriageSystemPrompt, buildTriageUserPrompt } = require("./prompts");

// Schema đầu ra của bộ phân loại.
// enum giới hạn đúng 3 nhãn, LLM không sinh được nhãn ngoài danh sách.
const Router = z.object({
  reasoning: z
    .string()
    .describe("Step-by-step reasoning behind the classification."),
  classification: z
    .enum(["ignore", "respond", "notify"])
    .describe(
      "The classification of an email: 'ignore' for irrelevant emails, " +
        "'notify' for important information that doesn't need a response, " +
        "'respond' for emails that need a reply",
    ),
});

const llm = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Sau khi bọc, invoke() trả về object đúng schema Router, không phải AIMessage.
const llmRouter = llm.withStructuredOutput(Router);

// System prompt của bộ phân loại: hồ sơ người dùng + 3 quy tắc phân loại.
// examples = null: chưa dùng ví dụ mẫu (few-shot). Xem bước 05.
const systemPrompt = buildTriageSystemPrompt({
  fullName: profile.fullName,
  name: profile.name,
  userProfileBackground: profile.userProfileBackground,
  triageIgnore: triageRules.ignore,
  triageNotify: triageRules.notify,
  triageRespond: triageRules.respond,
  examples: null,
});

// Phân loại 1 email, in lý do và nhãn LLM chọn.
async function runTriage(emailInput) {
  const { author, to, subject, emailThread } = emailInput;
  const userPrompt = buildTriageUserPrompt({
    author,
    to,
    subject,
    emailThread,
  });

  const result = await llmRouter.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  console.log(`\n========== Email: "${subject}" ==========`);

  console.log(`🧠 Reasoning: ${result.reasoning}`);

  // classification chắc chắn thuộc 3 nhãn (enum), nên rẽ nhánh trực tiếp.
  if (result.classification === "respond") {
    console.log("📧 Classification: RESPOND - This email requires a response");
  } else if (result.classification === "ignore") {
    console.log("🚫 Classification: IGNORE - This email can be safely ignored");
  } else {
    console.log(
      "🔔 Classification: NOTIFY - This email contains important information",
    );
  }
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  await runTriage(spamEmail); // Email quảng cáo -> kỳ vọng: IGNORE.
  await runTriage(questionEmail); // Câu hỏi từ đồng nghiệp -> kỳ vọng: RESPOND.
}

main();
