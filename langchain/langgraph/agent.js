// LangGraph Components
// Thay vì viết vòng lặp manually (gọi LLM -> chạy Tool -> lặp lại), bài này dựng luồng
// xử lý đó thành 1 GRAPH (Đồ thị) để LangGraph tự động điều phối State và vòng lặp.

require("../_polyfill");

const { StateGraph, END, MessagesAnnotation } = require("@langchain/langgraph");
const { SystemMessage, ToolMessage } = require("@langchain/core/messages");

// State là "bộ nhớ chung" chảy xuyên suốt qua các Node.
// MessagesAnnotation là 1 State dựng sẵn của LangGraph, có đúng 1 field "messages" với cơ chế tự nối thêm (append) mỗi khi 1 Node trả về messages mới.
// Mọi Node khi return { messages: [...] } sẽ tự động được gộp vào mảng messages chung.
const AgentState = MessagesAnnotation;

// Hàm hỗ trợ format log cho gọn mắt, dễ quan sát luồng chạy.
function formatToolResult(text, maxLength = 500) {
  const str = String(text);
  const truncated =
    str.length > maxLength ? `${str.slice(0, maxLength)}...` : str;
  return truncated
    .split("\n")
    .map((line) => `       ${line}`)
    .join("\n");
}

class Agent {
  constructor(model, tools, system = "") {
    this.system = system;
    this.tools = Object.fromEntries(tools.map((t) => [t.name, t]));
    // bindTools(): cho Model biết có những Tool nào để gọi khi cần.
    this.model = model.bindTools(tools);

    // Dựng Graph dựa trên cấu trúc bộ nhớ AgentState
    // Graph có 2 Node: "llm" (gọi model) và "action" (chạy tool).
    // Luồng chạy như sau:
    //   - Bắt đầu ở Node "llm".
    //   - Nếu model trả về tool_calls -> tới Node "action" để chạy tool.
    //   - Nếu model không có tool_calls -> dừng lại.
    //   - Sau khi Node "action" chạy tool xong, luôn quay lại Node "llm" để lặp tiếp.
    const graph = new StateGraph(AgentState);

    // 1. Đăng ký các Node -> chưa chạy ngay, LangGraph sẽ tự truyền `state` vào làm tham số khi chạy .invoke().
    //    .bind(this): nếu không bind, khi LangGraph tự gọi lại hàm sau này, `this` bên
    //    trong sẽ bị undefined (mất kết nối với instance Agent) -> lỗi khi dùng this.model.
    graph.addNode("llm", this.callModel.bind(this));
    graph.addNode("action", this.takeAction.bind(this));

    // addEdge(from, to): nối thẳng, không điều kiện, từ Node "from" sang Node "to".
    // Bước 2 và 4 đều dùng addEdge, nhưng khác nhau ở "from":
    //   - "__start__" (bước 2): node đặc biệt, chỉ có lúc graph vừa khởi động - dòng này
    //     chạy ĐÚNG 1 LẦN mỗi khi gọi .invoke().
    //   - "action" (bước 4): 1 Node thật - dòng này chạy LẶP LẠI mỗi khi Node "action" vừa
    //     chạy xong (nhiều lần nếu model gọi tool nhiều vòng).

    // 2. ĐIỂM BẮT ĐẦU: Khi bắt đầu chạy (.invoke()), Graph luôn vào Node "llm" đầu tiên.
    graph.addEdge("__start__", "llm");

    // 3. RẼ NHÁNH DỰA TRÊN ĐIỀU KIỆN: Chạy xong "llm", gọi hàm existsAction(state) kiểm tra model có yêu cầu gọi Tool không:
    //    - Trả về "true"  -> Chuyển sang Node "action" để chạy Tool.
    //    - Trả về "false" -> Đi tới END -> kết thúc Graph và trả về kết quả cuối cùng.
    // Key "true"/"false" ở đây thực chất là STRING (key object JS luôn tự ép thành string,
    // dù viết có ngoặc kép hay không) - khớp với string mà existsAction() trả về.
    graph.addConditionalEdges("llm", this.existsAction.bind(this), {
      true: "action",
      false: END,
    });

    // 4. VÒNG LẶP: Chạy Tool xong ở Node "action", luôn quay về Node "llm" để Model đọc kết quả Tool.
    graph.addEdge("action", "llm");

    // Biên dịch sơ đồ thành đối tượng Graph hoàn chỉnh có thể gọi .invoke()
    this.graph = graph.compile();
  }

  // Hàm quyết định rẽ nhánh: Kiểm tra tin nhắn MỚI NHẤT từ Model xem có yêu cầu gọi Tool không.
  // Hàm này do LangGraph tự gọi và truyền `state` hiện tại vào.
  existsAction(state) {
    const lastMessage = state.messages[state.messages.length - 1];
    const hasToolCalls = Boolean(lastMessage.tool_calls?.length);

    console.log(
      hasToolCalls
        ? `[Rẽ nhánh]       Model yêu cầu dùng Tool -> Sang Node "action"`
        : `[Rẽ nhánh]       Model không dùng Tool -> DỪNG (Hoàn tất)`,
    );

    return hasToolCalls ? "true" : "false";
  }

  // NODE "llm":
  //   - Nhận `state` từ LangGraph.
  //   - Đọc lịch sử messages.
  //   - Gọi Model trả lời.
  async callModel(state) {
    console.log(
      `\n[Node "llm"]     Đang gửi ${state.messages.length} message cho Model...`,
    );

    let messages = state.messages;
    if (this.system) {
      messages = [new SystemMessage(this.system), ...messages];
    }
    const message = await this.model.invoke(messages);

    if (message.tool_calls?.length) {
      const names = message.tool_calls.map((c) => c.name).join(", ");
      console.log(`[Node "llm"]     -> Model quyết định gọi Tool: "${names}"`);
    } else {
      console.log(
        `[Node "llm"]     -> Model quyết định trả lời trực tiếp (không dùng Tool)`,
      );
    }

    // Trả về message mới -> LangGraph sẽ tự nối thêm vào `state.messages`
    return { messages: [message] };
  }

  // NODE "action":
  //   - Nhận `state` từ LangGraph.
  //   - Lấy danh sách tool_calls ở tin nhắn cuối.
  //   - Chạy từng Tool.
  async takeAction(state) {
    const toolCalls = state.messages[state.messages.length - 1].tool_calls;
    console.log(
      `\n[Node "action"]  Model yêu cầu ${toolCalls.length} Tool, đang thực thi...`,
    );
    const results = [];

    for (const call of toolCalls) {
      console.log(`  -> Đang gọi: ${call.name}(${JSON.stringify(call.args)})`);

      // Xử lý an toàn: Nếu Model đoán sai tên Tool không có sẵn
      if (!this.tools[call.name]) {
        console.log(
          `  -> LỖI: Tool "${call.name}" không tồn tại trong hệ thống`,
        );
        results.push(
          new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            content: "bad tool name, retry",
          }),
        );
        continue;
      }

      // Chạy Tool hợp lệ -> Trả về ToolMessage chứa kết quả
      const toolMessage = await this.tools[call.name].invoke(call);
      console.log(`  -> Tool "${call.name}" trả về:`);
      console.log(formatToolResult(toolMessage.content));
      results.push(toolMessage);
    }

    console.log(
      `[Node "action"]  Hoàn thành -> Quay lại Node "llm" để Model đọc kết quả`,
    );

    // Trả về mảng các ToolMessage -> LangGraph sẽ tự nối thêm vào `state.messages`
    return { messages: results };
  }
}

module.exports = { Agent, AgentState };
