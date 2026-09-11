// Email Assistant - Bước 1: TRIAGE (phân loại email)
//
// Ý tưởng: thay vì để LLM trả lời tự do, ta ép LLM trả về đúng 1 object theo schema
// (`withStructuredOutput`) gồm "reasoning" (giải thích) + "classification" (1 trong 3 nhãn
// cố định). Nhờ vậy code phía sau đọc kết quả (result.classification) mà không cần tự
// parse văn bản tự do của LLM.

require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { profile, triageRules, questionEmail, spamEmail } = require("./profile");
const { buildTriageSystemPrompt, buildTriageUserPrompt } = require("./prompts");

// Schema kết quả phân loại: enum giới hạn đúng 3 lựa chọn để LLM không "sáng tác" nhãn lạ.
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

// Bọc withStructuredOutput(Router) quanh llm -> mọi lần invoke() đều trả về object đúng
// shape của Router thay vì AIMessage văn bản thô.
const llmRouter = llm.withStructuredOutput(Router);

const systemPrompt = buildTriageSystemPrompt({
  fullName: profile.fullName,
  name: profile.name,
  userProfileBackground: profile.userProfileBackground,
  triageIgnore: triageRules.ignore,
  triageNotify: triageRules.notify,
  triageRespond: triageRules.respond,
  examples: null,
});

async function runTriage(emailInput) {
  const { author, to, subject, emailThread } = emailInput;
  const userPrompt = buildTriageUserPrompt({ author, to, subject, emailThread });

  const result = await llmRouter.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  console.log(`\n========== Email: "${subject}" ==========`);
  console.log(result);
}

async function main() {
  await runTriage(spamEmail); // Kỳ vọng: classification = "ignore".
  await runTriage(questionEmail); // Kỳ vọng: classification = "respond".
}

main();
