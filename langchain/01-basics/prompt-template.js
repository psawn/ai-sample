// =======================================================================
// LANGCHAIN BASICS - PROMPT TEMPLATE
//
// Prompt template: prompt có chỗ trống {biến}. Viết 1 lần, dùng lại nhiều lần
// bằng cách điền giá trị khác nhau qua formatMessages().
//
// Flow:
// 1. formatMessages({ biến }) -> mảng messages.
// 2. model.invoke(messages) -> AIMessage.
// =======================================================================

require("../_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Template có 2 biến: {text} và {language}.
const prompt = ChatPromptTemplate.fromTemplate(
  `Translate "{text}" to {language}.`,
);

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Điền giá trị vào các biến -> mảng messages.
  const messages = await prompt.formatMessages({
    text: "Hello",
    language: "Vietnamese",
  });

  // Gửi messages đã điền cho Gemini.
  const response = await model.invoke(messages);

  console.log(response.content);
}

main();
