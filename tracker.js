import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

// Cấu hình cơ sở dữ liệu
const dbConfig = localforage.createInstance({ name: 'FitTracker_Config' });
const dbImages = localforage.createInstance({ name: 'FitTracker_Images' });

// Hàm khởi chạy khi load trang
window.addEventListener('DOMContentLoaded', async () => {
    await checkApiKey();
    await checkGoalLock();
    await loadGallery();
});

// --- 1. XỬ LÝ API KEY ---
window.saveKey = async () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key) return alert("Chưa nhập Key!");
    await dbConfig.setItem('gemini_api_key', key);
    alert("Đã lưu Key thành công!");
    document.getElementById('api-key-input').value = ""; // Xóa đi cho bảo mật
    checkApiKey();
};

async function checkApiKey() {
    const key = await dbConfig.getItem('gemini_api_key');
    const input = document.getElementById('api-key-input');
    if (key) input.placeholder = "API Key đã được lưu (An toàn)";
}

// --- 2. XỬ LÝ MỤC TIÊU (PHẦN 1) ---
window.saveGoal = async () => {
    const goal = document.getElementById('user-goal').value;
    if (!goal) return alert("Hãy nhập mục tiêu!");
    
    // Lưu mục tiêu và thời gian sửa
    await dbConfig.setItem('target_goal', goal);
    await dbConfig.setItem('last_goal_edit', Date.now());
    await checkGoalLock();
    alert("Đã lưu mục tiêu. Bạn sẽ không thể sửa trong 3 ngày tới.");
};

async function checkGoalLock() {
    const lastEdit = await dbConfig.getItem('last_goal_edit');
    const savedGoal = await dbConfig.getItem('target_goal');
    const textArea = document.getElementById('user-goal');
    const btn = document.getElementById('btn-save-goal');
    const status = document.getElementById('goal-status');

    if (savedGoal) textArea.value = savedGoal;

    if (lastEdit) {
        const threeDays = 3 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const diff = now - lastEdit;

        if (diff < threeDays) {
            // Khóa
            const hoursLeft = Math.ceil((threeDays - diff) / (1000 * 60 * 60));
            textArea.disabled = true;
            btn.disabled = true;
            btn.innerText = "Đang khóa";
            status.innerText = `🔒 Có thể sửa sau ${hoursLeft} giờ nữa.`;
        } else {
            // Mở khóa
            textArea.disabled = false;
            btn.disabled = false;
            btn.innerText = "Cập nhật Mục tiêu";
            status.innerText = "🔓 Bạn có thể chỉnh sửa mục tiêu ngay bây giờ.";
        }
    }
}

// --- 3. XỬ LÝ ẢNH & CHECK-IN (PHẦN 2) ---
window.handleCheckIn = async () => {
    const fileInput = document.getElementById('daily-photo');
    const status = document.getElementById('process-status');
    
    if (fileInput.files.length === 0) return alert("Vui lòng chọn ảnh trước!");

    try {
        status.innerText = "⏳ Đang xử lý ảnh...";
        const file = fileInput.files;
        const base64Img = await resizeImage(file); // Nén ảnh để lưu trữ nhẹ hơn
        
        // Lưu ảnh với Key là ngày hiện tại (YYYY-MM-DD) để mỗi ngày chỉ 1 ảnh
        const today = new Date().toISOString().split('T');
        await dbImages.setItem(today, {
            date: today,
            timestamp: Date.now(),
            data: base64Img
        });

        await loadGallery(); // Cập nhật hiển thị list ảnh nhỏ
        
        // Kiểm tra số lượng ảnh để quyết định phân tích
        const keys = await dbImages.keys();
        const count = keys.length;
        
        if (count > 0 && count % 3 === 0) {
            status.innerText = `🌟 Đã đủ ${count} ngày! Đang gửi AI phân tích tổng hợp...`;
            await runAIAnalysis(keys);
        } else {
            status.innerText = `✅ Đã lưu ảnh ngày thứ ${count}. Hệ thống sẽ phân tích vào ngày thứ ${Math.ceil(count/3)*3}.`;
        }

    } catch (e) {
        console.error(e);
        status.innerText = "❌ Lỗi: " + e.message;
    }
};

// Hàm nén ảnh (Giảm dung lượng để gửi API nhanh hơn)
function resizeImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                // Giới hạn chiều rộng 800px
                const scale = 800 / img.width; 
                canvas.width = 800;
                canvas.height = img.height * scale;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                // Xuất ra base64 (jpeg quality 0.7)
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function loadGallery() {
    const container = document.getElementById('gallery-preview');
    container.innerHTML = '';
    const keys = await dbImages.keys();
    // Sắp xếp hiển thị ảnh mới nhất trước
    keys.sort().reverse();
    
    for (const key of keys) {
        const item = await dbImages.getItem(key);
        const img = document.createElement('img');
        img.src = item.data;
        img.className = 'gallery-img';
        img.title = key;
        container.appendChild(img);
    }
}

// --- 4. TRÍ TUỆ NHÂN TẠO (GEMINI) ---
async function runAIAnalysis(allKeys) {
    const apiKey = await dbConfig.getItem('gemini_api_key');
    if (!apiKey) return alert("Thiếu API Key! Hãy nhập ở phần Cài đặt.");
    
    const goal = await dbConfig.getItem('target_goal') |

| "Cải thiện vóc dáng chung";
    const status = document.getElementById('process-status');
    const resultBox = document.getElementById('ai-result-area');
    const resultContent = document.getElementById('ai-content');

    // Sắp xếp ngày từ cũ đến mới (Day 1 -> Day N)
    allKeys.sort();

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

        // Tạo nội dung gửi đi (Prompt + Ảnh)
        let promptPayload =;
        
        promptPayload.push(`
            Đóng vai Huấn luyện viên thể hình chuyên nghiệp.
            Đây là chuỗi ảnh quá trình của tôi từ ngày đầu tiên đến hiện tại (${allKeys.length} ngày).
            Mục tiêu của tôi: "${goal}".
            
            Hãy phân tích sự thay đổi qua từng giai đoạn. So sánh ảnh mới nhất với các ảnh cũ.
            Đưa ra nhận xét chi tiết về cơ bắp, mỡ thừa, tư thế.
            Cuối cùng, hãy đưa ra lời khuyên cụ thể cho 3 ngày tiếp theo để đạt mục tiêu nhanh hơn.
            Định dạng trả về Markdown, ngắn gọn, súc tích, chuyên nghiệp.
        `);

        // Nhồi toàn bộ ảnh vào
        for (const key of allKeys) {
            const item = await dbImages.getItem(key);
            // Cắt bỏ phần header base64 để lấy data thuần
            const base64Data = item.data.split(',')[1];
            
            promptPayload.push(`--- Ảnh ngày ${key} ---`);
            promptPayload.push({
                inlineData: {
                    data: base64Data,
                    mimeType: "image/jpeg"
                }
            });
        }

        const result = await model.generateContent(promptPayload);
        const responseText = result.response.text();

        // Hiển thị kết quả
        resultBox.classList.remove('hidden');
        resultContent.innerHTML = marked.parse(responseText);
        status.innerText = "✅ Phân tích hoàn tất!";
        
        // Mở khóa mục tiêu sau khi phân tích xong (Logic tùy chọn, ở đây giữ nguyên logic khóa theo thời gian)

    } catch (error) {
        console.error(error);
        status.innerText = "❌ Lỗi AI: " + error.message;
    }
}
