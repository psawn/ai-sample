// =======================================================================
// FUNCTIONS, TOOLS & AGENTS - BƯỚC 2: LCEL (LangChain Expression Language)
//
// LCEL nối các bước (prompt, model, parser, retriever...) thành chain bằng .pipe().
// Mỗi bước là 1 Runnable: nhận input, trả output cho bước sau.
//
// 5 demo (bật/tắt trong main()):
// 1. Simple chain: prompt -> model -> parser.
// 2. Chain phức tạp: RunnableMap + retriever (RAG cơ bản).
// 3. Bind: gắn sẵn tools vào model.
// 4. Fallbacks: chain chính lỗi -> tự chạy chain dự phòng.
// 5. Interface: invoke / batch / stream.
// =======================================================================

require("../_polyfill");
require("dotenv").config();

const {
  ChatGoogleGenerativeAI,
  GoogleGenerativeAIEmbeddings,
} = require("@langchain/google-genai");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { RunnableMap, RunnableLambda } = require("@langchain/core/runnables");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");

const apiKey = process.env.GEMINI_API_KEY;

const model = new ChatGoogleGenerativeAI({
  apiKey,
  model: "gemini-3.5-flash",
  temperature: 0.7,
});

// ===== DEMO 1: SIMPLE CHAIN =====

// prompt.pipe(model).pipe(outputParser):
// 1. prompt: điền {topic} vào template.
// 2. model: gửi prompt cho LLM, nhận AIMessage.
// 3. outputParser: lấy text từ AIMessage.content, bỏ metadata.
async function simpleChainDemo() {
  const prompt = ChatPromptTemplate.fromTemplate(
    "tell me a short joke about {topic}",
  );
  const outputParser = new StringOutputParser();

  const chain = prompt.pipe(model).pipe(outputParser);

  const result = await chain.invoke({ topic: "bears" });
  console.log("\n=== 1. Simple Chain ===");
  console.log(result);
}

// ===== DEMO 2: CHAIN PHỨC TẠP (RunnableMap + retriever) =====

// RAG cơ bản:
// 1. RunnableMap: từ input { question }, tạo { context, question }.
// 2. retriever: tìm đoạn văn bản liên quan câu hỏi -> context.
// 3. prompt -> model -> outputParser: LLM trả lời chỉ dựa trên context.
async function complexChainDemo() {
  // embeddings: đổi câu thành vector. MemoryVectorStore: lưu vector trong RAM.
  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey,
    model: "gemini-embedding-001",
  });
  const vectorstore = await MemoryVectorStore.fromTexts(
    ["harrison worked at kensho", "bears like to eat honey"],
    // Metadata cho từng câu, đúng thứ tự. Để trống khi không cần lọc.
    [{}, {}],
    embeddings,
  );
  // retriever: nhận câu hỏi -> trả các đoạn gần nghĩa nhất.
  const retriever = vectorstore.asRetriever();

  // Thử retriever riêng trước khi ghép vào chain.
  const docs1 = await retriever.invoke("where did harrison work?");
  console.log("\n=== 2a. retriever.invoke: harrison worked at ===");
  console.log(docs1.map((d) => d.pageContent));

  const docs2 = await retriever.invoke("what do bears like to eat");
  console.log("\n=== 2b. retriever.invoke: bears like to eat ===");
  console.log(docs2.map((d) => d.pageContent));

  // Gộp các document thành 1 chuỗi, vì {context} trong prompt phải là text.
  function formatDocuments(docs) {
    return docs.map((doc) => doc.pageContent).join("\n\n");
  }

  const template = `Answer the question based only on the following context:
{context}

Question: {question}
`;
  const prompt = ChatPromptTemplate.fromTemplate(template);
  const outputParser = new StringOutputParser();

  // RunnableMap: mỗi key tự tính giá trị từ input gốc { question }, chạy song song.
  // - context: gọi retriever, gộp kết quả thành text.
  // - question: giữ nguyên input.question.
  const chain = RunnableMap.from({
    context: async (x) => formatDocuments(await retriever.invoke(x.question)),
    question: (x) => x.question,
  })
    .pipe(prompt)
    .pipe(model)
    .pipe(outputParser);

  const answer = await chain.invoke({ question: "where did harrison work?" });
  console.log("\n=== 2c. Complex chain (RunnableMap -> prompt -> model) ===");
  console.log(answer);

  // Chạy riêng RunnableMap để xem object { context, question } trước khi vào prompt.
  const inputs = RunnableMap.from({
    context: async (x) => formatDocuments(await retriever.invoke(x.question)),
    question: (x) => x.question,
  });
  const mappedInputs = await inputs.invoke({
    question: "where did harrison work?",
  });
  console.log("\n=== 2d. RunnableMap đứng riêng (context + question) ===");
  console.log(mappedInputs);
}

// ===== DEMO 3: BIND (GẮN SẴN TOOLS VÀO MODEL) =====

// model.withConfig({ tools }) (thay .bind() đã deprecated):
// - Tạo Runnable mới, gắn sẵn tools.
// - Mọi lần invoke sau tự kèm tools, không cần truyền lại.
// Format tools giống 01-function-calling.js.
async function bindDemo() {
  const prompt = ChatPromptTemplate.fromMessages([["human", "{input}"]]);

  // Tool tra thời tiết theo mã sân bay.
  const weatherTools = [
    {
      type: "function",
      function: {
        name: "weather_search",
        description: "Search for weather given an airport code",
        parameters: {
          type: "object",
          properties: {
            airport_code: {
              type: "string",
              description: "The airport code to get the weather for",
            },
          },
          required: ["airport_code"],
        },
      },
    },
  ];
  // Tool tra tin thể thao theo tên đội.
  const sportTools = [
    {
      type: "function",
      function: {
        name: "sports_search",
        description: "Search for news of recent sport events",
        parameters: {
          type: "object",
          properties: {
            team_name: {
              type: "string",
              description: "The sports team to search for",
            },
          },
          required: ["team_name"],
        },
      },
    },
  ];

  // 3a. Gắn 1 tool (weather_search), hỏi thời tiết -> kỳ vọng gọi tool này.
  const modelWithWeatherTool = model.withConfig({ tools: weatherTools });
  const runnable = prompt.pipe(modelWithWeatherTool);

  const weatherResponse = await runnable.invoke({
    input: "what is the weather in sf",
  });
  console.log("\n=== 3a. Bind: 1 tool (weather_search) ===");
  console.log("tool_calls:", weatherResponse.tool_calls);

  // 3b. Gắn cả 2 tool, hỏi thể thao -> kỳ vọng model chọn sports_search.
  const multiTools = [...weatherTools, ...sportTools];

  const modelWithMultiTools = model.withConfig({ tools: multiTools });
  const runnableMultiTools = prompt.pipe(modelWithMultiTools);

  const sportsResponse = await runnableMultiTools.invoke({
    input: "how did the patriots do yesterday?",
  });
  console.log("\n=== 3b. Bind: 2 tools (weather_search + sports_search) ===");
  console.log("tool_calls:", sportsResponse.tool_calls);

  // 3c. Câu hỏi không liên quan tool -> model trả lời bằng chữ, tool_calls rỗng.
  const chatResponse = await runnableMultiTools.invoke({
    input: "hi, how are you?",
  });
  console.log("\n=== 3c. Bind: câu hỏi không liên quan -> không gọi tool ===");
  console.log("tool_calls:", chatResponse.tool_calls);
  console.log("content:", chatResponse.content);
}

// ===== DEMO 4: FALLBACKS (CHAIN DỰ PHÒNG) =====

// withFallbacks: chain chính throw -> tự thử chain dự phòng, không crash.
// 1. simpleChain: không dặn format -> model hay bọc JSON trong ```json``` -> parse lỗi.
// 2. strictJsonChain: dặn rõ chỉ trả JSON thuần -> parse ổn định hơn.
// 3. finalChain: chạy simpleChain trước, lỗi thì chuyển sang strictJsonChain.
async function fallbacksDemo() {
  const challenge =
    "write three poems in a json blob, where each poem is a json blob of a title, author, and first line";

  // RunnableMap vs RunnableLambda (đều .pipe() được vào chain):
  // - RunnableMap: nhiều nhánh song song trên cùng input -> object nhiều key.
  // - RunnableLambda: bọc 1 hàm, 1 input -> 1 output.
  // Vd:
  //   await RunnableMap.from({
  //     upper: (s) => s.toUpperCase(),
  //     length: (s) => s.length,
  //   }).invoke("hi"); // -> { upper: "HI", length: 2 }
  //
  //   await RunnableLambda.from((s) => s.toUpperCase()).invoke("hi"); // -> "HI"

  // Chain chính: không dặn format -> JSON.parse() dễ lỗi nếu model kèm markdown.
  const simpleChain = model
    .pipe(new StringOutputParser())
    .pipe(RunnableLambda.from((text) => JSON.parse(text)));

  console.log(
    "\n=== 4a. simpleChain.invoke (dự kiến có thể lỗi JSON.parse) ===",
  );
  try {
    const result = await simpleChain.invoke(challenge);
    console.log(result);
  } catch (error) {
    console.log("Lỗi JSON.parse:", error.message);
  }

  // Chain dự phòng: thêm SystemMessage dặn chỉ trả JSON thuần.
  //
  // Vì sao mở đầu bằng RunnableLambda, không phải model.pipe như simpleChain?
  // - Cần đổi input string thành [SystemMessage, HumanMessage] trước khi vào model.
  // - Bước đổi đó phải là 1 Runnable -> RunnableLambda.from((text) => [...]).
  // - "text" là input ban đầu (biến challenge).
  const strictJsonChain = RunnableLambda.from((text) => [
    new SystemMessage(
      "Only output raw JSON. Do not wrap it in markdown code fences and do not add any explanation.",
    ),
    new HumanMessage(text),
  ])
    .pipe(model)
    .pipe(new StringOutputParser())
    .pipe(RunnableLambda.from((text) => JSON.parse(text)));

  // Thử simpleChain trước, lỗi thì chạy strictJsonChain.
  const finalChain = simpleChain.withFallbacks([strictJsonChain]);

  const finalResult = await finalChain.invoke(challenge);
  console.log("\n=== 4b. finalChain.invoke (có fallback) ===");
  console.log(finalResult);
}

// ===== DEMO 5: INTERFACE (invoke / batch / stream) =====

// Mọi Runnable đều có 3 method chung:
// 1. invoke: 1 input -> đợi kết quả đầy đủ.
// 2. batch: nhiều input chạy song song -> mảng kết quả, đúng thứ tự input.
// 3. stream: nhận từng phần ngay khi model sinh ra.
async function interfaceDemo() {
  const prompt = ChatPromptTemplate.fromTemplate(
    "Tell me a short joke about {topic}",
  );
  const outputParser = new StringOutputParser();
  const chain = prompt.pipe(model).pipe(outputParser);

  const invokeResult = await chain.invoke({ topic: "bears" });
  console.log("\n=== 5a. chain.invoke ===");
  console.log(invokeResult);

  const batchResult = await chain.batch([
    { topic: "bears" },
    { topic: "frogs" },
  ]);
  console.log("\n=== 5b. chain.batch ===");
  console.log(batchResult);

  // In từng chunk ngay khi nhận -> người dùng thấy chữ hiện dần, không phải chờ.
  console.log("\n=== 5c. chain.stream ===");
  for await (const chunk of await chain.stream({ topic: "bears" })) {
    process.stdout.write(chunk);
  }
  console.log();
}

// ===== KỊCH BẢN MINH HỌA =====
// Bỏ comment demo muốn chạy.
async function main() {
  // await simpleChainDemo();
  // await complexChainDemo();
  // await bindDemo();
  // await fallbacksDemo();
  await interfaceDemo();
}

main();
