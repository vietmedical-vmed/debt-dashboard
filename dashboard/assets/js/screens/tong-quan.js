// Tổng quan: KPI, tiến độ giải trình, biến động dư nợ, cơ cấu nhóm nợ / nhóm KH, top KH quá hạn.
(function () {
  const h = React.createElement;
  const UI = window.DEBT_UI;
  const D = window.DEBT_DATA;
  const R = window.DEBT_ROUTER;
  const { T, fmtTr, fmtPct, fmtKyLabel } = UI;

  // Thanh ngang trong ô bảng. Kỳ này = xanh accent, kỳ trước = xám.
  const Bar = ({ value, max, prev }) => h("div", { className: "h-2.5 w-full min-w-[80px] rounded-sm bg-slate-100", title: fmtTr(value) + " tr" },
    h("div", { className: "h-2.5 rounded-sm " + (prev ? "bg-slate-400" : "bg-blue-500"), style: { width: Math.max(0, Math.min(100, (value / (max || 1)) * 100)) + "%" } }));

  const Delta = ({ v, invert }) => {
    if (v == null || Math.abs(v) < 0.5e6) return h("span", { className: "text-slate-400" }, "0");
    const bad = invert ? v < 0 : v > 0;
    return h("span", { className: bad ? "text-red-600" : "text-green-700" }, (v > 0 ? "+" : "") + fmtTr(v));
  };

  function KpiRow({ data, f, khach }) {
    const ky = data.meta.ky, kt = data.meta.ky_truoc;
    const rows = D.applyFilter(data.agg, f);
    const cur = rows.filter((r) => r.ky === ky), prev = rows.filter((r) => r.ky === kt);
    const tong = D.sum(cur), tongP = D.sum(prev);
    const qh = D.sum(cur.filter((r) => r.nhom_no !== "A0")), qhP = D.sum(prev.filter((r) => r.nhom_no !== "A0"));
    const nghiem = D.sum(cur.filter((r) => D.NHOM_GT.includes(r.nhom_no))), nghiemP = D.sum(prev.filter((r) => D.NHOM_GT.includes(r.nhom_no)));
    const bbbg = D.sum(cur.filter((r) => r.khong_chung_tu && r.bu !== "cttm"));
    const bbbgP = D.sum(prev.filter((r) => r.khong_chung_tu && r.bu !== "cttm"));
    const hv = D.sum(D.applyFilter(data.hang_vay, f), (r) => r.gia_tri);
    const sub = (v, p) => "So với " + fmtKyLabel(kt) + ": " + (v - p >= 0 ? "+" : "") + fmtTr(v - p) + " tr (" + fmtPct(p ? (v - p) / p : null) + ")";
    return h("div", { className: "grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" },
      h(UI.StatCard, { label: "TỔNG DƯ NỢ CUỐI KỲ (tr)", value: fmtTr(tong), sub: sub(tong, tongP) }),
      h(UI.StatCard, { label: "NỢ QUÁ HẠN A1–A4 (tr)", value: fmtTr(qh), sub: "Tỷ trọng " + fmtPct(tong ? qh / tong : null) + " (" + fmtKyLabel(kt) + ": " + fmtPct(tongP ? qhP / tongP : null) + ")" }),
      h(UI.StatCard, { label: "QUÁ HẠN TRÊN MỨC AN TOÀN A2–A4 (tr)", value: fmtTr(nghiem), accent: true,
        sub: fmtPct(qh ? nghiem / qh : null) + " nợ quá hạn · " + sub(nghiem, nghiemP).replace("So với", "vs") }),
      h(UI.StatCard, { label: "DƯ NỢ CHƯA CÓ BBBG/ĐCCN (tr)", value: fmtTr(bbbg), sub: "Chưa gồm CTTM · vs " + fmtKyLabel(kt) + ": " + (bbbg - bbbgP >= 0 ? "+" : "") + fmtTr(bbbg - bbbgP) }),
      h(UI.StatCard, { label: "HÀNG VAY CHƯA XUẤT HĐ (tr)", value: fmtTr(hv), sub: new Set(D.applyFilter(data.hang_vay, f).map((r) => r.ten_kh)).size + " khách hàng" }));
  }

  function TienDo({ khach, meta, f }) {
    const need = khach.filter((k) => k.can_gt);
    const cnt = (st) => need.filter((k) => k.trang_thai === st).length;
    const done = cnt(D.DONE);
    const han = D.hanInfo(meta.han_giai_trinh);
    const items = D.STATUS_LIST.map((st) => ({ st, n: cnt(st) }));
    const tone = D.STATUS_BG;
    return h(UI.Panel, {
      title: "Tiến độ giải trình nợ A2–A4 · " + fmtKyLabel(meta.ky),
      subtitle: need.length + " khách hàng × sale phải giải trình" + (meta.han_giai_trinh ? " · Hạn " + UI.fmtDate(meta.han_giai_trinh) + " (" + han.text + ")" : " · Chưa đặt hạn"),
      right: h("a", { href: R.href("/giai-trinh", { ky: meta.ky }), className: UI.btn.secondary }, "Mở danh sách giải trình ", h(UI.I.ArrowRight, { size: 14 })),
    },
      h("div", { className: "px-4 py-3" },
        h("div", { className: "flex h-3 w-full gap-[2px] overflow-hidden rounded-sm bg-slate-100" },
          items.filter((x) => x.n).map((x) => h("div", { key: x.st, className: tone[x.st], style: { width: (x.n / need.length) * 100 + "%" }, title: D.TRANG_THAI[x.st].label + ": " + x.n }))),
        h("div", { className: "mt-2 flex flex-wrap gap-4 text-[12px] text-slate-600" },
          items.map((x) => h("a", { key: x.st, href: R.href("/giai-trinh", { ky: meta.ky, tt: x.st }), className: "flex items-center gap-1.5 hover:underline" },
            h(UI.Swatch, { cls: tone[x.st] }), D.TRANG_THAI[x.st].label, h("b", { className: "tabular-nums text-slate-800" }, x.n))),
          h("span", { className: "ml-auto font-semibold text-slate-700" }, "Hoàn thành " + fmtPct(need.length ? done / need.length : null, 0)))));
  }

  function BienDong({ meta }) {
    const rows = meta.bien_dong || [];
    if (!rows.length) return null;
    const f1 = (v) => (v == null ? "—" : Math.round(v).toLocaleString("vi-VN"));
    return h(UI.Panel, { title: "Biến động dư nợ theo ngành hàng (triệu đồng)", subtitle: "Theo sheet BC của kế toán, toàn khối (không áp bộ lọc)" },
      h("div", { className: "overflow-x-auto" }, h("table", { className: T.table },
        h("thead", null, h("tr", { className: T.headRow },
          ["Ngành hàng", "Dư nợ đầu kỳ", "Doanh thu mới", "Thu tiền", "Điều chỉnh KT", "Dư nợ cuối kỳ", "+/- trong kỳ"].map((x, i) => h("th", { key: x, className: T.th(i > 0) }, x)))),
        h("tbody", null, rows.map((r, i) => {
          const tot = r.nganh_hang === "Tổng";
          return h("tr", { key: r.nganh_hang, className: tot ? "border-t border-slate-200 bg-slate-50 font-semibold" : T.row(i) },
            h("td", { className: T.td }, r.nganh_hang), h("td", { className: T.num }, f1(r.dau_ky)), h("td", { className: T.num }, f1(r.doanh_thu)),
            h("td", { className: T.num }, f1(r.thu_tien)), h("td", { className: T.num }, f1(r.dieu_chinh)), h("td", { className: T.num }, f1(r.cuoi_ky)),
            h("td", { className: T.num }, h(Delta, { v: (r.cuoi_ky - r.dau_ky) * 1e6 })));
        })))));
  }

  function CoCauNhomNo({ data, f }) {
    const ky = data.meta.ky, kt = data.meta.ky_truoc;
    const rows = D.applyFilter(data.agg, f);
    const cur = D.groupSum(rows.filter((r) => r.ky === ky), (r) => r.nhom_no);
    const prev = D.groupSum(rows.filter((r) => r.ky === kt), (r) => r.nhom_no);
    const tong = [...cur.values()].reduce((a, b) => a + b, 0), tongP = [...prev.values()].reduce((a, b) => a + b, 0);
    const max = Math.max(...D.NHOM.map((n) => Math.max(cur.get(n) || 0, prev.get(n) || 0)), 1);
    return h(UI.Panel, {
      title: "Cơ cấu dư nợ theo nhóm tuổi nợ (triệu đồng)",
      right: h(UI.Legend, { items: [{ label: fmtKyLabel(ky), cls: "bg-blue-500" }, { label: fmtKyLabel(kt), cls: "bg-slate-400" }] }),
    },
      h("div", { className: "overflow-x-auto" }, h("table", { className: T.table },
        h("thead", null, h("tr", { className: T.headRow },
          ["Nhóm nợ", fmtKyLabel(ky), fmtKyLabel(kt), "+/-", "%", "Tỷ trọng", "So sánh"].map((x, i) => h("th", { key: x, className: T.th(i > 0 && i < 6) }, x)))),
        h("tbody", null,
          D.NHOM.map((n, i) => {
            const c = cur.get(n) || 0, p = prev.get(n) || 0;
            return h("tr", { key: n, className: T.row(i) },
              h("td", { className: T.td + (D.NHOM_GT.includes(n) ? " font-medium text-red-700" : "") }, D.NHOM_LABEL[n]),
              h("td", { className: T.num }, fmtTr(c)), h("td", { className: T.num + " text-slate-500" }, fmtTr(p)),
              h("td", { className: T.num }, h(Delta, { v: c - p, invert: n === "A0" })), h("td", { className: T.num }, fmtPct(p ? (c - p) / p : null)),
              h("td", { className: T.num }, fmtPct(tong ? c / tong : null)),
              h("td", { className: T.td + " w-48" }, h("div", { className: "flex flex-col gap-[2px]" }, h(Bar, { value: c, max }), h(Bar, { value: p, max, prev: true }))));
          }),
          h("tr", { className: "border-t border-slate-200 bg-slate-50 font-semibold" },
            h("td", { className: T.td }, "Tổng dư nợ"), h("td", { className: T.num }, fmtTr(tong)), h("td", { className: T.num }, fmtTr(tongP)),
            h("td", { className: T.num }, h(Delta, { v: tong - tongP })), h("td", { className: T.num }, fmtPct(tongP ? (tong - tongP) / tongP : null)),
            h("td", { className: T.num }, "100%"), h("td", null))))));
  }

  function CoCauNhomKH({ data, f }) {
    const ky = data.meta.ky;
    const cur = D.applyFilter(data.agg, f).filter((r) => r.ky === ky);
    const groups = [...new Set(cur.map((r) => r.loai_hinh || "(khác)"))];
    const tongQH = D.sum(cur.filter((r) => D.NHOM_GT.includes(r.nhom_no)));
    const rows = groups.map((g) => {
      const x = cur.filter((r) => (r.loai_hinh || "(khác)") === g);
      return { g, tong: D.sum(x), qh: D.sum(x.filter((r) => D.NHOM_GT.includes(r.nhom_no))) };
    }).sort((a, b) => b.tong - a.tong);
    return h(UI.Panel, { title: "Cơ cấu nợ theo nhóm khách hàng (triệu đồng)" },
      h("table", { className: T.table },
        h("thead", null, h("tr", { className: T.headRow },
          ["Nhóm KH", "Tổng dư nợ", "Quá hạn A2–A4", "% A2–A4 / dư nợ nhóm", "Tỷ trọng trong A2–A4"].map((x, i) => h("th", { key: x, className: T.th(i > 0) }, x)))),
        h("tbody", null, rows.map((r, i) => h("tr", { key: r.g, className: T.row(i) },
          h("td", { className: T.td }, r.g), h("td", { className: T.num }, fmtTr(r.tong)), h("td", { className: T.num }, fmtTr(r.qh)),
          h("td", { className: T.num }, fmtPct(r.tong ? r.qh / r.tong : null)), h("td", { className: T.num }, fmtPct(tongQH ? r.qh / tongQH : null)))))));
  }

  function TopKH({ data, f }) {
    const ky = data.meta.ky;
    const cur = D.applyFilter(data.agg, f).filter((r) => r.ky === ky && r.nhom_no !== "A0");
    const m = new Map();
    for (const r of cur) {
      const x = m.get(r.ma_kh) || { ma: r.ma_kh, ten: r.ten_kh, nv: new Set(), A1: 0, qh: 0, tong: 0 };
      x.nv.add(r.ten_nv); x.tong += r.con_no;
      if (r.nhom_no === "A1") x.A1 += r.con_no; else x.qh += r.con_no;
      m.set(r.ma_kh, x);
    }
    const all = [...m.values()].sort((a, b) => b.tong - a.tong);
    const tong = all.reduce((t, x) => t + x.tong, 0);
    const top = all.slice(0, 15);
    const max = top[0] ? top[0].tong : 1;
    return h(UI.Panel, { title: "Top 15 khách hàng nợ quá hạn lớn nhất (A1–A4, triệu đồng)",
      subtitle: "Top 15 chiếm " + fmtPct(tong ? top.reduce((t, x) => t + x.tong, 0) / tong : null) + " tổng nợ quá hạn",
      right: h(UI.Legend, { items: [{ label: "A2–A4", cls: "bg-red-500" }, { label: "A1", cls: "bg-blue-300" }] }) },
      h("div", { className: "overflow-x-auto" }, h("table", { className: T.table },
        h("thead", null, h("tr", { className: T.headRow },
          ["#", "Khách hàng", "Sale", "A1", "A2–A4", "Tổng quá hạn", "% tổng QH", ""].map((x, i) => h("th", { key: i, className: T.th(i >= 3 && i <= 6) }, x)))),
        h("tbody", null, top.map((x, i) => h("tr", { key: x.ma, className: T.row(i) },
          h("td", { className: T.td + " text-slate-400" }, i + 1),
          h("td", { className: T.td }, x.ten),
          h("td", { className: T.td + " text-[12px] text-slate-500" }, [...x.nv].join(", ")),
          h("td", { className: T.num }, fmtTr(x.A1)),
          h("td", { className: T.num + (x.qh ? " font-medium text-red-700" : "") }, fmtTr(x.qh)),
          h("td", { className: T.num + " font-semibold" }, fmtTr(x.tong)),
          h("td", { className: T.num }, fmtPct(tong ? x.tong / tong : null)),
          h("td", { className: T.td + " w-44" },
            h("div", { className: "flex h-2.5 w-full gap-[2px] rounded-sm bg-slate-100", title: "A2–A4 " + fmtTr(x.qh) + " · A1 " + fmtTr(x.A1) },
              x.qh > 0 && h("div", { className: "rounded-sm bg-red-500", style: { width: (x.qh / max) * 100 + "%" } }),
              x.A1 > 0 && h("div", { className: "rounded-sm bg-blue-300", style: { width: (x.A1 / max) * 100 + "%" } })))))))));
  }

  function TongQuan() {
    return h(D.KyScreen, null, ({ data, f }) => {
      const khach = D.buildKhach(data, f);
      const filtered = f.nganh.length || f.nv.length || f.loai.length;
      return h("div", { className: "flex flex-col gap-4" },
        h(KpiRow, { data, f, khach }),
        h(TienDo, { khach, meta: data.meta, f }),
        !filtered && h(BienDong, { meta: data.meta }),
        h("div", { className: "grid gap-4 xl:grid-cols-2" }, h(CoCauNhomNo, { data, f }), h(CoCauNhomKH, { data, f })),
        h(TopKH, { data, f }));
    });
  }

  R.register("/tong-quan", TongQuan);
})();
