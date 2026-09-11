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

const prompt = ChatPromptTemplate.fromTemplate(
  `Translate "{text}" to {language}.`,
);

async function main() {
  const messages = await prompt.formatMessages({
    text: "Hello",
    language: "Vietnamese",
  });

  // Gọi API Gemini với messages đã điền để lấy câu trả lời.
  const response = await model.invoke(messages);

  console.log(response.content);
}

main();
