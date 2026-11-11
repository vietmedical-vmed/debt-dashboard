// UI kit dùng chung, cùng ngôn ngữ thiết kế với bidding-and-contract / sale-target
// (header trắng, hàng "Lọc" dạng pill, Panel có dải tiêu đề, bảng 13px, badge viền).
(function () {
  const { useState, useEffect, useRef, useContext, createContext } = React;
  const h = React.createElement;

  // ─── Định dạng ───────────────────────────────────────────
  const fmtInt = (n) => (n == null || n === "") ? "—" : Number(n).toLocaleString("vi-VN");
  const fmtTien = (n) => {
    if (n == null) return "—";
    const v = Number(n);
    if (v === 0) return "0";
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2).replace(/\.?0+$/, "") + " tỷ";
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + " tr";
    return Math.round(v).toLocaleString("vi-VN");
  };
  const fmtKy = (d) => { if (!d) return "—"; const [y, m] = String(d).split("-"); return "T" + Number(m) + "/" + y; };
  const fmtDate = (d) => !d ? "—" : String(d).slice(0, 10).split("-").reverse().join("/");
  const deaccent = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
  const fyOf = (d = new Date()) => (d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1);
  const fyLabel = (y) => "FY" + String(y).slice(-2);

  // ─── Icon (lucide, giống sale-target) ────────────────────
  const icon = (paths) => function Icon({ size = 16, className = "" }) {
    return h("svg", {
      xmlns: "http://www.w3.org/2000/svg", width: size, height: size, viewBox: "0 0 24 24", fill: "none",
      stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", className, "aria-hidden": true,
    }, paths.map((d) => h("path", { key: d, d })));
  };
  const I = {
    Search: icon(["m21 21-4.34-4.34", "M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"]),
    Check: icon(["M20 6 9 17l-5-5"]),
    Loader2: icon(["M21 12a9 9 0 1 1-6.219-8.56"]),
    AlertCircle: icon(["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 8v4", "M12 16h.01"]),
    AlertTriangle: icon(["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3", "M12 9v4", "M12 17h.01"]),
    ChevronDown: icon(["m6 9 6 6 6-6"]),
    ChevronLeft: icon(["m15 18-6-6 6-6"]),
    ChevronRight: icon(["m9 6 6 6-6 6"]),
    RefreshCw: icon(["M3 12a9 9 0 0 1 15-6.7L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-15 6.7L3 16", "M3 21v-5h5"]),
    LogOut: icon(["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9"]),
    X: icon(["M18 6 6 18", "m6 6 12 12"]),
    Upload: icon(["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m17 8-5-5-5 5", "M12 3v12"]),
    ArrowRight: icon(["M5 12h14", "m12 5 7 7-7 7"]),
    Download: icon(["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"]),
    Send: icon(["m22 2-7 20-4-9-9-4Z", "M22 2 11 13"]),
    Undo: icon(["M3 7v6h6", "M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"]),
    Clock: icon(["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 6v6l4 2"]),
  };

  // Tiền VND → triệu đồng (giống báo cáo kế toán).
  const fmtTr = (v, digits = 0) => (v == null || v === "") ? "—"
    : (Number(v) / 1e6).toLocaleString("vi-VN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const fmtPct = (v, digits = 1) => (v == null || !isFinite(v)) ? "—" : (v * 100).toLocaleString("vi-VN", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + "%";
  const fmtKyLabel = (ky) => { if (!ky) return "—"; const [y, m] = ky.split("-"); return "T" + m + "/" + y; };

  // ─── Context: Reload mềm + ô lọc trên header ──────────────
  const ReloadContext = createContext(0);
  const useReload = () => useContext(ReloadContext);
  const FilterSlotContext = createContext(null);

  // Nội dung hàng "Lọc" của header; màn nào có lọc thì render FilterBar.
  function FilterBar({ children }) {
    const slot = useContext(FilterSlotContext);
    useEffect(() => { if (!slot) return; slot.mount(); return slot.unmount; }, [slot]);
    return slot && slot.el ? ReactDOM.createPortal(children, slot.el) : null;
  }

  // ─── FilterSelect: pill "Nhãn: giá trị ▾", chọn 1 hoặc nhiều ─
  function FilterSelect({ label, options, selected, onChange, multiple = false, searchable = false, allowAll = true, allLabel = "tất cả" }) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const boxRef = useRef(null);
    const opts = options.map((o) => (typeof o === "object" ? o : { value: String(o), label: String(o) }));
    useEffect(() => {
      const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
      document.addEventListener("mousedown", onDoc);
      return () => document.removeEventListener("mousedown", onDoc);
    }, []);
    const shown = searchable && q.trim() ? opts.filter((o) => deaccent(o.label).includes(deaccent(q.trim()))) : opts;
    const labelOf = (v) => (opts.find((o) => o.value === v) || { label: v }).label;
    const summary = selected.length === 0 ? allLabel : selected.length === 1 ? labelOf(selected[0]) : selected.length + " mục";
    const pick = (v) => {
      if (!multiple) { onChange(selected[0] === v && allowAll ? [] : [v]); setOpen(false); return; }
      onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
    };
    return h("div", { ref: boxRef, className: "relative inline-block" },
      h("button", {
        type: "button", onClick: () => setOpen((o) => !o),
        className: "flex max-w-[260px] items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] outline-none hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100",
      },
        h("span", { className: "shrink-0 text-slate-400" }, label + ":"),
        h("span", { className: "truncate " + (selected.length ? "font-medium text-blue-700" : "text-slate-600") }, summary),
        h(I.ChevronDown, { size: 13, className: "shrink-0 text-slate-400" })),
      open && h("div", { className: "absolute left-0 top-full z-50 mt-1 min-w-[220px] max-w-[340px] rounded-md border border-slate-200 bg-white py-1 shadow-lg" },
        searchable && h("div", { className: "px-2 pb-1.5 pt-0.5" },
          h("input", { value: q, onChange: (e) => setQ(e.target.value), autoFocus: true, placeholder: "Tìm…",
            className: "w-full rounded border border-slate-200 px-2 py-1 text-[12px] outline-none focus:border-blue-500" })),
        allowAll && h("div", {
          onClick: () => { onChange([]); if (!multiple) setOpen(false); },
          className: "cursor-pointer border-b border-slate-100 px-3 py-1.5 text-[13px] " +
            (selected.length === 0 ? "font-medium text-blue-700" : "text-slate-500 hover:bg-slate-50"),
        }, "Tất cả (bỏ lọc)"),
        h("div", { className: "scroll-shadow max-h-[260px] overflow-y-auto" },
          shown.length === 0
            ? h("div", { className: "px-3 py-2 text-[12px] text-slate-400" }, "Không có mục")
            : shown.map((o) => {
                const on = selected.includes(o.value);
                return h("div", {
                  key: o.value, onClick: () => pick(o.value),
                  className: "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] " + (on ? "bg-blue-50/60 text-blue-800" : "text-slate-700 hover:bg-slate-50"),
                },
                  h("span", { className: "flex h-3.5 w-3.5 shrink-0 items-center justify-center border " + (multiple ? "rounded " : "rounded-full ") +
                    (on ? "border-blue-500 bg-blue-500 text-white" : "border-slate-300") }, on ? h(I.Check, { size: 11 }) : null),
                  h("span", { className: "truncate" }, o.label));
              })),
      ));
  }

  // ─── Thẻ & khung ─────────────────────────────────────────
  function StatCard({ label, value, sub, swatch, accent, onClick, active }) {
    return h(onClick ? "button" : "div", {
      type: onClick ? "button" : undefined, onClick,
      className: "rounded-xl border bg-white p-3.5 text-left " +
        (active ? "border-blue-400 ring-2 ring-blue-100 " : "border-slate-200 ") +
        (onClick ? "transition-colors hover:border-blue-300 hover:bg-blue-50/30" : ""),
    },
      h("div", { className: "mb-2 flex items-center gap-1.5 text-[11px] tracking-wide text-slate-400" },
        swatch && h("span", { className: "h-2 w-2 rounded-sm " + swatch, "aria-hidden": true }), label),
      h("div", { className: "text-[20px] font-bold tabular-nums " + (accent ? "text-blue-600" : "text-slate-800") }, value),
      sub && h("div", { className: "mt-0.5 text-[11px] text-slate-400" }, sub));
  }

  function Panel({ title, subtitle, right, children, className = "" }) {
    return h("section", { className: "overflow-hidden rounded-lg border border-slate-200 bg-white " + className },
      (title || right) && h("div", { className: "flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5" },
        h("div", null,
          title && h("h3", { className: "text-[13px] font-semibold text-slate-800" }, title),
          subtitle && h("p", { className: "text-[11px] text-slate-400" }, subtitle)),
        right),
      children);
  }

  const BADGE = {
    red: "bg-red-50 text-red-700 border-red-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    grey: "bg-slate-100 text-slate-500 border-slate-200",
    green: "bg-green-50 text-green-700 border-green-200",
  };
  const Badge = ({ tone = "grey", children, title }) =>
    h("span", { title, className: "inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium " + (BADGE[tone] || BADGE.grey) }, children);

  const Swatch = ({ cls }) => h("span", { className: "inline-block h-2.5 w-2.5 rounded-sm " + cls, "aria-hidden": true });
  const Legend = ({ items }) => h("div", { className: "flex flex-wrap gap-3 text-[11px] text-slate-500" },
    items.map((it) => h("span", { key: it.label, className: "flex items-center gap-1" }, h(Swatch, { cls: it.cls }), it.label)));

  // Nút phân đoạn (Kết quả / trạng thái)
  function Segmented({ options, value, onChange }) {
    return h("div", { className: "flex items-center gap-1 rounded-md border border-slate-200 bg-white p-0.5" },
      options.map((o) => {
        const on = o.key === value;
        return h("button", {
          key: o.key, type: "button", onClick: () => onChange(o.key),
          className: "flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1 text-[13px] " + (on ? "bg-blue-500 font-medium text-white" : "text-slate-600 hover:bg-slate-50"),
        }, o.label, o.count != null && h("span", { className: "tabular-nums text-[11px] " + (on ? "text-blue-100" : "text-slate-400") }, fmtInt(o.count)));
      }));
  }

  function SearchInput({ value, onChange, placeholder, className = "w-72" }) {
    return h("div", { className: "relative" },
      h(I.Search, { size: 14, className: "pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" }),
      h("input", {
        type: "search", value, onChange: (e) => onChange(e.target.value), placeholder,
        className: "rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 " + className,
      }));
  }

  function LoadingBlock({ error }) {
    if (error) return h("div", { className: "flex flex-col items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-10 text-[13px] text-red-700" },
      h("span", { className: "flex items-center gap-1.5" }, h(I.AlertCircle, { size: 14 }), " Không tải được dữ liệu: " + error),
      h("span", { className: "text-[12px] text-red-600" }, "Bấm Reload trên header để thử lại."));
    return h("div", { className: "flex flex-col items-center gap-3 py-16 text-[13px] text-slate-500" },
      h("div", { className: "spinner" }), "Đang tải dữ liệu…");
  }
  const RefreshingBar = () => h("div", { className: "flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-[12px] text-blue-700" },
    h(I.Loader2, { size: 12, className: "animate-spin" }), "Đang cập nhật dữ liệu…");
  const ErrorBox = ({ children }) => h("div", { className: "flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700" },
    h(I.AlertCircle, { size: 14 }), children);
  const Empty = ({ children }) => h("div", { className: "rounded-lg border border-slate-200 bg-white px-4 py-12 text-center text-[13px] text-slate-400" }, children);

  function Modal({ open, onClose, title, icon, width = 560, children, busy }) {
    useEffect(() => {
      if (!open) return;
      const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }, [open, onClose, busy]);
    if (!open) return null;
    return ReactDOM.createPortal(h("div", {
      onClick: () => { if (!busy) onClose(); },
      className: "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16",
    },
      h("div", {
        role: "dialog", "aria-modal": "true", "aria-label": title, onClick: (e) => e.stopPropagation(),
        style: { width, maxWidth: "100%" }, className: "rounded-lg border border-slate-200 bg-white shadow-xl",
      },
        h("div", { className: "flex items-center gap-2 border-b border-slate-100 px-4 py-3" },
          icon, h("span", { className: "text-[14px] font-semibold text-slate-800" }, title),
          h("div", { className: "flex-1" }),
          h("button", { type: "button", onClick: onClose, disabled: busy, title: "Đóng",
            className: "rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40" }, h(I.X, { size: 16 }))),
        children)), document.body);
  }

  function Pager({ page, pages, onPage, total, pageSize }) {
    const cls = "grid h-7 w-7 place-items-center rounded-md border border-slate-200 ";
    const btn = (to, label, Icon) => to
      ? h("button", { type: "button", "aria-label": label, onClick: () => onPage(to), className: cls + "text-slate-600 hover:bg-slate-50" }, h(Icon, { size: 14 }))
      : h("span", { "aria-hidden": true, className: cls + "text-slate-300" }, h(Icon, { size: 14 }));
    return h("nav", { className: "flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-2 text-[13px]", "aria-label": "Phân trang" },
      total != null && h("span", { className: "mr-auto text-slate-500" },
        fmtInt((page - 1) * pageSize + 1) + "–" + fmtInt(Math.min(page * pageSize, total)) + " / " + fmtInt(total)),
      h("span", { className: "mr-1 text-slate-500" }, "Trang " + page + " / " + pages),
      btn(page > 1 ? page - 1 : null, "Trang trước", I.ChevronLeft),
      btn(page < pages ? page + 1 : null, "Trang sau", I.ChevronRight));
  }

  // ─── Bảng ────────────────────────────────────────────────
  const T = {
    table: "w-full border-collapse text-[13px]",
    headRow: "bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500",
    th: (right) => "px-3 py-2 font-semibold whitespace-nowrap " + (right ? "text-right" : "text-left"),
    row: (i) => (i % 2 ? "bg-slate-50/50" : "bg-white") + " hover:bg-blue-50/40",
    td: "px-3 py-2",
    num: "px-3 py-2 text-right tabular-nums",
  };
  const btn = {
    primary: "inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50",
    secondary: "inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3.5 py-1.5 text-[13px] text-slate-700 hover:bg-slate-50 disabled:opacity-50",
    link: "text-[13px] text-blue-600 hover:underline",
  };
  const input = "w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
  const fieldLabel = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500";

  window.DEBT_UI = {
    fmtInt, fmtTien, fmtKy, fmtDate, deaccent, fyOf, fyLabel, fmtTr, fmtPct, fmtKyLabel,
    I, ReloadContext, useReload, FilterSlotContext, FilterBar, FilterSelect,
    StatCard, Panel, Badge, Swatch, Legend, Segmented, SearchInput,
    LoadingBlock, RefreshingBar, ErrorBox, Empty, Modal, Pager, T, btn, input, fieldLabel,
  };
})();
