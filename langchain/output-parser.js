require("./_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { StructuredOutputParser } = require("@langchain/core/output_parsers");

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Khai báo schema mong muốn của Output.
// Parser sẽ:
// 1. Sinh hướng dẫn để AI trả về đúng JSON.
// 2. Parse JSON đó thành object JavaScript.
const parser = StructuredOutputParser.fromNamesAndDescriptions({
  gift: "true nếu là quà tặng",
  delivery_days: "số ngày giao hàng",
  price: "nhận xét về giá",
});

const prompt = ChatPromptTemplate.fromTemplate(`
{text}

{format_instructions}
`);

async function main() {
  console.log(parser.getFormatInstructions());

  const messages = await prompt.formatMessages({
    text: `Tôi mua sản phẩm này để tặng sinh nhật. Hàng giao sau 2 ngày.Giá hơi cao nhưng đáng tiền.`,
    // Tự sinh hướng dẫn để AI trả về JSON đúng schema ở trên.
    format_instructions: parser.getFormatInstructions(),
  });

  // Gọi API Gemini với messages (đã kèm format_instructions) để lấy câu trả lời dạng JSON.
  const response = await model.invoke(messages);

  console.log("LLM Output:");
  console.log(response.content);

  // Parse JSON AI trả về thành object JavaScript.
  const result = await parser.parse(response.content);

  console.log("\nParsed Object:");
  console.log(result);

  console.log("\nDelivery Days:", result.delivery_days);
}

main();
