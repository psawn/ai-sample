// =======================================================================
// AGENT FROM SCRATCH - DANH SÁCH ACTION (TOOL) CHO VÒNG LẶP ReAct
//
// Mỗi action nhận 1 chuỗi input, trả 1 kết quả (Observation) cho model đọc.
// Dùng chung cho cả bản ReAct (01, 02) và bản Tool Calling (03, 04).
// =======================================================================

// Action "calculate": tính biểu thức số học. Vd: "4 * 7 / 3".
// Lưu ý: eval() chạy được mọi code JS -> chỉ dùng cho bài học.
// Không dùng ở dự án thật, nhất là khi input đến từ người dùng.
function calculate(what) {
  return eval(what);
}

// Action "average_dog_weight": tra cân nặng trung bình theo giống chó (dữ liệu giả lập).
// So khớp kiểu "tên giống chứa input", phân biệt hoa/thường.
// Vd: "Collie" khớp "Border Collie". "border collie" không khớp -> rơi vào mặc định 50 lbs.
function averageDogWeight(name) {
  if ("Scottish Terrier".includes(name)) {
    return "Scottish Terriers average 20 lbs";
  } else if ("Border Collie".includes(name)) {
    return "a Border Collies average weight is 37 lbs";
  } else if ("Toy Poodle".includes(name)) {
    return "a toy poodles average weight is 7 lbs";
  } else {
    return "An average dog weights 50 lbs";
  }
}

// Tra hàm theo tên action.
// Vd: model viết "Action: calculate: 37 + 20" -> knownActions["calculate"]("37 + 20").
const knownActions = {
  calculate,
  average_dog_weight: averageDogWeight,
};

module.exports = { calculate, averageDogWeight, knownActions };
