// =======================================================================
// LANGCHAIN BASICS - OUTPUT PARSER
//
// Output parser làm 2 việc:
// 1. getFormatInstructions(): sinh hướng dẫn để AI trả đúng định dạng.
// 2. parse(): đổi text AI trả về thành dữ liệu JS dùng được.
//
// Demo 2 loại parser:
// - StructuredOutputParser: text -> object nhiều field (JSON).
// - CommaSeparatedListOutputParser: "a, b, c" -> mảng ["a", "b", "c"].
//
// Lưu ý: parser chỉ đọc text, không ép được model. Model trả sai format -> parse() throw.
// Cách chắc hơn: tool calling / withStructuredOutput (../10-functions-tools-agents/03-tagging.js).
// =======================================================================

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

// ===== 1. StructuredOutputParser: TEXT -> OBJECT =====

// Khai báo các field mong muốn (tên field: mô tả).
const structuredParser = StructuredOutputParser.fromNamesAndDescriptions({
  gift: "true nếu là quà tặng",
  delivery_days: "số ngày giao hàng",
  price: "nhận xét về giá",
});

// {format_instructions}: thay bằng hướng dẫn do parser sinh ra.
const structuredPrompt = ChatPromptTemplate.fromTemplate(`
{text}

{format_instructions}
`);

// Trích thông tin từ 1 review sản phẩm thành object.
async function structuredOutputDemo() {
  console.log(structuredParser.getFormatInstructions());

  const messages = await structuredPrompt.formatMessages({
    text: `Tôi mua sản phẩm này để tặng sinh nhật. Hàng giao sau 2 ngày.Giá hơi cao nhưng đáng tiền.`,
    // Hướng dẫn AI trả JSON đúng schema ở trên.
    format_instructions: structuredParser.getFormatInstructions(),
  });

  // AI trả text chứa JSON (thường bọc trong ```json ... ```).
  const response = await model.invoke(messages);

  console.log("LLM Output:");
  console.log(response.content);

  // Parse text JSON thành object JavaScript (tự bỏ ```json``` nếu có).
  const result = await structuredParser.parse(response.content);

  console.log("\nParsed Object:");
  console.log(result);

  console.log("\nDelivery Days:", result.delivery_days);
}

// ===== 2. CommaSeparatedListOutputParser: TEXT -> MẢNG =====
// Đơn giản hơn StructuredOutputParser: chỉ cần 1 danh sách "a, b, c".
const listParser = new CommaSeparatedListOutputParser();

const listPrompt = ChatPromptTemplate.fromTemplate(
  `Liệt kê 5 nguyên liệu chính để làm {dish}, phân tách bằng dấu phẩy.\n\n{format_instructions}`,
);

// Lấy danh sách nguyên liệu của 1 món ăn dưới dạng mảng.
async function commaSeparatedListDemo() {
  console.log("\n\n" + listParser.getFormatInstructions());

  const messages = await listPrompt.formatMessages({
    dish: "bánh mì",
    // Hướng dẫn AI trả đúng định dạng "a, b, c".
    format_instructions: listParser.getFormatInstructions(),
  });

  const response = await model.invoke(messages);

  console.log("\nLLM Output:");
  console.log(response.content);

  // Tách chuỗi "a, b, c" thành mảng ["a", "b", "c"].
  const result = await listParser.parse(response.content);

  console.log("\nParsed List:", result);
}

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  await structuredOutputDemo();
  await commaSeparatedListDemo();
}

main();
