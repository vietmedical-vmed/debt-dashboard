// Bootstrap: kiểm tra token → LoginGate hoặc Shell (header + hàng "Lọc" + tab), cùng bố cục ccdc-management.
(function () {
  const { useState, useEffect, useMemo } = React;
  const h = React.createElement;
  const { LoginGate } = window.DEBT_AUTH;
  const { api, getToken, getUser, clearToken } = window.DEBT_API;
  const R = window.DEBT_ROUTER;
  const { I, ReloadContext, FilterSlotContext } = window.DEBT_UI;
  const DEMO = window.DEBT_CONFIG.DEMO;

  const TABS = [
    { path: "/tong-quan", label: "Tổng quan" },
    { path: "/giai-trinh", label: "Giải trình" },
    { path: "/tong-hop", label: "Tổng hợp A1–A4", roles: ["admin", "manager"] },
    { path: "/theo-sale", label: "Theo sale" },
    { path: "/hang-vay", label: "Hàng vay chưa xuất HĐ" },
    { path: "/quan-tri", label: "Quản trị", admin: true },
  ];
  const KEEP = ["ky", "nganh", "nv", "loai"]; // giữ bộ lọc khi chuyển tab

  const ROLE_BADGE = {
    admin: { label: "Admin", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    manager: { label: "Manager", cls: "bg-blue-50 text-blue-700 border-blue-200" },
    product_manager: { label: "PM", cls: "bg-violet-50 text-violet-700 border-violet-200" },
    area_manager: { label: "AM", cls: "bg-teal-50 text-teal-700 border-teal-200" },
    ps: { label: "Sale", cls: "bg-slate-50 text-slate-600 border-slate-200" },
  };
  const initials = (u) => {
    const parts = String(u.ho_ten || u.username || "CN").trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w));
    if (!parts.length) return "CN";
    return (parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
  };

  function Shell({ user, onLogout }) {
    const path = R.useRoute();
    const query = R.useQuery();
    const Screen = R.get(path);
    const badge = ROLE_BADGE[user.role];
    const [nonce, setNonce] = useState(0);
    const [slotEl, setSlotEl] = useState(null);
    const [filterCount, setFilterCount] = useState(0);
    const slot = useMemo(() => ({ el: slotEl, mount: () => setFilterCount((n) => n + 1), unmount: () => setFilterCount((n) => n - 1) }), [slotEl]);
    const keep = new URLSearchParams();
    for (const k of KEEP) query.getAll(k).forEach((v) => keep.append(k, v));
    const reload = () => { window.DEBT_DATA.invalidate(); setNonce((n) => n + 1); };
    const tabs = TABS.filter((t) => (!t.admin || user.role === "admin") && (!t.roles || t.roles.includes(user.role)));

    return h(ReloadContext.Provider, { value: nonce },
      h(FilterSlotContext.Provider, { value: slot },
        h("div", { className: "min-h-screen" },
          DEMO && h("div", { className: "bg-amber-400 px-4 py-1 text-center text-[12px] font-semibold text-amber-950" },
            "CHẾ ĐỘ DEMO — dữ liệu chỉ lưu trong trình duyệt này, không kết nối máy chủ"),
          h("header", { className: "sticky top-0 z-30 border-b border-slate-200 bg-white" },
            h("div", { className: "flex flex-wrap items-center justify-between gap-4 px-4 py-3 md:px-6" },
              h("div", { className: "flex items-center gap-3" },
                h("div", { className: "grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-500 text-sm font-bold text-white" }, initials(user)),
                h("div", { className: "leading-tight" },
                  h("div", { className: "text-base font-bold text-slate-900 md:text-lg" }, "CÔNG NỢ KHỐI NGOẠI KHOA"),
                  h("div", { className: "mt-0.5 flex items-center gap-2 text-xs text-slate-500" },
                    user.ho_ten || user.username,
                    badge && h("span", { className: "rounded border px-1.5 py-0.5 text-[10px] font-semibold " + badge.cls }, badge.label)))),
              h("div", { className: "flex flex-col items-end gap-2" },
                h("div", { className: "text-right text-[9px] italic text-slate-400" },
                  "Designed and developed by ", h("span", { className: "font-semibold not-italic text-slate-500" }, "Do Hoang Giang")),
                h("div", { className: "flex items-center gap-2" },
                  h("button", { type: "button", onClick: reload, className: "flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700" },
                    h(I.RefreshCw, { size: 14 }), "Reload"),
                  h("button", { type: "button", onClick: onLogout, className: "flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-red-700" },
                    h(I.LogOut, { size: 14 }), "Đăng xuất")))),
            h("div", { className: "flex flex-wrap items-center gap-2.5 border-t border-slate-100 px-4 py-2 md:px-6" + (filterCount > 0 ? "" : " hidden") },
              h("span", { className: "pl-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500" }, "Lọc"),
              h("div", { ref: setSlotEl, className: "contents" })),
            h("nav", { className: "flex items-center gap-1 overflow-x-auto border-t border-slate-100 px-4 md:px-6" },
              tabs.map((t) => h("a", {
                key: t.path, href: R.href(t.path, keep),
                className: "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors " +
                  (t.path === path ? "border-blue-500 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"),
              }, t.label)))),
          h("main", { className: "px-4 py-4 md:px-6" },
            Screen ? h(Screen, { key: path, user }) : h("div", { className: "text-[13px] text-slate-500" }, "Màn hình chưa được xây: ", path)))));
  }

  function App() {
    const [user, setUser] = useState(getUser());
    const [checking, setChecking] = useState(!!getToken());

    useEffect(() => {
      if (!getToken()) { setChecking(false); return; }
      let alive = true;
      api("whoami").then((res) => {
        if (!alive) return;
        if (res && res.user) {
          const u = { username: res.user.username, ho_ten: res.user.ho_ten || res.user.username, role: String(res.user.role || "").toLowerCase(),
            bu: res.user.bu || "", mien: res.user.mien || "", permission: res.permission || {} };
          window.DEBT_API.setUser(u, !!localStorage.getItem((window.DEBT_CONFIG.DEMO ? "demo." : "") + window.DEBT_CONFIG.TOKEN_STORAGE_KEY));
          setUser(u);
        } else { clearToken(); setUser(null); }
        setChecking(false);
      }).catch(() => { clearToken(); setUser(null); setChecking(false); });
      return () => { alive = false; };
    }, []);

    useEffect(() => { const b = document.getElementById("boot"); if (b) b.style.display = "none"; }, []);

    const onLogout = () => { clearToken(); setUser(null); window.location.hash = ""; };
    if (checking) return h("div", { className: "flex min-h-screen items-center justify-center text-sm text-slate-500" }, "Đang kiểm tra phiên đăng nhập…");
    if (!user) return h(React.Fragment, null,
      DEMO && h("div", { className: "fixed left-0 right-0 top-0 z-50 bg-amber-400 px-4 py-1 text-center text-[12px] font-semibold text-amber-950" },
        "DEMO — đăng nhập: admin / quanly / am_bac / am_nam (area manager giải trình), hoặc tên sale viết liền không dấu (vd nguyenthiduyen, chỉ xem) sau khi admin nạp file. Mật khẩu bất kỳ."),
      h(LoginGate, { onAuth: setUser }));
    return h(Shell, { user, onLogout });
  }

  ReactDOM.createRoot(document.getElementById("root")).render(h(App));
})();
