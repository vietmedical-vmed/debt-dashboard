// Theo sale: dư nợ quá hạn, tiến độ giải trình và cam kết kỳ trước vs thực thu của từng sale.
(function () {
  const h = React.createElement;
  const UI = window.DEBT_UI;
  const D = window.DEBT_DATA;
  const R = window.DEBT_ROUTER;
  const { T, fmtTr, fmtPct, fmtKyLabel } = UI;

  function build(data, f) {
    const khach = D.buildKhach(data, f);
    const endKy = (() => { const [y, m] = data.meta.ky.split("-").map(Number); return new Date(y, m, 0).toISOString().slice(0, 10); })();
    const m = new Map();
    for (const k of khach) {
      const s = m.get(k.ten_nv) || { nv: k.ten_nv, tong: 0, A1: 0, qh: 0, qhP: 0, thu: 0, need: 0, st: {}, camKet: 0, camKetThu: 0, soCamKet: 0 };
      s.tong += k.tong; s.A1 += k.A1; s.qh += k.qua_han; s.qhP += k.prev_qua_han; s.thu += k.thu;
      if (k.can_gt) { s.need++; s.st[k.trang_thai] = (s.st[k.trang_thai] || 0) + 1; }
      // Cam kết kỳ trước có hạn thu trong/trước kỳ này
      const g = k.gt_prev;
      if (g && g.ngay_du_kien && g.ngay_du_kien <= endKy && g.so_tien_du_kien) {
        s.camKet += g.so_tien_du_kien; s.camKetThu += Math.min(k.thu, g.so_tien_du_kien); s.soCamKet++;
      }
      m.set(k.ten_nv, s);
    }
    return [...m.values()].sort((a, b) => b.qh - a.qh || b.tong - a.tong);
  }

  function TheoSale() {
    return h(D.KyScreen, null, ({ data, f }) => {
      const rows = build(data, f);
      const tot = rows.reduce((t, s) => {
        for (const k of ["tong", "A1", "qh", "qhP", "thu", "need", "camKet", "camKetThu"]) t[k] = (t[k] || 0) + s[k];
        for (const [st, n] of Object.entries(s.st)) t.st[st] = (t.st[st] || 0) + n;
        return t;
      }, { st: {} });
      const stCell = (s, st, cls) => h("td", { className: T.num + " " + (s.st[st] ? cls : "text-slate-300") }, s.st[st] || 0);
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
        stCell(s, "chua", "text-red-600"), stCell(s, "nhap", "text-amber-700"), stCell(s, "tra_lai", "text-red-600"),
        stCell(s, "cho_duyet", "text-blue-700"), stCell(s, "da_duyet", "text-slate-800"),
        h("td", { className: T.num }, s.need ? fmtPct((s.st.da_duyet || 0) / s.need, 0) : "—"),
        h("td", { className: T.num }, s.camKet ? fmtTr(s.camKet) : "—"),
        h("td", { className: T.num }, s.camKet ? fmtPct(s.camKetThu / s.camKet, 0) : "—"));
      return h(UI.Panel, {
        title: "Công nợ & giải trình theo sale · " + fmtKyLabel(data.meta.ky),
        subtitle: "Triệu đồng · bấm vào sale để mở danh sách giải trình · Cam kết = số tiền dự kiến thu trong giải trình " + fmtKyLabel(data.meta.ky_truoc) + " có hạn đến hết " + fmtKyLabel(data.meta.ky),
      },
        h("div", { className: "overflow-x-auto" }, h("table", { className: T.table },
          h("thead", null,
            h("tr", { className: T.headRow },
              h("th", { className: T.th(), rowSpan: 2 }, "Sale"),
              h("th", { className: T.th(true) + " border-l border-slate-200", colSpan: 5 }, "Công nợ"),
              h("th", { className: "border-l border-slate-200 px-3 py-1 text-center font-semibold", colSpan: 7 }, "Giải trình A2–A4 (số KH)"),
              h("th", { className: "border-l border-slate-200 px-3 py-1 text-center font-semibold", colSpan: 2 }, "Cam kết kỳ trước")),
            h("tr", { className: T.headRow },
              ["Tổng dư nợ", "A1", "A2–A4", "+/- kỳ trước", "Thu trong tháng", "Phải GT", "Chưa", "Nháp", "Trả lại", "Chờ duyệt", "Đã duyệt", "% xong", "Số tiền", "% đã thu"]
                .map((x, i) => h("th", { key: x, className: T.th(true) + (i === 0 || i === 5 || i === 12 ? " border-l border-slate-200" : "") }, x)))),
          h("tbody", null, rows.map((s, i) => line(s, i)), rows.length > 1 && line(tot, 0, true)))));
    });
  }

  R.register("/theo-sale", TheoSale);
})();
