// Theo sale: bảng theo từng sale. Kèm tab "Tổng hợp A1–A4" (mọi role, theo quyền): nhóm nợ × BU/team.
(function () {
  const { useState } = React;
  const h = React.createElement;
  const UI = window.DEBT_UI;
  const D = window.DEBT_DATA;
  const R = window.DEBT_ROUTER;
  const { T, fmtTr, fmtPct, fmtKyLabel } = UI;

  // ── Dùng chung 2 bảng ──
  // Nền dòng đặc (không trong suốt) để cột cố định bên trái không lộ chữ của cột cuộn bên dưới.
  const ROW_BG = (i) => (i % 2 ? "bg-[#f7f8fa]" : "bg-white");
  const ROW_HOVER = "group-hover:bg-[#eef5ff]";
  const STICKY_L = "sticky left-0 z-[1] shadow-[inset_-1px_0_0_#dadde1]";
  const BL = " border-l border-slate-200";
  // Chiều cao bảng theo màn hình: hàng tiêu đề và dòng tổng cố định, chỉ thân bảng cuộn.
  const SCROLL_STYLE = { maxHeight: "max(420px, calc(100vh - 340px))" };
  const store = {
    get: (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* bỏ qua */ } },
  };

  // Thanh tiến độ giải trình: < 50% đỏ, 50–99% vàng, 100% xanh.
  const pctBar = (p) => (p >= 1 ? "bg-green-600" : p >= 0.5 ? "bg-amber-400" : "bg-red-500");
  const pctTxt = (p) => (p >= 1 ? "text-green-700" : p >= 0.5 ? "text-amber-700" : "text-red-600");
  const Progress = ({ done, total, width = "w-14", text }) => {
    const p = total ? done / total : 0;
    return h("span", { className: "inline-flex items-center justify-end gap-2 whitespace-nowrap", title: done + "/" + total },
      h("span", { className: "h-1.5 overflow-hidden rounded-full bg-slate-200 " + width },
        h("span", { className: "block h-full rounded-full " + pctBar(p), style: { width: Math.min(100, p * 100) + "%" } })),
      h("span", { className: "tabular-nums font-medium " + pctTxt(p) }, text != null ? text : fmtPct(p, 0)));
  };

  // Số tiền: theo dòng công nợ của chính sale. Tiến độ giải trình: mỗi cặp KH × ngành tính cho mọi sale trong cặp.
  function build(data, f) {
    const ky = data.meta.ky, kt = data.meta.ky_truoc;
    const m = new Map();
    const get = (nv) => {
      if (!m.has(nv)) m.set(nv, { nv, tong: 0, A1: 0, qh: 0, qhP: 0, thu: 0, need: 0, st: {}, camKet: 0, camKetThu: 0 });
      return m.get(nv);
    };
    for (const r of D.applyFilter(data.agg, f)) {
      const s = get(r.ten_nv);
      if (r.ky === ky) {
        s.tong += r.con_no;
        if (r.nhom_no === "A1") s.A1 += r.con_no;
        if (D.NHOM_GT.includes(r.nhom_no)) s.qh += r.con_no;
      } else if (r.ky === kt && D.NHOM_GT.includes(r.nhom_no)) s.qhP += r.con_no;
    }
    for (const t of D.applyFilter(data.thu_tien, f)) if (m.has(t.ten_nv)) get(t.ten_nv).thu += t.so_tien;
    for (const k of D.buildKhach(data, f)) {
      for (const nv of k.nv) {
        const s = get(nv);
        if (k.can_gt) { s.need++; s.st[k.trang_thai] = (s.st[k.trang_thai] || 0) + 1; }
        // Giải trình kỳ trước hẹn thu trong/trước kỳ này: đếm cặp KH × ngành, và cặp đã có tiền về trong tháng
        const g = k.gt_prev;
        if (g && g.thang_du_kien && g.thang_du_kien <= ky) { s.camKet++; if (k.thu > 0) s.camKetThu++; }
      }
    }
    return [...m.values()].filter((s) => s.tong || s.qhP || s.need);
  }

  // ── Bảng tổng hợp: nhóm nợ (A4→A1) × khách hàng, cột theo BU → team (dm_ps), cột cuối = đã giải trình chưa ──
  const BU_FALLBACK = { chcs: "CH&CS", cttm: "CTTM & CTUT", thnk: "THNS & CSVT" };
  const NO_TEAM = "(chưa có trong dm_ps)";
  const SEP = "\u0001";

  // Nhóm hiển thị trong bảng tổng hợp: A4 → A1. Chỉ A2–A4 bắt buộc giải trình.
  const PIVOT_NHOM = ["A4", "A3", "A2", "A1"];

  // Cộng dồn 1 nhóm nợ từ các dòng KH (dùng cả khi lọc trên màn hình).
  function summarize(nhom, items) {
    const sub = {}; let tong = 0;
    for (const x of items) { for (const [k, v] of Object.entries(x.cells)) sub[k] = (sub[k] || 0) + v; tong += x.tong; }
    const needItems = items.filter((x) => x.gt.need);
    return { nhom, items, sub, tong, need: needItems.length, done: needItems.filter((x) => x.gt.done === x.gt.total).length };
  }
  function grandOf(groups) {
    const grand = {}; let grandTong = 0;
    for (const g of groups) { for (const [k, v] of Object.entries(g.sub)) grand[k] = (grand[k] || 0) + v; grandTong += g.tong; }
    return { grand, grandTong };
  }

  // mode "team": cột BU → team (mặc định, giống file Excel); "bu": gộp team về BU cho bảng hẹp.
  function buildPivot(data, f, mode = "team") {
    const ky = data.meta.ky;
    const dir = new Map((data.ps_dir || []).map((d) => [d.ten_nv, d]));
    const colOf = (r) => {
      const d = dir.get(r.ten_nv);
      const c = d && d.team ? { bu: d.bu || BU_FALLBACK[d.bu_code] || d.bu_code || "Khác", team: d.team } : { bu: BU_FALLBACK[r.bu] || "Khác", team: NO_TEAM };
      return mode === "bu" ? { bu: c.bu, team: "" } : c;
    };
    const rows = D.applyFilter(data.agg, f).filter((r) => r.ky === ky && PIVOT_NHOM.includes(r.nhom_no));
    const cols = new Map();   // bu|team → {bu, team}
    const groups = new Map(); // nhóm → Map(ma_kh → dòng)
    for (const r of rows) {
      const c = colOf(r), ck = c.bu + SEP + c.team;
      cols.set(ck, c);
      if (!groups.has(r.nhom_no)) groups.set(r.nhom_no, new Map());
      const g = groups.get(r.nhom_no);
      const x = g.get(r.ma_kh) || { ma_kh: r.ma_kh, ten_kh: r.ten_kh, cells: {}, tong: 0, nganh: new Set() };
      x.cells[ck] = (x.cells[ck] || 0) + r.con_no; x.tong += r.con_no; x.nganh.add(r.nganh_hang);
      g.set(r.ma_kh, x);
    }
    const colList = [...cols.entries()].map(([key, c]) => ({ key, ...c }))
      .sort((a, b) => a.bu.localeCompare(b.bu, "vi") || (a.team === NO_TEAM) - (b.team === NO_TEAM) || a.team.localeCompare(b.team, "vi"));
    const bus = [];
    for (const c of colList) { const last = bus[bus.length - 1]; if (last && last.bu === c.bu) last.n++; else bus.push({ bu: c.bu, n: 1 }); }
    // Giải trình theo đơn vị KH × ngành × nhóm giải trình (area manager / sale tự giải trình)
    const khList = D.buildKhach(data, f);
    const khMap = new Map(khList.map((k) => [k.key, k]));
    const byPair = new Map(); // "ma\u0001ngành" → [đơn vị]
    for (const k of khList) {
      const pk = k.ma_kh + SEP + k.nganh_hang;
      if (!byPair.has(pk)) byPair.set(pk, []);
      byPair.get(pk).push(k);
    }
    const status = (ma, nganhSet) => {
      const units = [...nganhSet].flatMap((ng) => byPair.get(ma + SEP + ng) || [])
        .sort((a, b) => String(a.nganh_hang).localeCompare(String(b.nganh_hang), "vi") || String(a.nhom_label).localeCompare(String(b.nhom_label), "vi"));
      const need = units.filter((k) => k.can_gt);
      // Mỗi đơn vị phải giải trình (hoặc đã có giải trình) = 1 dòng trong ô Chi tiết / Tháng
      const items = units.filter((k) => k.can_gt || (k.gt && k.trang_thai !== "chua"));
      const nganhCount = new Set(items.map((k) => k.nganh_hang)).size;
      // Nhãn đầu dòng: tên ngành nếu nhiều ngành; thêm người giải trình nếu 1 ngành có nhiều nhóm
      const label = (k) => {
        const sameNganh = items.filter((u) => u.nganh_hang === k.nganh_hang).length > 1;
        const parts = [];
        if (nganhCount > 1) parts.push(UI.buName(k.nganh_hang));
        if (sameNganh) parts.push(k.nhom_label || "—");
        return parts.join(" · ");
      };
      const withGt = items.filter((k) => k.gt && k.trang_thai !== "chua");
      const pre = (k) => (label(k) ? label(k) + ": " : "");
      return {
        items: items.map((k) => ({ k, label: label(k) })),
        need: need.length,
        done: need.filter((k) => k.trang_thai === D.DONE).length,
        total: need.length,
        list: need.map((k) => ({ nganh: [UI.buName(k.nganh_hang), k.nhom_label].filter(Boolean).join(" · "), st: k.trang_thai, cap_nhat: !!k.can_cap_nhat })),
        chi_tiet: withGt.map((k) => pre(k) + (k.gt.ke_hoach || "")).join("\n"),
        thang: withGt.map((k) => pre(k) + (k.gt.thang_du_kien || "")).join("\n"),
      };
    };
    const groupsOut = PIVOT_NHOM.filter((n) => groups.has(n)).map((n) => {
      // A1 không bắt buộc giải trình: dòng A1 chỉ tham chiếu giải trình đã có (đơn vị giải trình nằm ở nhóm A2–A4), không đếm, không nút.
      const ref = !D.NHOM_GT.includes(n);
      const items = [...groups.get(n).values()].map((x) => {
        const gt = status(x.ma_kh, x.nganh);
        return { ...x, gt: !ref ? gt : { ...gt, ref: true, refNeed: gt.need, need: 0, done: 0, total: 0, items: gt.items.filter(({ k }) => k.gt && k.trang_thai !== "chua") } };
      }).sort((a, b) => b.tong - a.tong);
      return summarize(n, items);
    });
    return { cols: colList, bus, groups: groupsOut, ...grandOf(groupsOut), khMap };
  }

  // Lọc trạng thái trên màn hình (không đổi số liệu gốc / Excel). Dòng A1 chỉ hiện ở "Tất cả".
  const ST_FILTER = [
    { key: "all", label: "Tất cả" },
    { key: "chua", label: "Chưa giải trình" },
    { key: "cap_nhat", label: "Cần cập nhật" },
    { key: "done", label: "Đã giải trình" },
  ];
  const matchSt = (x, st) => st === "all" ? true : (!x.gt.need ? false
    : st === "chua" ? x.gt.done < x.gt.total
    : st === "cap_nhat" ? x.gt.list.some((y) => y.cap_nhat)
    : x.gt.done === x.gt.total);
  function viewOf(pv, q, st) {
    const qq = q.trim() ? UI.deaccent(q.trim()) : "";
    const hitQ = (x) => !qq || UI.deaccent(x.ten_kh || "").includes(qq) || UI.deaccent(x.ma_kh || "").includes(qq);
    const counts = {};
    for (const o of ST_FILTER) counts[o.key] = new Set(pv.groups.flatMap((g) => g.items.filter((x) => hitQ(x) && matchSt(x, o.key)).map((x) => x.ma_kh))).size;
    const groups = pv.groups.map((g) => summarize(g.nhom, g.items.filter((x) => hitQ(x) && matchSt(x, st)))).filter((g) => g.items.length);
    return { groups, ...grandOf(groups), counts, active: !!qq || st !== "all" };
  }

  // Ô "Giải trình": chỉ tính các cặp KH × ngành có nợ A2–A4; KH chỉ có A1 → "Không bắt buộc".
  // Nhóm A1: KH còn A2–A4 cùng BU → "Giải trình ở nhóm A2–A4" (chỉ tham chiếu).
  const REF_TEXT = "Giải trình ở nhóm A2–A4";
  const gtText = (gt) => (gt.ref ? (gt.refNeed ? REF_TEXT : "Không bắt buộc") : !gt.need ? "Không bắt buộc"
    : (gt.done === gt.total ? "Đã giải trình" : gt.done ? gt.done + "/" + gt.total + " phần" : "Chưa giải trình")
      + (gt.list.some((x) => x.cap_nhat) ? " · cần cập nhật" : ""));
  const groupText = (g) => (g.need ? g.done + "/" + g.need + " KH đã GT" : "Không bắt buộc");

  // Excel luôn xuất đủ dữ liệu theo team (không theo ô tìm / lọc trạng thái / chế độ BU trên màn hình).
  function exportPivot(pv, ky) {
    const aoa = [["Nhóm nợ / Khách hàng", ...pv.cols.map((c) => c.bu + " · " + c.team), "Tổng", "Giải trình", "Chi tiết giải trình", "Tháng dự kiến thu"]];
    for (const g of pv.groups) {
      aoa.push([g.nhom, ...pv.cols.map((c) => g.sub[c.key] || null), g.tong, groupText(g), "", ""]);
      for (const x of g.items) aoa.push(["   " + x.ten_kh, ...pv.cols.map((c) => x.cells[c.key] || null), x.tong, gtText(x.gt), x.gt.chi_tiet, x.gt.thang]);
    }
    aoa.push(["Tổng cộng", ...pv.cols.map((c) => pv.grand[c.key] || null), pv.grandTong, "", "", ""]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 55 }, ...pv.cols.map(() => ({ wch: 16 })), { wch: 16 }, { wch: 18 }, { wch: 70 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "A1-A4 " + ky);
    XLSX.writeFile(wb, "Tong_hop_no_A1-A4_" + ky + ".xlsx");
  }

  const MODE_KEY = "debt.tonghop.mode";

  function Pivot({ data, f, patchGt, kyMeta }) {
    // A1 không bắt buộc giải trình → mặc định thu gọn.
    const [closed, setClosed] = useState({ A1: true });
    const [openKey, setOpenKey] = useState(null);
    const [q, setQ] = useState("");
    const [st, setSt] = useState("all");
    const [mode, setModeState] = useState(() => (store.get(MODE_KEY, "team") === "bu" ? "bu" : "team"));
    const setMode = (m) => { setModeState(m); store.set(MODE_KEY, m); };
    const pv = buildPivot(data, f, mode);
    const vw = viewOf(pv, q, st);
    const canEditKey = (key) => data.can_edit_keys == null || (data.can_edit_keys || []).includes(key);
    const locked = !!(kyMeta && kyMeta.khoa);
    const sel = openKey && pv.khMap.get(openKey);
    const Modal = window.DEBT_GT && window.DEBT_GT.KhachModal;
    // Ô Chi tiết giải trình: mỗi ngành 1 dòng; chưa có → nút "Giải trình"
    const DetailCell = ({ x }) => {
      if (!x.gt.items.length) return h("span", { className: "text-slate-300" }, "—");
      return h("div", { className: "flex flex-col gap-1.5" }, x.gt.items.map(({ k, label: lb }) => {
        const has = k.gt && k.trang_thai !== "chua";
        const label = lb && h("span", { className: "mr-1 font-semibold text-slate-500" }, lb + ":");
        if (has) {
          return h("button", { key: k.key, type: "button", onClick: () => setOpenKey(k.key), title: k.gt.ke_hoach,
            className: "max-w-[420px] text-left hover:text-blue-700" },
            h("span", { className: "line-clamp-3 whitespace-pre-wrap" }, label, k.gt.ke_hoach),
            k.can_cap_nhat && h(UI.Badge, { tone: "amber" }, "Cần cập nhật"));
        }
        return h("div", { key: k.key, className: "flex flex-wrap items-center gap-1" }, label,
          canEditKey(k.key) && !locked
            ? h("button", { type: "button", onClick: () => setOpenKey(k.key),
                className: "inline-flex items-center gap-1 rounded border border-blue-300 bg-white px-2 py-0.5 text-[12px] font-semibold text-blue-700 hover:bg-blue-50" },
                "+ Giải trình")
            : h("span", { className: "italic text-slate-400" }, "chưa có"));
      }));
    };
    const ThangCell = ({ x }) => !x.gt.items.length ? h("span", { className: "text-slate-300" }, "—")
      : h("div", { className: "flex flex-col gap-1.5" }, x.gt.items.map(({ k, label: lb }) => h("div", { key: k.key, className: "whitespace-nowrap" },
          lb && h("span", { className: "mr-1 text-slate-400" }, lb + ":"),
          k.gt && k.trang_thai !== "chua" && k.gt.thang_du_kien ? k.gt.thang_du_kien : h("span", { className: "text-slate-300" }, "—"))));
    if (!pv.groups.length) return null;
    const v = (n) => (n ? fmtTr(n, 1) : "");
    const GtCell = ({ gt }) => {
      if (gt.ref) return gt.refNeed ? h("span", { className: "text-slate-400", title: REF_TEXT }, "↑ A2–A4") : h("span", { className: "text-slate-300" }, "—");
      if (!gt.need) return h("span", { className: "text-slate-300" }, "—");
      const title = gt.list.map((x) => x.nganh + ": " + D.TRANG_THAI[x.st].label + (x.cap_nhat ? " (cần cập nhật)" : "")).join("\n");
      const ok = gt.done === gt.total;
      const warn = gt.list.some((x) => x.cap_nhat);
      return h("div", { title, className: "flex flex-col items-start gap-1" },
        h(UI.Badge, { tone: ok ? "green" : gt.done ? "amber" : "red" }, ok ? "Đã giải trình" : gt.done ? gt.done + "/" + gt.total + " phần" : "Chưa giải trình"),
        warn && h(UI.Badge, { tone: "amber" }, "Cần cập nhật"));
    };
    const twoRow = mode === "team";
    const border = (i) => (i === 0 || pv.cols[i - 1].bu !== pv.cols[i].bu ? BL : "");
    const openKh = (x) => R.navigate("/giai-trinh", { ky: data.meta.ky, q: x.ten_kh });
    // Bấm tên KH: 1 đơn vị giải trình → mở popup ngay; nhiều BU / người giải trình → sang tab Giải trình.
    const openName = (x) => (x.gt.items.length === 1 ? setOpenKey(x.gt.items[0].k.key) : openKh(x));
    const extraHead = (label, cls) => h("th", { className: T.th() + BL + " bg-slate-50 " + (cls || ""), rowSpan: twoRow ? 2 : 1 }, label);
    const isClosed = (n) => !vw.active && !!closed[n];
    const allOpen = pv.groups.every((g) => !closed[g.nhom]);
    const toggleAll = () => setClosed(allOpen ? Object.fromEntries(pv.groups.map((g) => [g.nhom, true])) : {});
    const nCols = pv.cols.length + 5;
    return h(UI.Panel, {
      title: "Tổng hợp nợ quá hạn (A1–A4) theo " + (twoRow ? "team" : "BU") + " · " + fmtKyLabel(data.meta.ky),
      subtitle: h(React.Fragment, null, "Triệu đồng · chỉ A2–A4 bắt buộc giải trình (theo KH × BU)",
        h(UI.Hint, { size: 12, text: "Cột theo BU → team của sale trong dm_ps.\nBấm tên KH để mở giải trình (KH nhiều BU / nhiều người giải trình: mở tab Giải trình).\nBấm dòng nhóm nợ để mở / thu gọn.\nNhóm A1 không bắt buộc, chỉ tham chiếu giải trình đã có ở A2–A4.\nXuất Excel luôn đủ dữ liệu theo team, không theo ô tìm / lọc trên màn hình." })),
      right: h("button", { type: "button", onClick: () => exportPivot(mode === "team" ? pv : buildPivot(data, f, "team"), data.meta.ky), className: UI.btn.secondary }, h(UI.I.Download, { size: 14 }), "Xuất Excel"),
    },
      h("div", { className: "flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2" },
        h(UI.SearchInput, { value: q, onChange: setQ, placeholder: "Tìm khách hàng…", className: "w-56" }),
        h(UI.Segmented, { value: st, onChange: setSt,
          options: ST_FILTER.filter((o) => o.key !== "cap_nhat" || vw.counts.cap_nhat || st === "cap_nhat").map((o) => ({ ...o, count: vw.counts[o.key] })) }),
        h("div", { className: "flex-1" }),
        h(UI.Segmented, { value: mode, onChange: setMode, options: [{ key: "team", label: "Theo team" }, { key: "bu", label: "Theo BU" }] }),
        h("button", { type: "button", onClick: toggleAll, disabled: vw.active, className: UI.btn.secondary,
          title: vw.active ? "Đang tìm / lọc: mọi nhóm đều mở" : undefined }, allOpen ? "Thu gọn tất cả" : "Mở tất cả")),
      h("div", { className: "scroll-shadow overflow-auto", style: SCROLL_STYLE }, h("table", { className: T.table },
        h("thead", { className: "sticky top-0 z-10" },
          h("tr", { className: T.headRow },
            h("th", { className: T.th() + " bg-slate-50 " + STICKY_L, rowSpan: twoRow ? 2 : 1 }, "Nhóm nợ / Khách hàng"),
            twoRow
              ? pv.bus.map((b) => h("th", { key: b.bu, colSpan: b.n, className: BL + " bg-slate-50 px-3 py-1 text-center font-semibold" }, b.bu))
              : pv.cols.map((c, i) => h("th", { key: c.key, className: T.th(true) + " bg-slate-50" + border(i) }, c.bu)),
            h("th", { className: T.th(true) + BL + " bg-slate-50", rowSpan: twoRow ? 2 : 1 }, "Tổng"),
            extraHead("Giải trình"), extraHead("Chi tiết giải trình", "min-w-[280px]"), extraHead("Tháng dự kiến thu")),
          twoRow && h("tr", { className: T.headRow },
            pv.cols.map((c, i) => h("th", { key: c.key, className: T.th(true) + " bg-slate-50" + border(i) + (c.team === NO_TEAM ? " italic text-slate-400" : "") }, c.team)))),
        h("tbody", null,
          !vw.groups.length && h("tr", null, h("td", { colSpan: nCols, className: "px-4 py-10 text-center text-slate-400" }, "Không có khách hàng phù hợp")),
          vw.groups.flatMap((g) => {
            const cl = isClosed(g.nhom);
            const head = h("tr", { key: g.nhom, className: "cursor-pointer border-t border-slate-200 bg-blue-50 font-semibold",
              onClick: () => setClosed((c) => ({ ...c, [g.nhom]: !c[g.nhom] })), title: cl ? "Bấm để mở nhóm" : "Bấm để thu gọn nhóm" },
              h("td", { className: T.td + " whitespace-nowrap bg-blue-50 " + STICKY_L },
                h("span", { className: "inline-flex items-center gap-1.5" },
                  h(cl ? UI.I.ChevronRight : UI.I.ChevronDown, { size: 14, className: "text-blue-600" }),
                  D.NHOM_LABEL[g.nhom],
                  h("span", { className: "font-normal text-slate-500" }, "· " + g.items.length + " KH"))),
              pv.cols.map((c, i) => h("td", { key: c.key, className: T.num + border(i) }, v(g.sub[c.key]))),
              h("td", { className: T.num + BL }, v(g.tong)),
              h("td", { className: T.td + " whitespace-nowrap text-[12px] text-slate-600" + BL },
                g.need ? h(Progress, { done: g.done, total: g.need, text: g.done + "/" + g.need + " KH" }) : "Không bắt buộc"),
              h("td", { className: T.td + BL }), h("td", { className: T.td + BL }));
            if (cl) return [head];
            return [head, ...g.items.map((x, i) => h("tr", { key: g.nhom + x.ma_kh, className: "group align-top " + ROW_BG(i) + " " + ROW_HOVER.replace("group-hover:", "hover:") },
              h("td", { className: T.td + " min-w-[220px] max-w-[340px] pl-7 " + STICKY_L + " " + ROW_BG(i) + " " + ROW_HOVER },
                h("div", { className: "flex items-start gap-1.5" },
                  h("button", { type: "button", onClick: () => openName(x), className: "text-left hover:text-blue-700 hover:underline",
                    title: x.gt.items.length === 1 ? "Mở giải trình" : "Mở trong tab Giải trình" }, x.ten_kh),
                  h("a", { href: R.href("/giai-trinh", { ky: data.meta.ky, q: x.ten_kh }), title: "Mở trong tab Giải trình",
                    className: "mt-0.5 shrink-0 text-slate-400 opacity-0 hover:text-blue-600 group-hover:opacity-100" }, h(UI.I.ExternalLink, { size: 12 })))),
              pv.cols.map((c, j) => h("td", { key: c.key, className: T.num + border(j) }, v(x.cells[c.key]))),
              h("td", { className: T.num + BL + " font-medium" }, v(x.tong)),
              h("td", { className: T.td + " whitespace-nowrap text-[12px]" + BL }, h(GtCell, { gt: x.gt })),
              h("td", { className: T.td + " text-[12px] text-slate-700" + BL }, h(DetailCell, { x })),
              h("td", { className: T.td + " text-[12px]" + BL }, h(ThangCell, { x }))))];
          })),
        h("tfoot", { className: "sticky bottom-0 z-10" },
          h("tr", { className: "border-t-2 border-slate-300 bg-slate-100 font-bold shadow-[0_-1px_0_#ccd0d5]" },
            h("td", { className: T.td + " bg-slate-100 " + STICKY_L }, vw.active ? "Tổng (đang lọc)" : "Tổng cộng"),
            pv.cols.map((c, i) => h("td", { key: c.key, className: T.num + border(i) }, v(vw.grand[c.key]))),
            h("td", { className: T.num + BL }, v(vw.grandTong)),
            h("td", { className: T.td + BL, colSpan: 3 }))))),
      sel && Modal && h(Modal, { k: sel, data, kyMeta, onClose: () => setOpenKey(null), onSaved: patchGt,
        canEdit: canEditKey(sel.key), canApprove: false }));
  }

  // ── Bảng theo sale ──
  const ST_CLS = { chua: "text-red-600", nhap: "text-amber-700", tra_lai: "text-red-600", cho_duyet: "text-blue-700", da_duyet: "text-slate-800", da_gt: "text-slate-800" };
  const pctDone = (s) => (s.need ? (s.st[D.DONE] || 0) / s.need : null);
  // Cột sắp xếp được; sep = kẻ dọc trước cột (đầu nhóm cột).
  const SALE_COLS = [
    { key: "tong", label: "Tổng dư nợ", val: (s) => s.tong, sep: true },
    { key: "A1", label: "A1", val: (s) => s.A1 },
    { key: "qh", label: "A2–A4", val: (s) => s.qh },
    { key: "delta", label: "+/- kỳ trước", val: (s) => s.qh - s.qhP },
    { key: "thu", label: "Thu trong tháng", val: (s) => s.thu },
    { key: "need", label: "Phải GT", val: (s) => s.need, sep: true },
    ...D.STATUS_LIST.map((st) => ({ key: "st_" + st, label: D.TRANG_THAI[st].label, val: (s) => s.st[st] || 0 })),
    { key: "pct", label: "% xong", val: (s) => (pctDone(s) == null ? -1 : pctDone(s)) },
    { key: "camKet", label: "Hẹn thu", val: (s) => s.camKet, sep: true },
    { key: "camKetThu", label: "Đã có thu", val: (s) => s.camKetThu },
  ];

  function SaleTable({ data, f }) {
    const [sort, setSort] = useState({ key: "qh", dir: -1 });
    const [q, setQ] = useState("");
    const [only, setOnly] = useState("all");
    const all = build(data, f);
    const qq = q.trim() ? UI.deaccent(q.trim()) : "";
    const hitQ = (s) => !qq || UI.deaccent(s.nv || "").includes(qq);
    const chua = (s) => (s.st.chua || 0) > 0;
    const rows = all.filter((s) => hitQ(s) && (only === "all" || chua(s)));
    const col = SALE_COLS.find((c) => c.key === sort.key);
    rows.sort(sort.key === "nv"
      ? (a, b) => sort.dir * String(a.nv).localeCompare(String(b.nv), "vi")
      : (a, b) => sort.dir * (col.val(a) - col.val(b)) || b.qh - a.qh || b.tong - a.tong);
    const tot = rows.reduce((t, s) => {
      for (const k of ["tong", "A1", "qh", "qhP", "thu", "need", "camKet", "camKetThu"]) t[k] = (t[k] || 0) + s[k];
      for (const [st, n] of Object.entries(s.st)) t.st[st] = (t.st[st] || 0) + n;
      return t;
    }, { st: {} });
    const maxQh = Math.max(1, ...rows.map((s) => s.qh));
    const ky = data.meta.ky, kt = data.meta.ky_truoc;
    const onSort = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === "nv" ? 1 : -1 }));
    const sortTh = ({ c, sticky, rowSpan, className = "" }) => {
      const on = sort.key === c.key;
      const Ico = !on ? UI.I.ArrowUpDown : sort.dir > 0 ? UI.I.ChevronUp : UI.I.ChevronDown;
      return h("th", { key: c.key, rowSpan, className: T.th(true) + " bg-slate-50 " + className + (c.sep ? BL : "") + (sticky ? " " + STICKY_L : ""), "aria-sort": on ? (sort.dir > 0 ? "ascending" : "descending") : "none" },
        h("button", { type: "button", onClick: () => onSort(c.key), title: "Sắp xếp theo " + c.label,
          className: "inline-flex items-center gap-1 uppercase tracking-wide hover:text-blue-700 " + (on ? "text-blue-700" : "") },
          c.label, h(Ico, { size: 12, className: on ? "" : "text-slate-300" })));
    };
    const deltaCell = (s) => {
      const d = s.qh - s.qhP;
      if (Math.abs(d) < 0.5e6) return h("span", { className: "text-slate-400" }, "0");
      return h("span", { className: UI.deltaCls(d) }, (d > 0 ? "+" : "") + fmtTr(d),
        s.qhP ? h("span", { className: "ml-1 text-[11px] opacity-80" }, "(" + (d > 0 ? "+" : "") + fmtPct(d / s.qhP, 0) + ")") : null);
    };
    const stCell = (s, st) => h("td", { key: st, className: T.num + " " + (s.st[st] ? ST_CLS[st] : "text-slate-300") }, s.st[st] || 0);
    const cells = (s, total) => [
      h("td", { key: "tong", className: T.num + BL }, fmtTr(s.tong)),
      h("td", { key: "A1", className: T.num }, fmtTr(s.A1)),
      h("td", { key: "qh", className: T.num },
        h("span", { className: "inline-flex items-center justify-end gap-2" },
          !total && h("span", { className: "h-1.5 w-12 overflow-hidden rounded-full bg-slate-200", "aria-hidden": true },
            h("span", { className: "block h-full rounded-full bg-red-400", style: { width: (s.qh / maxQh) * 100 + "%" } })),
          h("span", { className: s.qh > 0.5e6 ? "font-semibold text-red-700" : "text-slate-400" }, fmtTr(s.qh)))),
      h("td", { key: "delta", className: T.num + " whitespace-nowrap" }, deltaCell(s)),
      h("td", { key: "thu", className: T.num }, fmtTr(s.thu)),
      h("td", { key: "need", className: T.num + BL }, s.need),
      ...D.STATUS_LIST.map((st) => stCell(s, st)),
      h("td", { key: "pct", className: T.num }, s.need ? h(Progress, { done: s.st[D.DONE] || 0, total: s.need }) : h("span", { className: "text-slate-300" }, "—")),
      h("td", { key: "camKet", className: T.num + BL }, s.camKet || "—"),
      h("td", { key: "camKetThu", className: T.num }, s.camKet ? s.camKetThu + " (" + fmtPct(s.camKetThu / s.camKet, 0) + ")" : "—"),
    ];
    const nCols = SALE_COLS.length + 1;
    return h(UI.Panel, {
      title: "Công nợ & giải trình theo sale · " + fmtKyLabel(ky),
      subtitle: "Triệu đồng · bấm tiêu đề cột để sắp xếp · bấm vào sale để mở danh sách giải trình",
    },
      h("div", { className: "flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2" },
        h(UI.SearchInput, { value: q, onChange: setQ, placeholder: "Tìm sale…", className: "w-56" }),
        h(UI.Segmented, { value: only, onChange: setOnly, options: [
          { key: "all", label: "Tất cả sale", count: all.filter(hitQ).length },
          { key: "chua", label: "Còn KH chưa giải trình", count: all.filter((s) => hitQ(s) && chua(s)).length },
        ] })),
      h("div", { className: "scroll-shadow overflow-auto", style: SCROLL_STYLE }, h("table", { className: T.table },
        h("thead", { className: "sticky top-0 z-10" },
          h("tr", { className: T.headRow },
            sortTh({ c: { key: "nv", label: "Sale" }, sticky: true, rowSpan: 2, className: "text-left" }),
            h("th", { className: "bg-slate-50 px-3 py-1 text-center font-semibold" + BL, colSpan: 5 }, "Công nợ"),
            h("th", { className: "bg-slate-50 px-3 py-1 text-center font-semibold" + BL, colSpan: D.STATUS_LIST.length + 2 }, "Giải trình A2–A4 (số KH × BU)"),
            h("th", { className: "bg-slate-50 px-3 py-1 text-center font-semibold" + BL, colSpan: 2 }, "Hẹn thu kỳ trước (số KH × BU)",
              h(UI.Hint, { size: 12, text: "Hẹn thu = số KH × BU mà giải trình " + fmtKyLabel(kt) + " dự kiến thu trong hoặc trước " + fmtKyLabel(ky) + ".\nĐã có thu = số KH đó có tiền về trong tháng." }))),
          h("tr", { className: T.headRow },
            SALE_COLS.map((c) => sortTh({ c })))),
        h("tbody", null,
          !rows.length && h("tr", null, h("td", { colSpan: nCols, className: "px-4 py-10 text-center text-slate-400" }, "Không có sale phù hợp")),
          rows.map((s, i) => h("tr", {
            key: s.nv, className: "group cursor-pointer " + ROW_BG(i) + " hover:bg-[#eef5ff]",
            onClick: () => R.navigate("/giai-trinh", { ky, nv: s.nv }), title: "Mở danh sách giải trình của " + s.nv,
          },
            h("td", { className: T.td + " whitespace-nowrap " + STICKY_L + " " + ROW_BG(i) + " " + ROW_HOVER },
              h("span", { className: "inline-flex items-center gap-1 font-medium text-blue-700 group-hover:underline" }, s.nv,
                h(UI.I.ChevronRight, { size: 13, className: "opacity-0 group-hover:opacity-100" }))),
            ...cells(s)))),
        rows.length > 1 && h("tfoot", { className: "sticky bottom-0 z-10" },
          h("tr", { className: "border-t-2 border-slate-300 bg-slate-100 font-semibold shadow-[0_-1px_0_#ccd0d5]" },
            h("td", { className: T.td + " whitespace-nowrap bg-slate-100 " + STICKY_L }, "Tổng (" + rows.length + " sale)"),
            ...cells(tot, true))))));
  }

  function TheoSale() {
    return h(D.KyScreen, null, ({ data, f }) => h(SaleTable, { data, f }));
  }

  R.register("/theo-sale", TheoSale);

  // Mọi role đều vào được; debt-api đã lọc số liệu theo quyền (admin/manager: tất cả; area manager: các cặp KH × ngành
  // có sale mình phụ trách; product_manager: theo ngành; sale: KH của mình). Nút "+ Giải trình" chỉ hiện khi được sửa.
  function TongHop() {
    return h(D.KyScreen, null, ({ data, f, patchGt, kyMeta }) => h(Pivot, { data, f, patchGt, kyMeta }));
  }
  R.register("/tong-hop", TongHop);
})();
