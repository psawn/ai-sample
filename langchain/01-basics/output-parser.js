require("../_polyfill");
require("dotenv").config();
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const {
  StructuredOutputParser,
  CommaSeparatedListOutputParser,
} = require("@langchain/core/output_parsers");

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
const structuredParser = StructuredOutputParser.fromNamesAndDescriptions({
  gift: "true nếu là quà tặng",
  delivery_days: "số ngày giao hàng",
  price: "nhận xét về giá",
});

const structuredPrompt = ChatPromptTemplate.fromTemplate(`
{text}

{format_instructions}
`);

async function structuredOutputDemo() {
  console.log(structuredParser.getFormatInstructions());

  const messages = await structuredPrompt.formatMessages({
    text: `Tôi mua sản phẩm này để tặng sinh nhật. Hàng giao sau 2 ngày.Giá hơi cao nhưng đáng tiền.`,
    // Tự sinh hướng dẫn để AI trả về JSON đúng schema ở trên.
    format_instructions: structuredParser.getFormatInstructions(),
  });

  // Gọi API Gemini với messages (đã kèm format_instructions) để lấy câu trả lời dạng JSON.
  const response = await model.invoke(messages);

  console.log("LLM Output:");
  console.log(response.content);

  // Parse JSON AI trả về thành object JavaScript.
  const result = await structuredParser.parse(response.content);

  console.log("\nParsed Object:");
  console.log(result);

  console.log("\nDelivery Days:", result.delivery_days);
}

// CommaSeparatedListOutputParser: đơn giản hơn StructuredOutputParser ở trên - chỉ cần 1
// danh sách text dạng "a, b, c", không cần ép AI trả JSON có cấu trúc nhiều field.
const listParser = new CommaSeparatedListOutputParser();

const listPrompt = ChatPromptTemplate.fromTemplate(
  `Liệt kê 5 nguyên liệu chính để làm {dish}, phân tách bằng dấu phẩy.\n\n{format_instructions}`,
);

async function commaSeparatedListDemo() {
  console.log("\n\n" + listParser.getFormatInstructions());

  const messages = await listPrompt.formatMessages({
    dish: "bánh mì",
    // Dặn AI trả về đúng định dạng "a, b, c" mà parser dưới đây hiểu được.
    format_instructions: listParser.getFormatInstructions(),
  });

  const response = await model.invoke(messages);

  console.log("\nLLM Output:");
  console.log(response.content);

  // Tách chuỗi "a, b, c" thành mảng ["a", "b", "c"].
  const result = await listParser.parse(response.content);

  console.log("\nParsed List:", result);
}

async function main() {
  await structuredOutputDemo();
  await commaSeparatedListDemo();
}

main();
