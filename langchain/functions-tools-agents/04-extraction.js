// =======================================================
// Extraction: giống Tagging, cũng dùng function calling, nhưng thay vì gắn
// 1 nhãn cho cả đoạn text, mục tiêu là trích ra NHIỀU mục thông tin có cấu
// trúc (vd: danh sách người được nhắc tới) từ trong đoạn text.
// =======================================================
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

// Thông tin về 1 người.
const personSchema = z.object({
  name: z.string().describe("person's name"),
  age: z.number().optional().describe("person's age"),
});

// Thông tin cần trích ra: 1 danh sách người.
const informationSchema = z.object({
  people: z.array(personSchema).describe("List of info about people"),
});

const extractionTool = zodToFunctionTool(
  "Information",
  "Information to extract.",
  informationSchema,
);

// tool_choice: điều khiển model có bắt buộc gọi tool hay không.
// - "auto": model tự quyết định có cần gọi tool hay không.
// - "any": model bắt buộc phải gọi 1 trong các tool được truyền vào.
// - "none": cấm model gọi bất kỳ tool nào.
// - "<tên tool>" (như "Information" ở đây): ép model luôn gọi đúng tool đó.
//   Đây chỉ là 1 chuỗi thường, phải gõ khớp tay với extractionTool.function.name
//   Có thể dùng extractionTool.function.name để tránh gõ lệch
const extractionModel = model.withConfig({
  tools: [extractionTool],
  tool_choice: "Information",
});

// RunnableLambda lấy args của tool_call đầu tiên -> trả thẳng ra object JSON
// đã trích được, thay vì cả 1 AIMessage.
const extractFirstToolArgs = RunnableLambda.from(
  (aiMessage) => aiMessage.tool_calls[0].args,
);

// RunnableLambda lấy tiếp field "people" ra khỏi kết quả trên -> chỉ còn lại
// đúng mảng người, không kèm theo các field khác của object args.
const extractPeopleField = RunnableLambda.from((args) => args.people);

async function main() {
  // Gọi model trực tiếp, không qua prompt template - model vẫn tự nhận ra
  // 2 người trong câu ("Joe" và "his mom is Martha").
  const directResult = await extractionModel.invoke(
    "Joe is 30, his mom is Martha",
  );
  console.log("\n=== 1. extractionModel.invoke trực tiếp (raw tool_calls) ===");
  console.log(directResult.tool_calls);

  // Dặn model không được tự bịa thông tin nếu văn bản không nói rõ, và vẫn
  // trích những phần thông tin có thể trích được (partial info).
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Extract the relevant information, if not explicitly provided do not guess. Extract partial info",
    ],
    ["human", "{input}"],
  ]);
  const extractionChain = prompt.pipe(extractionModel);

  const chainResult = await extractionChain.invoke({
    input: "Joe is 30, his mom is Martha",
  });
  console.log("\n=== 2. extractionChain.invoke (raw tool_calls) ===");
  console.log(chainResult.tool_calls);

  const argsOnly = await extractionChain
    .pipe(extractFirstToolArgs)
    .invoke({ input: "Joe is 30, his mom is Martha" });
  console.log("\n=== 3. extractionChain + parser (chỉ lấy args) ===");
  console.log(argsOnly);

  const peopleOnly = await extractionChain
    .pipe(extractFirstToolArgs)
    .pipe(extractPeopleField)
    .invoke({ input: "Joe is 30, his mom is Martha" });
  console.log("\n=== 4. extractionChain + parser (chỉ lấy field 'people') ===");
  console.log(peopleOnly);
}

main();
