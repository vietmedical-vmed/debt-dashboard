// LoginGate: khớp design chuẩn org (nền #f0f2f5, form trắng bo góc, icon khóa xanh #1877f2).
// Copy pattern từ sale-target: login + đổi mật khẩu, dịch mã lỗi sang tiếng Việt.
(function () {
  const { useState } = React;
  const h = React.createElement;
  const { api, setToken, setUser } = window.DEBT_API;

  const LockIcon = ({ size = 20 }) => h("svg", {
    xmlns: "http://www.w3.org/2000/svg", width: size, height: size, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
  }, [
    h("path", { key: "a", d: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z" }),
    h("path", { key: "b", d: "M7 11V7a5 5 0 0 1 10 0v4" }),
  ]);
  const AlertCircle = ({ size = 12 }) => h("svg", {
    xmlns: "http://www.w3.org/2000/svg", width: size, height: size, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
  }, [
    h("path", { key: "a", d: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" }),
    h("path", { key: "b", d: "M12 8v4" }),
    h("path", { key: "c", d: "M12 16h.01" }),
  ]);

  const msgOf = (m) => ({
    invalid: "Sai tài khoản hoặc mật khẩu",
    unauthorized: "Phiên hết hạn",
    missing_credentials: "Vui lòng nhập tài khoản và mật khẩu",
    weak_password: "Mật khẩu mới phải từ 6 ký tự trở lên",
    same_password: "Mật khẩu mới phải khác mật khẩu hiện tại",
    same_password_client: "Mật khẩu mới phải khác mật khẩu hiện tại",
    mismatch: "Xác nhận mật khẩu không khớp",
    update_failed: "Không cập nhật được mật khẩu, thử lại sau",
  }[m] || m);

  function LoginGate({ onAuth }) {
    const [mode, setMode] = useState("login"); // 'login' | 'change'
    const [username, setUsername] = useState("");
    const [pw, setPw] = useState("");
    const [newPw, setNewPw] = useState("");
    const [confirmPw, setConfirmPw] = useState("");
    const [remember, setRemember] = useState(true);
    const [error, setError] = useState("");
    const [info, setInfo] = useState("");
    const [busy, setBusy] = useState(false);
    const isChange = mode === "change";

    const switchMode = (m) => { setMode(m); setError(""); setInfo(""); setNewPw(""); setConfirmPw(""); };

    const submit = async (e) => {
      if (e) e.preventDefault();
      setError(""); setInfo("");
      if (isChange) {
        if (!username || !pw || !newPw || !confirmPw) { setError("Vui lòng nhập đầy đủ thông tin"); return; }
        if (newPw !== confirmPw) { setError(msgOf("mismatch")); return; }
        if (newPw.length < 6) { setError(msgOf("weak_password")); return; }
        if (newPw === pw) { setError(msgOf("same_password_client")); return; }
        setBusy(true);
        try {
          await api("login", { username, password: pw, newPassword: newPw });
          setInfo("Đổi mật khẩu thành công. Đăng nhập lại bằng mật khẩu mới.");
          setPw(""); setNewPw(""); setConfirmPw(""); setMode("login");
        } catch (err) { setError(msgOf(err.message)); }
        setBusy(false);
        return;
      }
      if (!username || !pw) { setError("Vui lòng nhập tài khoản và mật khẩu"); return; }
      setBusy(true);
      try {
        const res = await api("login", { username, password: pw });
        if (!res.token) throw new Error("Response thiếu token");
        setToken(res.token, remember);
        const whoami = await api("whoami");
        const u = {
          username: res.username || username,
          ho_ten: res.ho_ten || res.username || username,
          role: String(res.role || "").toLowerCase(),
          scope: res.scope ?? res.mien ?? "",
          bu: res.bu ?? "",
          mien: res.mien ?? "",
          permission: (whoami && whoami.permission) || {},
        };
        setUser(u, remember);
        onAuth(u);
      } catch (err) { setError(msgOf(err.message)); }
      setBusy(false);
    };

    const inputStyle = {
      width: "100%", padding: "8px 12px", border: "1px solid #dadde1", borderRadius: 6,
      fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 10,
    };

    return h("div", {
      style: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#f0f2f5", padding: 16 },
    },
      h("form", {
        onSubmit: submit,
        style: {
          background: "#fff", borderRadius: 8,
          boxShadow: "0 2px 4px rgba(0,0,0,0.1), 0 8px 16px rgba(0,0,0,0.1)",
          border: "1px solid #dadde1", padding: 24, width: "100%", maxWidth: 360,
        },
      },
        h("img", {
          src: "logo.png", alt: "VietMedical",
          style: { height: 48, display: "block", margin: "0 auto 24px" },
        }),
        h("h2", { style: { fontSize: 18, fontWeight: 700, margin: "0 0 20px", textAlign: "center", textTransform: "uppercase" } },
          isChange ? "ĐỔI MẬT KHẨU" : "CÔNG NỢ KHỐI NGOẠI KHOA"),

        h("input", {
          autoFocus: true, value: username, onChange: (e) => setUsername(e.target.value),
          placeholder: "Tài khoản", style: inputStyle,
        }),
        h("input", {
          type: "password", value: pw, onChange: (e) => setPw(e.target.value),
          placeholder: isChange ? "Mật khẩu hiện tại" : "Mật khẩu",
          style: { ...inputStyle, marginBottom: isChange ? 10 : 0 },
        }),
        isChange && h("input", {
          type: "password", value: newPw, onChange: (e) => setNewPw(e.target.value),
          placeholder: "Mật khẩu mới (tối thiểu 6 ký tự)", style: inputStyle,
        }),
        isChange && h("input", {
          type: "password", value: confirmPw, onChange: (e) => setConfirmPw(e.target.value),
          placeholder: "Xác nhận mật khẩu mới", style: { ...inputStyle, marginBottom: 0 },
        }),

        !isChange && h("label", {
          style: { display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12, color: "#65676b", cursor: "pointer" },
        },
          h("input", { type: "checkbox", checked: remember, onChange: (e) => setRemember(e.target.checked) }),
          "Ghi nhớ đăng nhập trên thiết bị này",
        ),

        info && h("div", {
          style: { marginTop: 12, fontSize: 12, color: "#16a34a", display: "flex", alignItems: "center", gap: 6 },
        }, info),
        error && h("div", {
          style: { marginTop: 12, fontSize: 12, color: "#fa383e", display: "flex", alignItems: "center", gap: 6 },
        }, h(AlertCircle, { size: 12 }), " ", error),

        h("button", {
          disabled: busy,
          style: {
            width: "100%", marginTop: 16, background: "#1877f2", color: "#fff",
            padding: "8px 12px", borderRadius: 6, fontSize: 15, fontWeight: 700,
            border: "none", opacity: busy ? 0.7 : 1, cursor: busy ? "not-allowed" : "pointer",
          },
        }, busy ? (isChange ? "Đang đổi…" : "Đang xác thực…") : (isChange ? "Đổi mật khẩu" : "Đăng nhập")),

        h("div", { style: { marginTop: 14, textAlign: "center" } },
          h("button", {
            type: "button", onClick: () => switchMode(isChange ? "login" : "change"),
            style: { background: "none", border: "none", color: "#1877f2", fontSize: 13, cursor: "pointer", padding: 0 },
          }, isChange ? "Quay lại đăng nhập" : "Đổi mật khẩu"),
        ),
      ),
      h("div", { style: { marginTop: 24, textAlign: "center", fontSize: 11, color: "#8a8d91" } },
        "Designed and developed by Do Hoang Giang"),
    );
  }

  window.DEBT_AUTH = { LoginGate };
})();
