// =======================================================================
// FUNCTIONS, TOOLS & AGENTS - BƯỚC 4: EXTRACTION (TRÍCH XUẤT THÔNG TIN)
//
// Cùng kỹ thuật với Tagging (bước 3), khác mục đích:
// - Tagging: gắn nhãn cho cả đoạn text (1 kết quả).
// - Extraction: trích nhiều mục có cấu trúc từ text.
//   Vd: danh sách người được nhắc tới.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { RunnableLambda } = require("@langchain/core/runnables");
const { zodToFunctionTool } = require("./util-zod-to-tool");

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Thông tin 1 người. age optional: text không nói tuổi thì bỏ trống.
const personSchema = z.object({
  name: z.string().describe("person's name"),
  age: z.number().optional().describe("person's age"),
});

// Thông tin cần trích: 1 danh sách người.
const informationSchema = z.object({
  people: z.array(personSchema).describe("List of info about people"),
});

// Đổi schema thành function tool tên "Information".
const extractionTool = zodToFunctionTool(
  "Information",
  "Information to extract.",
  informationSchema,
);

// Ép model luôn gọi tool "Information" (các option tool_choice: 03-tagging.js).
const extractionModel = model.withConfig({
  tools: [extractionTool],
  tool_choice: "Information",
});

// Lấy args của tool_call đầu tiên -> ra thẳng object đã trích, thay vì cả AIMessage.
const extractFirstToolArgs = RunnableLambda.from(
  (aiMessage) => aiMessage.tool_calls[0].args,
);

// Lấy tiếp field "people" -> chỉ còn mảng người.
const extractPeopleField = RunnableLambda.from((args) => args.people);

// ===== KỊCH BẢN MINH HỌA =====
async function main() {
  // Case 1: gọi model trực tiếp, không qua prompt
  // -> model vẫn nhận ra 2 người ("Joe" và "Martha").
  const directResult = await extractionModel.invoke(
    "Joe is 30, his mom is Martha",
  );
  console.log("\n=== 1. extractionModel.invoke trực tiếp (raw tool_calls) ===");
  console.log(directResult.tool_calls);

  // Prompt dặn model: không đoán thông tin text không nói rõ, nhưng vẫn trích phần có được.
  // Vd: text không nói tuổi Martha -> bỏ trống age, không đoán.
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Extract the relevant information, if not explicitly provided do not guess. Extract partial info",
    ],
    ["human", "{input}"],
  ]);
  const extractionChain = prompt.pipe(extractionModel);

  // Case 2: qua prompt -> xem tool_calls thô.
  const chainResult = await extractionChain.invoke({
    input: "Joe is 30, his mom is Martha",
  });
  console.log("\n=== 2. extractionChain.invoke (raw tool_calls) ===");
  console.log(chainResult.tool_calls);

  // Case 3: thêm parser -> chỉ lấy args ({ people: [...] }).
  const argsOnly = await extractionChain
    .pipe(extractFirstToolArgs)
    .invoke({ input: "Joe is 30, his mom is Martha" });
  console.log("\n=== 3. extractionChain + parser (chỉ lấy args) ===");
  console.log(argsOnly);

  // Case 4: thêm 1 parser nữa -> chỉ còn mảng people.
  const peopleOnly = await extractionChain
    .pipe(extractFirstToolArgs)
    .pipe(extractPeopleField)
    .invoke({ input: "Joe is 30, his mom is Martha" });
  console.log("\n=== 4. extractionChain + parser (chỉ lấy field 'people') ===");
  console.log(peopleOnly);
}

main();
