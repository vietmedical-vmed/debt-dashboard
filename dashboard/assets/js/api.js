// API helper: gọi edge function debt-login / debt-api.
//   - login : POST /functions/v1/debt-login  body = { username, password, [newPassword] }
//   - action: POST /functions/v1/debt-api    body = { action, token, payload }
// Chế độ demo (?demo=1): chuyển sang window.DEBT_MOCK (mock.js), không gọi máy chủ.
(function () {
  const C = window.DEBT_CONFIG;
  const FN_LOGIN = C.SUPABASE_URL + "/functions/v1/" + C.FN_LOGIN_NAME;
  const FN_API   = C.SUPABASE_URL + "/functions/v1/" + C.FN_API_NAME;
  const PREFIX = C.DEMO ? "demo." : "";

  const store = (remember) => (remember ? localStorage : sessionStorage);
  function getToken() {
    return sessionStorage.getItem(PREFIX + C.TOKEN_STORAGE_KEY) || localStorage.getItem(PREFIX + C.TOKEN_STORAGE_KEY) || "";
  }
  function setToken(token, remember) { store(remember).setItem(PREFIX + C.TOKEN_STORAGE_KEY, token); }
  function clearToken() {
    for (const s of [sessionStorage, localStorage]) {
      s.removeItem(PREFIX + C.TOKEN_STORAGE_KEY);
      s.removeItem(PREFIX + C.USER_STORAGE_KEY);
    }
  }
  function getUser() {
    const s = sessionStorage.getItem(PREFIX + C.USER_STORAGE_KEY) || localStorage.getItem(PREFIX + C.USER_STORAGE_KEY);
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  }
  function setUser(user, remember) { store(remember).setItem(PREFIX + C.USER_STORAGE_KEY, JSON.stringify(user)); }

  async function api(action, payload = {}) {
    if (C.DEMO) {
      try { return await window.DEBT_MOCK.call(action, payload, getToken()); }
      catch (e) { if (e.message === "unauthorized") clearToken(); throw e; }
    }
    const isLogin = action === "login";
    let res;
    try {
      res = await fetch(isLogin ? FN_LOGIN : FN_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: C.SUPABASE_ANON_KEY, Authorization: "Bearer " + C.SUPABASE_ANON_KEY },
        body: JSON.stringify(isLogin ? payload : { action, token: getToken(), payload }),
      });
    } catch (e) {
      throw new Error("Không kết nối được máy chủ: " + ((e && e.message) || e));
    }
    let data = null;
    try { data = await res.json(); } catch { /* body rỗng */ }
    if (!res.ok || (data && data.ok === false)) {
      const err = (data && data.error) || "HTTP " + res.status;
      if (err === "unauthorized") clearToken();
      throw new Error(err);
    }
    if (!data) throw new Error("Máy chủ trả về dữ liệu rỗng");
    return data;
  }

  // Dịch mã lỗi từ máy chủ sang tiếng Việt.
  const FIELD = { ke_hoach: "giải trình & kế hoạch xử lý", thang_du_kien: "tháng dự kiến thu (yyyy-mm)", nhan_xet: "nhận xét" };
  function errorText(code) {
    const s = String(code || "");
    if (s.startsWith("thieu_thong_tin:")) return "Thiếu: " + s.split(":")[1].split(",").map((f) => FIELD[f] || f).join(", ");
    return ({
      forbidden: "Bạn không có quyền thực hiện thao tác này",
      unauthorized: "Phiên đăng nhập hết hạn, vui lòng đăng nhập lại",
      ky_da_khoa: "Kỳ báo cáo đã khoá, không sửa được",
      da_gui_khong_sua: "Giải trình đã gửi duyệt hoặc đã duyệt, không sửa được",
      trang_thai_khong_hop_le: "Trạng thái giải trình không cho phép thao tác này",
      not_found: "Không tìm thấy dữ liệu",
      batch_khong_hop_le: "Lần nạp file không hợp lệ hoặc đã kết thúc",
      unknown_action: "Máy chủ chưa cập nhật chức năng này (cần deploy lại debt-api)",
    })[s] || s;
  }

  window.DEBT_API = { api, getToken, setToken, clearToken, getUser, setUser, errorText };
})();
