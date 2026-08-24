// Agent có "trí nhớ" (Checkpointer)
// Mục tiêu:
//   - Giống hệt Agent ở agent.js, chỉ khác 1 điểm: graph.compile({ checkpointer }).
//   - Checkpointer tự động lưu `state.messages` sau MỖI bước chạy (mỗi Node), theo từng
//     "thread_id" riêng biệt.
// Lưu ý: nhờ vậy có thể:
//   - Trò chuyện nhiều lượt (multi-turn) mà không cần tự truyền lại lịch sử cũ.
//   - Chạy song song nhiều cuộc hội thoại độc lập (mỗi thread_id là 1 cuộc hội thoại).

require("../_polyfill");

const { StateGraph, END, MessagesAnnotation } = require("@langchain/langgraph");
const { SystemMessage, ToolMessage } = require("@langchain/core/messages");

const AgentState = MessagesAnnotation;

class Agent {
  // checkpointer: đối tượng lưu trạng thái (vd: new MemorySaver()) - bắt buộc phải có
  // để graph nhớ được hội thoại giữa các lần .invoke()/.stream() khác nhau.
  constructor(model, tools, checkpointer, system = "") {
    this.system = system;
    this.tools = Object.fromEntries(tools.map((t) => [t.name, t]));
    this.model = model.bindTools(tools);

    const graph = new StateGraph(AgentState);
    graph.addNode("llm", this.callModel.bind(this));
    graph.addNode("action", this.takeAction.bind(this));
    graph.addEdge("__start__", "llm");
    graph.addConditionalEdges("llm", this.existsAction.bind(this), {
      true: "action",
      false: END,
    });
    graph.addEdge("action", "llm");

    // Truyền checkpointer vào compile() -> graph tự lưu/khôi phục state theo thread_id.
    // checkpointer chính là đối tượng được truyền từ ngoài vào (vd: `new MemorySaver()`
    // ở nơi gọi `new Agent(...)`) - graph không tự tạo, chỉ nhận và dùng lại.
    this.graph = graph.compile({ checkpointer });
  }

  existsAction(state) {
    const lastMessage = state.messages[state.messages.length - 1];
    return lastMessage.tool_calls?.length ? "true" : "false";
  }

  async callModel(state) {
    let messages = state.messages;
    if (this.system) {
      messages = [new SystemMessage(this.system), ...messages];
    }
    const message = await this.model.invoke(messages);
    return { messages: [message] };
  }

  async takeAction(state) {
    const toolCalls = state.messages[state.messages.length - 1].tool_calls;
    const results = [];

    for (const call of toolCalls) {
      console.log(`  -> Đang gọi: ${call.name}(${JSON.stringify(call.args)})`);

      if (!this.tools[call.name]) {
        results.push(
          new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            content: "bad tool name, retry",
          }),
        );
        continue;
      }

      const toolMessage = await this.tools[call.name].invoke(call);
      results.push(toolMessage);
    }

    console.log("  -> Quay lại Node \"llm\" để Model đọc kết quả");
    return { messages: results };
  }
}

module.exports = { Agent, AgentState };
