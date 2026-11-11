// Theo sale: bảng theo từng sale. Kèm tab "Tổng hợp A2–A4" (admin, manager): nhóm nợ × BU/team.
(function () {
  const { useState } = React;
  const h = React.createElement;
  const UI = window.DEBT_UI;
  const D = window.DEBT_DATA;
  const R = window.DEBT_ROUTER;
  const { T, fmtTr, fmtPct, fmtKyLabel } = UI;

  function build(data, f) {
    const khach = D.buildKhach(data, f);
    const m = new Map();
    for (const k of khach) {
      const s = m.get(k.ten_nv) || { nv: k.ten_nv, tong: 0, A1: 0, qh: 0, qhP: 0, thu: 0, need: 0, st: {}, camKet: 0, camKetThu: 0 };
      s.tong += k.tong; s.A1 += k.A1; s.qh += k.qua_han; s.qhP += k.prev_qua_han; s.thu += k.thu;
      if (k.can_gt) { s.need++; s.st[k.trang_thai] = (s.st[k.trang_thai] || 0) + 1; }
      // Giải trình kỳ trước hẹn thu trong/trước kỳ này: đếm số KH, và số KH đã có tiền về trong tháng
      const g = k.gt_prev;
      if (g && g.thang_du_kien && g.thang_du_kien <= data.meta.ky) {
        s.camKet++;
        if (k.thu > 0) s.camKetThu++;
      }
      m.set(k.ten_nv, s);
    }
    return [...m.values()].sort((a, b) => b.qh - a.qh || b.tong - a.tong);
  }

  // ── Bảng tổng hợp: nhóm nợ (A4→A2) × khách hàng, cột theo BU → team (dm_ps), cột cuối = đã giải trình chưa ──
  const BU_FALLBACK = { chcs: "CH&CS", cttm: "CTTM & CTUT", thnk: "THNS & CSVT" };
  const NO_TEAM = "(chưa có trong dm_ps)";
  const SEP = "\u0001";

  function buildPivot(data, f) {
    const ky = data.meta.ky;
    const dir = new Map((data.ps_dir || []).map((d) => [d.ten_nv, d]));
    const colOf = (r) => {
      const d = dir.get(r.ten_nv);
      if (d && d.team) return { bu: d.bu || BU_FALLBACK[d.bu_code] || d.bu_code || "Khác", team: d.team };
      return { bu: BU_FALLBACK[r.bu] || "Khác", team: NO_TEAM };
    };
    const rows = D.applyFilter(data.agg, f).filter((r) => r.ky === ky && D.NHOM_GT.includes(r.nhom_no));
    const cols = new Map();   // bu|team → {bu, team}
    const groups = new Map(); // nhóm → Map(ma_kh → dòng)
    for (const r of rows) {
      const c = colOf(r), ck = c.bu + SEP + c.team;
      cols.set(ck, c);
      if (!groups.has(r.nhom_no)) groups.set(r.nhom_no, new Map());
      const g = groups.get(r.nhom_no);
      const x = g.get(r.ma_kh) || { ma_kh: r.ma_kh, ten_kh: r.ten_kh, cells: {}, tong: 0, nv: new Set() };
      x.cells[ck] = (x.cells[ck] || 0) + r.con_no; x.tong += r.con_no; x.nv.add(r.ten_nv);
      g.set(r.ma_kh, x);
    }
    const colList = [...cols.entries()].map(([key, c]) => ({ key, ...c }))
      .sort((a, b) => a.bu.localeCompare(b.bu, "vi") || (a.team === NO_TEAM) - (b.team === NO_TEAM) || a.team.localeCompare(b.team, "vi"));
    const bus = [];
    for (const c of colList) { const last = bus[bus.length - 1]; if (last && last.bu === c.bu) last.n++; else bus.push({ bu: c.bu, n: 1 }); }
    // Trạng thái giải trình theo KH × sale (kỳ này)
    const gtMap = new Map(data.giai_trinh.filter((g) => g.ky === ky).map((g) => [g.ma_kh + SEP + g.ten_nv, g]));
    const status = (ma, nvs) => {
      const list = [...nvs].map((nv) => ({ nv, st: D.stOf(gtMap.get(ma + SEP + nv)) }));
      return { done: list.filter((x) => x.st === D.DONE).length, total: list.length, list };
    };
    const groupsOut = ["A4", "A3", "A2"].filter((n) => groups.has(n)).map((n) => {
      const items = [...groups.get(n).values()].map((x) => ({ ...x, gt: status(x.ma_kh, x.nv) })).sort((a, b) => b.tong - a.tong);
      const sub = {}; let tong = 0;
      for (const x of items) { for (const [k, v] of Object.entries(x.cells)) sub[k] = (sub[k] || 0) + v; tong += x.tong; }
      return { nhom: n, items, sub, tong, done: items.filter((x) => x.gt.done === x.gt.total).length };
    });
    const grand = {}; let grandTong = 0;
    for (const g of groupsOut) { for (const [k, v] of Object.entries(g.sub)) grand[k] = (grand[k] || 0) + v; grandTong += g.tong; }
    return { cols: colList, bus, groups: groupsOut, grand, grandTong };
  }

  const gtText = (gt) => (gt.done === gt.total ? "Đã giải trình" : gt.done ? gt.done + "/" + gt.total + " sale" : "Chưa giải trình");

  function exportPivot(pv, ky) {
    const aoa = [["Nhóm nợ / Khách hàng", ...pv.cols.map((c) => c.bu + " · " + c.team), "Tổng", "Giải trình"]];
    for (const g of pv.groups) {
      aoa.push([g.nhom, ...pv.cols.map((c) => g.sub[c.key] || null), g.tong, g.done + "/" + g.items.length + " KH"]);
      for (const x of g.items) aoa.push(["   " + x.ten_kh, ...pv.cols.map((c) => x.cells[c.key] || null), x.tong, gtText(x.gt)]);
    }
    aoa.push(["Tổng cộng", ...pv.cols.map((c) => pv.grand[c.key] || null), pv.grandTong, ""]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 55 }, ...pv.cols.map(() => ({ wch: 16 })), { wch: 16 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "A2-A4 " + ky);
    XLSX.writeFile(wb, "Tong_hop_no_A2-A4_" + ky + ".xlsx");
  }

  function Pivot({ data, f }) {
    const [closed, setClosed] = useState({});
    const pv = buildPivot(data, f);
    if (!pv.groups.length) return null;
    const v = (n) => (n ? fmtTr(n, 1) : "");
    const GtCell = ({ gt }) => {
      const title = gt.list.map((x) => x.nv + ": " + D.TRANG_THAI[x.st].label).join("\n");
      const ok = gt.done === gt.total;
      return h("span", { title, className: "font-semibold " + (ok ? "text-green-700" : "text-red-600") }, (ok ? "✓ " : gt.done ? "" : "✗ ") + gtText(gt));
    };
    const border = (i) => (i === 0 || pv.cols[i - 1].bu !== pv.cols[i].bu ? " border-l border-slate-200" : "");
    const openKh = (x) => R.navigate("/giai-trinh", { ky: data.meta.ky, q: x.ten_kh });
    return h(UI.Panel, {
      title: "Tổng hợp nợ quá hạn trên mức an toàn (A2–A4) theo team · " + fmtKyLabel(data.meta.ky),
      subtitle: "Triệu đồng · cột theo BU → team của sale trong dm_ps · bấm tên KH để mở giải trình · bấm dòng nhóm để thu gọn",
      right: h("button", { type: "button", onClick: () => exportPivot(pv, data.meta.ky), className: UI.btn.secondary }, h(UI.I.Download, { size: 14 }), "Xuất Excel"),
    },
      h("div", { className: "scroll-shadow max-h-[640px] overflow-auto" }, h("table", { className: T.table },
        h("thead", { className: "sticky top-0 z-10" },
          h("tr", { className: T.headRow },
            h("th", { className: T.th() + " bg-slate-50", rowSpan: 2 }, "Nhóm nợ / Khách hàng"),
            pv.bus.map((b) => h("th", { key: b.bu, colSpan: b.n, className: "border-l border-slate-200 bg-slate-50 px-3 py-1 text-center font-semibold" }, b.bu)),
            h("th", { className: T.th(true) + " border-l border-slate-200 bg-slate-50", rowSpan: 2 }, "Tổng"),
            h("th", { className: T.th() + " border-l border-slate-200 bg-slate-50", rowSpan: 2 }, "Giải trình")),
          h("tr", { className: T.headRow },
            pv.cols.map((c, i) => h("th", { key: c.key, className: T.th(true) + " bg-slate-50" + border(i) + (c.team === NO_TEAM ? " italic text-slate-400" : "") }, c.team)))),
        h("tbody", null,
          pv.groups.flatMap((g) => {
            const isClosed = closed[g.nhom];
            const head = h("tr", { key: g.nhom, className: "cursor-pointer border-t border-slate-200 bg-blue-50 font-semibold", onClick: () => setClosed((c) => ({ ...c, [g.nhom]: !c[g.nhom] })) },
              h("td", { className: T.td + " whitespace-nowrap" }, (isClosed ? "⊞ " : "⊟ ") + D.NHOM_LABEL[g.nhom]),
              pv.cols.map((c, i) => h("td", { key: c.key, className: T.num + border(i) }, v(g.sub[c.key]))),
              h("td", { className: T.num + " border-l border-slate-200" }, v(g.tong)),
              h("td", { className: T.td + " whitespace-nowrap border-l border-slate-200 text-[12px] text-slate-600" }, g.done + "/" + g.items.length + " KH đã GT"));
            if (isClosed) return [head];
            return [head, ...g.items.map((x, i) => h("tr", { key: g.nhom + x.ma_kh, className: T.row(i) },
              h("td", { className: T.td + " pl-6" },
                h("button", { type: "button", onClick: () => openKh(x), className: "text-left hover:text-blue-700 hover:underline" }, x.ten_kh)),
              pv.cols.map((c, j) => h("td", { key: c.key, className: T.num + border(j) }, v(x.cells[c.key]))),
              h("td", { className: T.num + " border-l border-slate-200 font-medium" }, v(x.tong)),
              h("td", { className: T.td + " whitespace-nowrap border-l border-slate-200 text-[12px]" }, h(GtCell, { gt: x.gt }))))];
          }),
          h("tr", { className: "border-t-2 border-slate-300 bg-slate-100 font-bold" },
            h("td", { className: T.td }, "Tổng cộng"),
            pv.cols.map((c, i) => h("td", { key: c.key, className: T.num + border(i) }, v(pv.grand[c.key]))),
            h("td", { className: T.num + " border-l border-slate-200" }, v(pv.grandTong)),
            h("td", { className: T.td + " border-l border-slate-200" }))))));
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
        h("td", { className: T.num + (s.qh - s.qhP > 0.5e6 ? " text-red-600" : s.qh - s.qhP < -0.5e6 ? " text-green-700" : " text-slate-400") }, (s.qh - s.qhP > 0 ? "+" : "") + fmtTr(s.qh - s.qhP)),
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
              h("th", { className: "border-l border-slate-200 px-3 py-1 text-center font-semibold", colSpan: D.STATUS_LIST.length + 2 }, "Giải trình A2–A4 (số KH)"),
              h("th", { className: "border-l border-slate-200 px-3 py-1 text-center font-semibold", colSpan: 2 }, "Hẹn thu kỳ trước (số KH)")),
            h("tr", { className: T.headRow },
              ["Tổng dư nợ", "A1", "A2–A4", "+/- kỳ trước", "Thu trong tháng", "Phải GT", ...D.STATUS_LIST.map((st) => D.TRANG_THAI[st].label), "% xong", "Hẹn thu", "Đã có thu"]
                .map((x, i, arr) => h("th", { key: x, className: T.th(true) + (i === 0 || i === 5 || i === arr.length - 2 ? " border-l border-slate-200" : "") }, x)))),
          h("tbody", null, rows.map((s, i) => line(s, i)), rows.length > 1 && line(tot, 0, true))))));
    });
  }

  R.register("/theo-sale", TheoSale);

  function TongHop({ user }) {
    if (!user || !["admin", "manager"].includes(user.role)) return h(UI.Empty, null, "Chỉ admin và manager xem được bảng tổng hợp.");
    return h(D.KyScreen, null, ({ data, f }) => h(Pivot, { data, f }) || h(UI.Empty, null, "Không có nợ A2–A4 trong phạm vi lọc."));
  }
  R.register("/tong-hop", TongHop);
})();
