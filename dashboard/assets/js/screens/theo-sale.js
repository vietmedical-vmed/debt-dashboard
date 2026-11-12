// Theo sale: bảng theo từng sale. Kèm tab "Tổng hợp A1–A4" (mọi role, theo quyền): nhóm nợ × BU/team.
(function () {
  const { useState } = React;
  const h = React.createElement;
  const UI = window.DEBT_UI;
  const D = window.DEBT_DATA;
  const R = window.DEBT_ROUTER;
  const { T, fmtTr, fmtPct, fmtKyLabel } = UI;

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
    return [...m.values()].filter((s) => s.tong || s.qhP || s.need).sort((a, b) => b.qh - a.qh || b.tong - a.tong);
  }

  // ── Bảng tổng hợp: nhóm nợ (A4→A1) × khách hàng, cột theo BU → team (dm_ps), cột cuối = đã giải trình chưa ──
  const BU_FALLBACK = { chcs: "CH&CS", cttm: "CTTM & CTUT", thnk: "THNS & CSVT" };
  const NO_TEAM = "(chưa có trong dm_ps)";
  const SEP = "\u0001";

  // Nhóm hiển thị trong bảng tổng hợp: A4 → A1. Chỉ A2–A4 bắt buộc giải trình.
  const PIVOT_NHOM = ["A4", "A3", "A2", "A1"];

  function buildPivot(data, f) {
    const ky = data.meta.ky;
    const dir = new Map((data.ps_dir || []).map((d) => [d.ten_nv, d]));
    const colOf = (r) => {
      const d = dir.get(r.ten_nv);
      if (d && d.team) return { bu: d.bu || BU_FALLBACK[d.bu_code] || d.bu_code || "Khác", team: d.team };
      return { bu: BU_FALLBACK[r.bu] || "Khác", team: NO_TEAM };
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
      const sub = {}; let tong = 0;
      for (const x of items) { for (const [k, v] of Object.entries(x.cells)) sub[k] = (sub[k] || 0) + v; tong += x.tong; }
      const needItems = items.filter((x) => x.gt.need);
      return { nhom: n, items, sub, tong, need: needItems.length, done: needItems.filter((x) => x.gt.done === x.gt.total).length };
    });
    const grand = {}; let grandTong = 0;
    for (const g of groupsOut) { for (const [k, v] of Object.entries(g.sub)) grand[k] = (grand[k] || 0) + v; grandTong += g.tong; }
    return { cols: colList, bus, groups: groupsOut, grand, grandTong, khMap };
  }

  // Ô "Giải trình": chỉ tính các cặp KH × ngành có nợ A2–A4; KH chỉ có A1 → "Không bắt buộc".
  // Nhóm A1: KH còn A2–A4 cùng BU → "Giải trình ở nhóm A2–A4" (chỉ tham chiếu).
  const REF_TEXT = "Giải trình ở nhóm A2–A4";
  const gtText = (gt) => (gt.ref ? (gt.refNeed ? REF_TEXT : "Không bắt buộc") : !gt.need ? "Không bắt buộc"
    : (gt.done === gt.total ? "Đã giải trình" : gt.done ? gt.done + "/" + gt.total + " phần" : "Chưa giải trình")
      + (gt.list.some((x) => x.cap_nhat) ? " · cần cập nhật" : ""));
  const groupText = (g) => (g.need ? g.done + "/" + g.need + " KH đã GT" : "Không bắt buộc");

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

  function Pivot({ data, f, patchGt, kyMeta }) {
    const [closed, setClosed] = useState({});
    const [openKey, setOpenKey] = useState(null);
    const pv = buildPivot(data, f);
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
            : h("span", { className: "text-red-600" }, "Chưa giải trình"));
      }));
    };
    const ThangCell = ({ x }) => !x.gt.items.length ? h("span", { className: "text-slate-300" }, "—")
      : h("div", { className: "flex flex-col gap-1.5" }, x.gt.items.map(({ k, label: lb }) => h("div", { key: k.key, className: "whitespace-nowrap" },
          lb && h("span", { className: "mr-1 text-slate-400" }, lb + ":"),
          k.gt && k.trang_thai !== "chua" && k.gt.thang_du_kien ? k.gt.thang_du_kien : h("span", { className: "text-slate-300" }, "—"))));
    if (!pv.groups.length) return null;
    const v = (n) => (n ? fmtTr(n, 1) : "");
    const GtCell = ({ gt }) => {
      if (gt.ref) return gt.refNeed ? h("span", { className: "text-slate-400" }, REF_TEXT) : h("span", { className: "text-slate-400" }, "—");
      if (!gt.need) return h("span", { className: "text-slate-400" }, "—");
      const title = gt.list.map((x) => x.nganh + ": " + D.TRANG_THAI[x.st].label + (x.cap_nhat ? " (cần cập nhật)" : "")).join("\n");
      const ok = gt.done === gt.total;
      const warn = gt.list.some((x) => x.cap_nhat);
      return h("span", { title, className: "font-semibold " + (warn ? "text-amber-700" : ok ? "text-green-700" : "text-red-600") }, (ok ? "✓ " : gt.done ? "" : "✗ ") + gtText(gt));
    };
    const border = (i) => (i === 0 || pv.cols[i - 1].bu !== pv.cols[i].bu ? " border-l border-slate-200" : "");
    const openKh = (x) => R.navigate("/giai-trinh", { ky: data.meta.ky, q: x.ten_kh });
    const extraHead = (label, cls) => h("th", { className: T.th() + " border-l border-slate-200 bg-slate-50 " + (cls || ""), rowSpan: 2 }, label);
    return h(UI.Panel, {
      title: "Tổng hợp nợ quá hạn (A1–A4) theo team · " + fmtKyLabel(data.meta.ky),
      subtitle: "Triệu đồng · cột theo BU → team của sale trong dm_ps · chỉ A2–A4 bắt buộc giải trình (theo KH × BU) · bấm tên KH để mở giải trình · bấm dòng nhóm để thu gọn",
      right: h("button", { type: "button", onClick: () => exportPivot(pv, data.meta.ky), className: UI.btn.secondary }, h(UI.I.Download, { size: 14 }), "Xuất Excel"),
    },
      h("div", { className: "scroll-shadow max-h-[680px] overflow-auto" }, h("table", { className: T.table },
        h("thead", { className: "sticky top-0 z-10" },
          h("tr", { className: T.headRow },
            h("th", { className: T.th() + " bg-slate-50", rowSpan: 2 }, "Nhóm nợ / Khách hàng"),
            pv.bus.map((b) => h("th", { key: b.bu, colSpan: b.n, className: "border-l border-slate-200 bg-slate-50 px-3 py-1 text-center font-semibold" }, b.bu)),
            h("th", { className: T.th(true) + " border-l border-slate-200 bg-slate-50", rowSpan: 2 }, "Tổng"),
            extraHead("Giải trình"), extraHead("Chi tiết giải trình", "min-w-[280px]"), extraHead("Tháng dự kiến thu")),
          h("tr", { className: T.headRow },
            pv.cols.map((c, i) => h("th", { key: c.key, className: T.th(true) + " bg-slate-50" + border(i) + (c.team === NO_TEAM ? " italic text-slate-400" : "") }, c.team)))),
        h("tbody", null,
          pv.groups.flatMap((g) => {
            const isClosed = closed[g.nhom];
            const head = h("tr", { key: g.nhom, className: "cursor-pointer border-t border-slate-200 bg-blue-50 font-semibold", onClick: () => setClosed((c) => ({ ...c, [g.nhom]: !c[g.nhom] })) },
              h("td", { className: T.td + " whitespace-nowrap" }, (isClosed ? "⊞ " : "⊟ ") + D.NHOM_LABEL[g.nhom]),
              pv.cols.map((c, i) => h("td", { key: c.key, className: T.num + border(i) }, v(g.sub[c.key]))),
              h("td", { className: T.num + " border-l border-slate-200" }, v(g.tong)),
              h("td", { className: T.td + " whitespace-nowrap border-l border-slate-200 text-[12px] text-slate-600" }, groupText(g)),
              h("td", { className: T.td + " border-l border-slate-200" }), h("td", { className: T.td + " border-l border-slate-200" }));
            if (isClosed) return [head];
            return [head, ...g.items.map((x, i) => h("tr", { key: g.nhom + x.ma_kh, className: T.row(i) + " align-top" },
              h("td", { className: T.td + " pl-6" },
                h("button", { type: "button", onClick: () => openKh(x), className: "text-left hover:text-blue-700 hover:underline" }, x.ten_kh)),
              pv.cols.map((c, j) => h("td", { key: c.key, className: T.num + border(j) }, v(x.cells[c.key]))),
              h("td", { className: T.num + " border-l border-slate-200 font-medium" }, v(x.tong)),
              h("td", { className: T.td + " whitespace-nowrap border-l border-slate-200 text-[12px]" }, h(GtCell, { gt: x.gt })),
              h("td", { className: T.td + " border-l border-slate-200 text-[12px] text-slate-700" }, h(DetailCell, { x })),
              h("td", { className: T.td + " border-l border-slate-200 text-[12px]" }, h(ThangCell, { x }))))];
          }),
          h("tr", { className: "border-t-2 border-slate-300 bg-slate-100 font-bold" },
            h("td", { className: T.td }, "Tổng cộng"),
            pv.cols.map((c, i) => h("td", { key: c.key, className: T.num + border(i) }, v(pv.grand[c.key]))),
            h("td", { className: T.num + " border-l border-slate-200" }, v(pv.grandTong)),
            h("td", { className: T.td + " border-l border-slate-200", colSpan: 3 }))))),
      sel && Modal && h(Modal, { k: sel, data, kyMeta, onClose: () => setOpenKey(null), onSaved: patchGt,
        canEdit: canEditKey(sel.key), canApprove: false }));
  }

  function TheoSale() {
    return h(D.KyScreen, null, ({ data, f }) => {
      const rows = build(data, f);
      const tot = rows.reduce((t, s) => {
        for (const k of ["tong", "A1", "qh", "qhP", "thu", "need", "camKet", "camKetThu"]) t[k] = (t[k] || 0) + s[k];
        for (const [st, n] of Object.entries(s.st)) t.st[st] = (t.st[st] || 0) + n;
        return t;
      }, { st: {} });
      const ST_CLS = { chua: "text-red-600", nhap: "text-amber-700", tra_lai: "text-red-600", cho_duyet: "text-blue-700", da_duyet: "text-slate-800", da_gt: "text-slate-800" };
      const stCell = (s, st) => h("td", { key: st, className: T.num + " " + (s.st[st] ? ST_CLS[st] : "text-slate-300") }, s.st[st] || 0);
      const line = (s, i, total) => h("tr", {
        key: s.nv || "tot",
        className: total ? "border-t border-slate-200 bg-slate-50 font-semibold" : T.row(i) + " cursor-pointer",
        onClick: total ? undefined : () => R.navigate("/giai-trinh", { ky: data.meta.ky, nv: s.nv }),
      },
        h("td", { className: T.td + " whitespace-nowrap" }, total ? "Tổng" : s.nv),
        h("td", { className: T.num }, fmtTr(s.tong)),
        h("td", { className: T.num }, fmtTr(s.A1)),
        h("td", { className: T.num + " font-semibold text-red-700" }, fmtTr(s.qh)),
        h("td", { className: T.num + " " + UI.deltaCls(s.qh - s.qhP) }, (s.qh - s.qhP > 0 ? "+" : "") + fmtTr(s.qh - s.qhP)),
        h("td", { className: T.num }, fmtTr(s.thu)),
        h("td", { className: T.num }, s.need),
        ...D.STATUS_LIST.map((st) => stCell(s, st)),
        h("td", { className: T.num }, s.need ? fmtPct((s.st[D.DONE] || 0) / s.need, 0) : "—"),
        h("td", { className: T.num }, s.camKet || "—"),
        h("td", { className: T.num }, s.camKet ? s.camKetThu + " (" + fmtPct(s.camKetThu / s.camKet, 0) + ")" : "—"));
      return h("div", { className: "flex flex-col gap-4" }, h(UI.Panel, {
        title: "Công nợ & giải trình theo sale · " + fmtKyLabel(data.meta.ky),
        subtitle: "Triệu đồng · bấm vào sale để mở danh sách giải trình · Hẹn thu = số KH mà giải trình " + fmtKyLabel(data.meta.ky_truoc) + " dự kiến thu trong hoặc trước " + fmtKyLabel(data.meta.ky) + "; Đã có thu = số KH đó có tiền về trong tháng",
      },
        h("div", { className: "overflow-x-auto" }, h("table", { className: T.table },
          h("thead", null,
            h("tr", { className: T.headRow },
              h("th", { className: T.th(), rowSpan: 2 }, "Sale"),
              h("th", { className: T.th(true) + " border-l border-slate-200", colSpan: 5 }, "Công nợ"),
              h("th", { className: "border-l border-slate-200 px-3 py-1 text-center font-semibold", colSpan: D.STATUS_LIST.length + 2 }, "Giải trình A2–A4 (số KH × BU)"),
              h("th", { className: "border-l border-slate-200 px-3 py-1 text-center font-semibold", colSpan: 2 }, "Hẹn thu kỳ trước (số KH × BU)")),
            h("tr", { className: T.headRow },
              ["Tổng dư nợ", "A1", "A2–A4", "+/- kỳ trước", "Thu trong tháng", "Phải GT", ...D.STATUS_LIST.map((st) => D.TRANG_THAI[st].label), "% xong", "Hẹn thu", "Đã có thu"]
                .map((x, i, arr) => h("th", { key: x, className: T.th(true) + (i === 0 || i === 5 || i === arr.length - 2 ? " border-l border-slate-200" : "") }, x)))),
          h("tbody", null, rows.map((s, i) => line(s, i)), rows.length > 1 && line(tot, 0, true))))));
    });
  }

  R.register("/theo-sale", TheoSale);

  // Mọi role đều vào được; debt-api đã lọc số liệu theo quyền (admin/manager: tất cả; area manager: các cặp KH × ngành
  // có sale mình phụ trách; product_manager: theo ngành; sale: KH của mình). Nút "+ Giải trình" chỉ hiện khi được sửa.
  function TongHop() {
    return h(D.KyScreen, null, ({ data, f, patchGt, kyMeta }) => h(Pivot, { data, f, patchGt, kyMeta }));
  }
  R.register("/tong-hop", TongHop);
})();
