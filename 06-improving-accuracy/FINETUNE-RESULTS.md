# Kết quả fine-tune lần 1 (02/11/2026)

## Cấu hình

| | Trước fine-tune | Sau fine-tune |
|---|---|---|
| Model viết SQL | `qwen3:latest` | `qwen3-nba-sql:latest` |
| Giám khảo | `qwen3:latest` | `qwen3:latest` (giữ nguyên để so sánh công bằng) |
| Kết quả lưu ở | `data/results1/` | `data/results/` (lần chạy `04` sau sẽ ghi đè) |

Train: `unsloth/Qwen3-8B`, 43 mẫu, 3 epoch, `LORA_RANK = 8`, `LEARNING_RATE = 2e-4`, xuất GGUF `Q4_K_M` (~5GB).
Bộ đề: 10 câu trong `gold-test-set.jsonl`. Không câu nào nằm y nguyên trong data train.

## Điểm

| | Trước | Sau |
|---|---|---|
| SQL chạy được | 7/10 | 8/10 |
| SQL đúng | 5/10 | 8/10 |

Bỏ 2 câu "đúng nhờ may" và "giám khảo dễ dãi" (xem bảng dưới) thì cải thiện thật chỉ khoảng **5 → 6**.

## Từng câu

| Câu hỏi | Trước | Sau | Ghi chú |
|---|---|---|---|
| How many players are on the Toronto Raptors? | ✅ | ✅ | |
| What is the average age of NBA players? | ✅ | ✅ | |
| Which team has the most players? | ✅ | ✅ | |
| Who is the oldest player? | ✅ | ✅ | |
| How many players did not go to college? | ✅ | ✅ | |
| What is the total salary of the Golden State Warriors? | ❌ | ✅ | **Sửa được thật.** Học đúng cách bỏ `$` và `,` từ câu "Lakers" trong data train |
| Who is the tallest player? | ❌ | ✅ | **Đúng nhờ may.** `ORDER BY ht DESC` sắp xếp chiều cao như chữ, không như số; tình cờ `7' 4"` đứng đầu |
| Which players are point guards? | ❌ | ✅ | **Giám khảo không nhất quán.** Cả 2 lần đều trả thêm cột thừa: lần trước chấm sai, lần này chấm đúng |
| What is the median weight in the NBA? | ❌ | ❌ | Lần trước giám khảo chấm nhầm (cùng ra `225`, chỉ khác tên cột). Lần này SQL lỗi: `CAST(wt AS NUMERIC)` gặp `"185 lbs"` |
| Who is the highest paid NBA player? | ❌ | ❌ | `SUBSTRING(salary FROM 2)`: bỏ được `$` nhưng quên bỏ `,` |

## Vì sao lần sau chạy nhanh hơn

Script không đo giờ, nên đây là suy luận:

- **Chính:** model fine-tune viết SQL ngắn hơn (tổng 859 ký tự so với 1305). Máy chạy bằng CPU, thời gian gần như tỉ lệ với số chữ model sinh ra.
- Số lần gọi giám khảo bằng nhau (3 lần mỗi bên), không phải lý do.
- Có thể thêm: model đã nằm sẵn trong RAM, đỡ thời gian nạp ~5GB lúc đầu.

## Vì sao có câu gần giống data train mà vẫn sai

Data train có câu gần giống hệt 2 câu còn sai:

- "highest paid": data có *"second-highest paid"* và *"lowest paid"*, đều dùng đúng `REPLACE(REPLACE(salary, '$', ''), ',', '')`.
- "median weight": data có *"median age"* (cách `OFFSET`) và *"average weight"* (`REPLACE(wt, ' lbs', '')`). Câu này phải ghép 2 cách lại.

Fine-tune không phải lưu đáp án để tra lại. Nó chỉ làm model **nghiêng dần** về các kiểu SQL đã thấy. Lần này nghiêng còn yếu vì:

- Data ít: 43 mẫu, cách xử lý `salary` chỉ xuất hiện vài lần.
- Train nhẹ: 3 epoch, adapter nhỏ (`LORA_RANK = 8`).
- Nén xuống GGUF Q4 làm mất thêm một phần những gì vừa học.

Bằng chứng là model học được một nửa: biết phải xử lý `$` ở `salary`, nhưng chưa bỏ `,`.

## Bài học về giám khảo

- Giám khảo phải giữ nguyên giữa các lần chấm. Đổi cả model viết SQL lẫn giám khảo thì không biết điểm đổi do đâu.
- Giám khảo LLM có thể chấm nhầm (median weight lần 1) và chấm không nhất quán (point guards).
  Bộ đề chỉ 10 câu thì nên đọc từng câu, đừng chỉ nhìn `summary.txt`.

## Hướng cải thiện (rẻ → đắt)

1. Ghi luật thẳng vào schema trong prompt, VD *"salary: phải bỏ `$` và `,` trước khi CAST"*. Không cần train lại.
2. Thêm mẫu về sắp xếp theo lương và tính trung vị cân nặng, rồi train lại.
3. Tăng epoch hoặc `LORA_RANK`. Dễ overfit (học thuộc lòng), chỉ thử sau 2 cách trên.
