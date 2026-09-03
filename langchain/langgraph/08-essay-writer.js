// Essay Writer - dùng LLM để viết dàn ý, viết bài, tự chấm rồi sửa bài luận qua nhiều vòng lặp.
//
// Lưu ý: Đây là luồng cố định (plan -> research -> generate -> reflect -> critique...).
// Số vòng lặp do code điều khiển qua `maxRevisions`, không phải ReAct Agent tự quyết định.
// Cần dùng StateGraph thủ công thay vì createAgent để ép Model tuân thủ đúng quy trình.
//
// Các bước LLM tham gia:
//   planner - viết dàn ý (plan) từ đề bài.
//   research_plan / research_critique - Model sinh query tìm kiếm, rồi tìm tư liệu.
//   generate - viết/sửa bài luận (draft) dựa trên dàn ý + tư liệu.
//   reflect - đóng vai giáo viên, chấm bài và đưa nhận xét (critique).
//
/*
FLOW
[__start__] 
     │
     ▼
 [planner] ────────► [research_plan] ────────► [generate]
                                                   │
                                                   ▼
                                         (Kiểm tra số lần sửa)
                                            /           \
                 (chưa vượt maxRevisions)  /             \  (vượt maxRevisions)
                                          ▼               ▼
                                     [reflect]         [ END ]
                                         │
                                         ▼
                               [research_critique]
                                         │
                                         └────────────────┘ (quay lại generate)
*/

require("../_polyfill");
require("dotenv").config();

const { z } = require("zod");
const {
  StateGraph,
  END,
  Annotation,
  MemorySaver,
} = require("@langchain/langgraph");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { SystemMessage, HumanMessage } = require("@langchain/core/messages");
const { webSearch } = require("./tool");

const AgentState = Annotation.Root({
  task: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => "",
  }),
  plan: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => "",
  }),
  draft: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => "",
  }),
  critique: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => "",
  }),
  content: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => [],
  }),
  revisionNumber: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => 1,
  }),
  maxRevisions: Annotation({
    reducer: (current, update) => update ?? current,
    default: () => 2,
  }),
});

const model = new ChatGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
  model: "gemini-3.5-flash",
  temperature: 0,
});

// Schema ép Model trả về đúng { queries: string[] } thay vì văn xuôi tự do,
// dùng khi cần Model sinh ra danh sách câu truy vấn tìm kiếm.
const QueriesSchema = z.object({
  queries: z.array(z.string()).describe("Danh sách câu truy vấn tìm kiếm"),
});
const queryModel = model.withStructuredOutput(QueriesSchema);

const PLAN_PROMPT = `You are an expert writer tasked with writing a high level outline of an essay. \
Write such an outline for the user provided topic. Give an outline of the essay along with any relevant notes \
or instructions for the sections.`;

const REFLECTION_PROMPT = `You are a teacher grading an essay submission. \
Generate critique and recommendations for the user's submission. \
Provide detailed recommendations, including requests for length, depth, style, etc.`;

const RESEARCH_PLAN_PROMPT = `You are a researcher charged with providing information that can \
be used when writing the following essay. Generate a list of search queries that will gather \
any relevant information. Only generate 3 queries max.`;

const RESEARCH_CRITIQUE_PROMPT = `You are a researcher charged with providing information that can \
be used when making any requested revisions (as outlined below). \
Generate a list of search queries that will gather any relevant information. Only generate 3 queries max.`;

function buildWriterPrompt(content) {
  return `You are an essay assistant tasked with writing excellent 5-paragraph essays.\
Generate the best essay possible for the user's request and the initial outline. \
If the user provides critique, respond with a revised version of your previous attempts. \
Utilize all the information below as needed:

------

${content}`;
}

// Dùng Model sinh danh sách query tìm kiếm, rồi search từng query để lấy tư liệu.
async function collectResearch(systemPrompt, humanContent, existingContent) {
  const { queries } = await queryModel.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(humanContent),
  ]);

  const content = [...existingContent];
  for (const query of queries) {
    const result = await webSearch.invoke(query);
    content.push(result);
  }
  return content;
}

// planner: task -> plan (dàn ý).
async function planNode(state) {
  const messages = [
    new SystemMessage(PLAN_PROMPT),
    new HumanMessage(state.task),
  ];
  const response = await model.invoke(messages);
  return { plan: response.content };
}

// research_plan: task -> Model sinh query tìm kiếm, rồi search lấy tư liệu (nối vào content).
async function researchPlanNode(state) {
  const content = await collectResearch(
    RESEARCH_PLAN_PROMPT,
    state.task,
    state.content,
  );
  return { content };
}

// generate: task + plan + content -> Model viết/sửa bài luận (draft).
async function generationNode(state) {
  const content = state.content.join("\n\n");
  const humanMessage = new HumanMessage(
    `${state.task}\n\nHere is my plan:\n\n${state.plan}`,
  );
  const messages = [
    new SystemMessage(buildWriterPrompt(content)),
    humanMessage,
  ];
  const response = await model.invoke(messages);
  return {
    draft: response.content,
    revisionNumber: (state.revisionNumber ?? 1) + 1,
  };
}

// reflect: draft -> Model đóng vai giáo viên, chấm bài và đưa nhận xét (critique).
async function reflectionNode(state) {
  const messages = [
    new SystemMessage(REFLECTION_PROMPT),
    new HumanMessage(state.draft),
  ];
  const response = await model.invoke(messages);
  return { critique: response.content };
}

// research_critique: critique -> Model sinh query tìm kiếm, rồi search lấy thêm tư liệu.
async function researchCritiqueNode(state) {
  const content = await collectResearch(
    RESEARCH_CRITIQUE_PROMPT,
    state.critique,
    state.content,
  );
  return { content };
}

// Luôn viết đủ maxRevisions bản nháp mới dừng, chưa đủ thì quay lại "reflect" để sửa tiếp.
function shouldContinue(state) {
  if (state.revisionNumber > state.maxRevisions) return END;
  return "reflect";
}

const builder = new StateGraph(AgentState);
builder.addNode("planner", planNode);
builder.addNode("generate", generationNode);
builder.addNode("reflect", reflectionNode);
builder.addNode("research_plan", researchPlanNode);
builder.addNode("research_critique", researchCritiqueNode);

builder.addEdge("__start__", "planner");
builder.addEdge("planner", "research_plan");
builder.addEdge("research_plan", "generate");

builder.addConditionalEdges("generate", shouldContinue, {
  [END]: END,
  reflect: "reflect",
});

builder.addEdge("reflect", "research_critique");
builder.addEdge("research_critique", "generate");

const memory = new MemorySaver();
const graph = builder.compile({ checkpointer: memory });

async function main() {
  const thread = { configurable: { thread_id: "1" } };

  const events = await graph.stream(
    {
      task: "what is the difference between langchain and langsmith",
      maxRevisions: 2, // viết đủ 2 bản nháp mới dừng
      revisionNumber: 1,
    },
    thread,
  );

  for await (const event of events) {
    console.log(event);
  }
}

main();
