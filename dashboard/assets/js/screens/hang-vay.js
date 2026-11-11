// Hàng vay / hàng gửi chưa xuất hóa đơn: theo KH × sale, mở rộng xem chi tiết chứng từ.
(function () {
  const { useState } = React;
  const h = React.createElement;
  const UI = window.DEBT_UI;
  const D = window.DEBT_DATA;
  const R = window.DEBT_ROUTER;
  const { T, fmtTr, fmtPct, fmtKyLabel, btn } = UI;

  function exportExcel(rows, ky) {
    const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
      "Khách hàng": r.ten_kh, "Sale": r.ten_nv, "Ngành hàng": r.nganh_hang, "Tháng xuất": r.thang_xuat, "Chứng từ": r.chung_tu,
      "Mã hàng": r.ma_hang, "Tên hàng": r.ten_hang, "ĐVT": r.dvt, "SL": r.sl, "Đơn giá vốn": r.don_gia, "Giá trị": r.gia_tri, "Ghi chú": r.ghi_chu,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Hang vay " + ky);
    XLSX.writeFile(wb, "Hang_vay_chua_xuat_HD_" + ky + ".xlsx");
  }

  function View({ data, f }) {
    const [open, setOpen] = useState(null);
    const [search, setSearch] = useState("");
    const rows = D.applyFilter(data.hang_vay, f);
    const nganhs = [...new Set(rows.map((r) => r.nganh_hang))].sort();
    const m = new Map();
    for (const r of rows) {
      const k = r.ten_kh + "\u0001" + r.ten_nv;
      const x = m.get(k) || { key: k, ten_kh: r.ten_kh, ten_nv: r.ten_nv, by: {}, tong: 0, items: [], thang: new Set() };
      x.by[r.nganh_hang] = (x.by[r.nganh_hang] || 0) + r.gia_tri; x.tong += r.gia_tri; x.items.push(r); x.thang.add(r.thang_xuat);
      m.set(k, x);
    }
    const s = UI.deaccent(search.trim());
    const list = [...m.values()].filter((x) => !s || UI.deaccent(x.ten_kh + " " + x.ten_nv).includes(s)).sort((a, b) => b.tong - a.tong);
    const tong = rows.reduce((t, r) => t + r.gia_tri, 0);
    const top7 = list.slice(0, 7).reduce((t, x) => t + x.tong, 0);

    return h("div", { className: "flex flex-col gap-3" },
      h("div", { className: "grid grid-cols-2 gap-3 md:grid-cols-4" },
        h(UI.StatCard, { label: "TỔNG HÀNG VAY CHƯA XUẤT HĐ (tr)", value: fmtTr(tong), accent: true }),
        h(UI.StatCard, { label: "SỐ KHÁCH HÀNG × SALE", value: list.length }),
        h(UI.StatCard, { label: "TỶ TRỌNG TOP 7", value: fmtPct(tong ? top7 / tong : null) }),
        h(UI.StatCard, { label: "SỐ DÒNG CHỨNG TỪ", value: rows.length })),
      h("div", { className: "flex items-center gap-2" },
        h(UI.SearchInput, { value: search, onChange: setSearch, placeholder: "Tìm khách hàng, sale…" }),
        h("div", { className: "flex-1" }),
        h("button", { type: "button", onClick: () => exportExcel(rows, data.meta.ky), className: btn.secondary }, h(UI.I.Download, { size: 14 }), "Xuất Excel chi tiết")),
      h(UI.Panel, { title: "Hàng vay / hàng gửi chưa xuất hóa đơn · " + fmtKyLabel(data.meta.ky), subtitle: "Triệu đồng · bấm vào dòng để xem chứng từ" },
        h("div", { className: "overflow-x-auto" }, h("table", { className: T.table },
          h("thead", null, h("tr", { className: T.headRow },
            ["#", "Khách hàng", "Sale", "Tháng xuất", ...nganhs, "Tổng", "% tổng"].map((x, i) => h("th", { key: x + i, className: T.th(i >= 4) }, x)))),
          h("tbody", null, list.flatMap((x, i) => {
            const out = [h("tr", { key: x.key, className: T.row(i) + " cursor-pointer", onClick: () => setOpen(open === x.key ? null : x.key) },
              h("td", { className: T.td + " text-slate-400" }, (open === x.key ? "▾ " : "▸ ") + (i + 1)),
              h("td", { className: T.td }, x.ten_kh),
              h("td", { className: T.td + " whitespace-nowrap" }, x.ten_nv),
              h("td", { className: T.td + " text-[12px] text-slate-500" }, [...x.thang].filter(Boolean).sort().map(fmtKyLabel).join(", ")),
              ...nganhs.map((n) => h("td", { key: n, className: T.num }, x.by[n] ? fmtTr(x.by[n]) : "—")),
              h("td", { className: T.num + " font-semibold" }, fmtTr(x.tong)),
              h("td", { className: T.num }, fmtPct(tong ? x.tong / tong : null)))];
            if (open === x.key) out.push(h("tr", { key: x.key + "-d" }, h("td", { colSpan: 6 + nganhs.length, className: "bg-slate-50 px-6 py-2" },
              h("table", { className: "w-full text-[12px]" },
                h("thead", null, h("tr", { className: "text-left text-slate-400" }, ["Chứng từ", "Tháng", "Mã hàng", "Tên hàng", "SL", "Giá trị (tr)", "Ghi chú"].map((c) => h("th", { key: c, className: "px-2 py-1 font-medium" }, c)))),
                h("tbody", null, x.items.map((r, j) => h("tr", { key: j, className: "border-t border-slate-200" },
                  h("td", { className: "px-2 py-1" }, r.chung_tu), h("td", { className: "px-2 py-1" }, fmtKyLabel(r.thang_xuat)),
                  h("td", { className: "px-2 py-1" }, r.ma_hang), h("td", { className: "px-2 py-1" }, r.ten_hang),
                  h("td", { className: "px-2 py-1 tabular-nums" }, r.sl), h("td", { className: "px-2 py-1 tabular-nums" }, fmtTr(r.gia_tri, 1)),
                  h("td", { className: "px-2 py-1 text-slate-500" }, r.ghi_chu || ""))))))));
            return out;
          }),
          list.length > 0 && h("tr", { className: "border-t border-slate-200 bg-slate-50 font-semibold" },
            h("td", { className: T.td, colSpan: 4 }, "Tổng cộng"),
            ...nganhs.map((n) => h("td", { key: n, className: T.num }, fmtTr(rows.filter((r) => r.nganh_hang === n).reduce((t, r) => t + r.gia_tri, 0)))),
            h("td", { className: T.num }, fmtTr(tong)), h("td", { className: T.num }, "100%")))))));
  }

  R.register("/hang-vay", () => h(D.KyScreen, null, (ctx) => h(View, ctx)));
})();
