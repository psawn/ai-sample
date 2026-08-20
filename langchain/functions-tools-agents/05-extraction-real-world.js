// =======================================================
// Extraction trên dữ liệu thực tế: áp dụng Tagging + Extraction (xem
// 03-tagging.js, 04-extraction.js) lên nội dung thật của 1 bài blog, thay vì
// vài câu ví dụ ngắn.
// =======================================================
require("../_polyfill");
require("dotenv").config();

// Node 18 chưa có sẵn global "File" (undici - thư viện fetch bên trong dùng
// tới nó) -> lấy tạm từ node:buffer, nếu không CheerioWebBaseLoader tải
// trang web sẽ báo lỗi "File is not defined".
if (typeof File === "undefined") {
  global.File = require("node:buffer").File;
}

const { z } = require("zod");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { RunnableLambda } = require("@langchain/core/runnables");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const {
  CheerioWebBaseLoader,
} = require("@langchain/community/document_loaders/web/cheerio");
const { zodToFunctionTool } = require("./util-zod-to-tool");

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// RunnableLambda lấy args của tool_call đầu tiên - dùng chung cho cả 2 demo
// tagging (Overview) và extraction (Info) bên dưới (xem 03-tagging.js để
// hiểu chi tiết cách hoạt động).
const extractFirstToolArgs = RunnableLambda.from(
  (aiMessage) => aiMessage.tool_calls[0].args,
);

// ============================
// 1. Tải nội dung bài blog
// ============================
async function loadBlogPost() {
  const loader = new CheerioWebBaseLoader(
    "https://lilianweng.github.io/posts/2023-06-23-agent/",
  );
  const [doc] = await loader.load();

  // Chỉ lấy 10000 ký tự đầu để demo cho nhanh, không cần xử lý cả bài dài.
  const pageContent = doc.pageContent.slice(0, 10000);

  console.log("\n=== 1. Nội dung bài blog (1000 ký tự đầu) ===");
  console.log(pageContent.slice(0, 1000));

  return { doc, pageContent };
}

// ============================
// 2. Tagging tổng quan bài viết (Overview)
// ============================
async function overviewTaggingDemo(pageContent) {
  const overviewSchema = z.object({
    summary: z.string().describe("Provide a concise summary of the content."),
    language: z
      .string()
      .describe("Provide the language that the content is written in."),
    keywords: z.string().describe("Provide keywords related to the content."),
  });

  const overviewTool = zodToFunctionTool(
    "Overview",
    "Overview of a section of text.",
    overviewSchema,
  );

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "Think carefully, and then tag the text as instructed"],
    ["human", "{input}"],
  ]);
  // tool_choice: ép model luôn gọi đúng tool "Overview" (xem đủ các option
  // của tool_choice ở 03-tagging.js).
  const taggingModel = model.withConfig({
    tools: [overviewTool],
    tool_choice: "Overview",
  });
  const taggingChain = prompt.pipe(taggingModel).pipe(extractFirstToolArgs);

  const result = await taggingChain.invoke({ input: pageContent });
  console.log("\n=== 2. Overview tagging (summary/language/keywords) ===");
  console.log(result);
}

// ============================
// 3. Trích danh sách paper được nhắc tới trong bài
// ============================
async function paperExtractionDemo(pageContent) {
  const paperSchema = z.object({
    title: z.string(),
    author: z.string().optional(),
  });
  const infoSchema = z.object({
    papers: z
      .array(paperSchema)
      .describe("List of papers mentioned in the text"),
  });

  const infoTool = zodToFunctionTool(
    "Info",
    "Information to extract",
    infoSchema,
  );
  // tool_choice: ép model luôn gọi đúng tool "Info" (xem đủ các option của
  // tool_choice ở 03-tagging.js).
  const extractionModel = model.withConfig({
    tools: [infoTool],
    tool_choice: "Info",
  });

  // Prompt đầu tiên khá chung chung -> model có thể tự nhặt nhầm tiêu đề bài
  // báo (article) làm "paper".
  const genericPrompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "Extract the relevant information, if not explicitly provided do not guess. Extract partial info",
    ],
    ["human", "{input}"],
  ]);
  const genericExtractionChain = genericPrompt
    .pipe(extractionModel)
    .pipe(extractFirstToolArgs)
    .pipe(RunnableLambda.from((args) => args.papers));

  const genericResult = await genericExtractionChain.invoke({
    input: pageContent,
  });
  console.log("\n=== 3a. Trích paper - prompt chung chung ===");
  console.log(genericResult);

  // Prompt chi tiết hơn: dặn rõ không lấy tên bài viết hiện tại, không tự
  // bịa thông tin, và trả mảng rỗng nếu bài không nhắc tới paper nào.
  const strictTemplate = `A article will be passed to you. Extract from it all papers that are mentioned by this article follow by its author.

Do not extract the name of the article itself. If no papers are mentioned that's fine - you don't need to extract any! Just return an empty list.

Do not make up or guess ANY extra information. Only extract what exactly is in the text.`;

  const strictPrompt = ChatPromptTemplate.fromMessages([
    ["system", strictTemplate],
    ["human", "{input}"],
  ]);
  const extractionChain = strictPrompt
    .pipe(extractionModel)
    .pipe(extractFirstToolArgs)
    .pipe(RunnableLambda.from((args) => args.papers));

  const strictResult = await extractionChain.invoke({ input: pageContent });
  console.log("\n=== 3b. Trích paper - prompt chặt chẽ hơn ===");
  console.log(strictResult);

  // Văn bản không liên quan gì tới paper -> phải trả về mảng rỗng, không
  // được bịa ra paper nào.
  const emptyResult = await extractionChain.invoke({ input: "hi" });
  console.log("\n=== 3c. Trích paper - văn bản không có paper nào ===");
  console.log(emptyResult);

  return extractionChain;
}

// ============================
// 4. Chạy extraction trên TOÀN BỘ bài viết bằng cách chia nhỏ (splitter)
// ============================
// Bài viết đầy đủ dài hơn nhiều so với 10000 ký tự demo ở trên, dài hơn cả
// giới hạn 1 lần gọi model. Cách xử lý gồm 3 bước:
// 1. Chia bài viết thành nhiều đoạn nhỏ (splits).
// 2. Chạy extraction riêng cho TỪNG đoạn.
// 3. Gộp kết quả của các đoạn (mảng của mảng) lại thành 1 mảng phẳng duy
//    nhất bằng Array.prototype.flat().
async function fullDocumentExtractionDemo(doc, extractionChain) {
  const textSplitter = new RecursiveCharacterTextSplitter({ chunkOverlap: 0 });
  const splits = await textSplitter.splitText(doc.pageContent);

  console.log("\n=== 4a. Số đoạn sau khi chia nhỏ (splits) ===");
  console.log("Số đoạn:", splits.length);
  console.log("Đoạn đầu tiên (splits[0]):", splits[0]);

  // RunnableLambda biến 1 chuỗi text dài thành mảng input cho extractionChain
  // (mỗi đoạn splits[i] -> { input: splits[i] }).
  const prep = RunnableLambda.from(async (pageContent) => {
    const chunks = await textSplitter.splitText(pageContent);
    return chunks.map((chunk) => ({ input: chunk }));
  });

  console.log("\n=== 4b. prep.invoke('hi') (input ngắn -> vẫn ra 1 chunk) ===");
  console.log(await prep.invoke("hi"));

  // chain:
  //   - chia nhỏ
  //   - chạy extractionChain trên TỪNG đoạn (song song, nhờ .map())
  //   - gộp kết quả (mảng của mảng) thành 1 mảng phẳng bằng .flat() [[1,2], [3], [4,5]] -> [1,2,3,4,5]
  //
  // Lưu ý: bước này gọi model 1 lần cho MỖI đoạn -> khá tốn API call với bài
  // viết dài, nên demo chỉ bật khi cần xem kết quả đầy đủ.
  const chain = prep
    .pipe(extractionChain.map())
    .pipe(RunnableLambda.from((results) => results.flat()));

  console.log(
    "\n=== 4c. Trích paper trên toàn bộ bài viết (bỏ comment để chạy) ===",
  );
  // const fullResult = await chain.invoke(doc.pageContent);
  // console.log(fullResult);
  console.log("(đang tắt - xem comment trong code để bật)");
}

async function main() {
  const { doc, pageContent } = await loadBlogPost();

  await overviewTaggingDemo(pageContent);

  const extractionChain = await paperExtractionDemo(pageContent);

  await fullDocumentExtractionDemo(doc, extractionChain);
}

main();
