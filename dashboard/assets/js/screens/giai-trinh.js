// Giải trình: danh sách KH × sale có nợ A2–A4, sale nhập giải trình, quản lý duyệt / trả lại.
(function () {
  const { useState, useMemo, useEffect } = React;
  const h = React.createElement;
  const UI = window.DEBT_UI;
  const D = window.DEBT_DATA;
  const R = window.DEBT_ROUTER;
  const { api, errorText } = window.DEBT_API;
  const C = window.DEBT_CONFIG;
  const { T, fmtTr, fmtPct, fmtDate, fmtKyLabel, btn } = UI;

  const ACTION_LABEL = { luu: "Lưu nháp", gui: window.DEBT_CONFIG.PHE_DUYET ? "Gửi duyệt" : "Lưu giải trình", duyet: "Duyệt", tra_lai: "Trả lại" };

  // ── Form giải trình + duyệt ───────────────────────────────────────
  function GiaiTrinhForm({ k, data, kyMeta, onSaved, canEdit, canApprove }) {
    const gt = k.gt;
    const prefill = !gt && k.gt_prev;
    const src = gt || k.gt_prev || {};
    // Tháng dự kiến thu không kế thừa: mỗi kỳ phải chọn lại.
    const [form, setForm] = useState({ ke_hoach: src.ke_hoach || "", thang_du_kien: (gt && gt.thang_du_kien) || "" });
    const [nhanXet, setNhanXet] = useState("");
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);
    const st = k.trang_thai;
    const locked = kyMeta && kyMeta.khoa;
    // Không duyệt: sửa lại được tới khi khoá kỳ.
    const editable = canEdit && !locked && (!D.PHE_DUYET || ["chua", "nhap", "tra_lai"].includes(st));
    const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

    const save = async (submit) => {
      setBusy(true); setMsg(null);
      try {
        const r = await api("save_gt", { ky: data.meta.ky, ma_kh: k.ma_kh, nganh_hang: k.nganh_hang, nhom_gt: k.nhom_gt, submit, fields: { ...form, ten_kh: k.ten_kh } });
        onSaved(r.row);
        setMsg({ ok: true, text: !D.PHE_DUYET ? "Đã lưu giải trình" : submit ? "Đã gửi duyệt" : "Đã lưu nháp" });
      } catch (e) { setMsg({ ok: false, text: errorText(e.message) }); }
      setBusy(false);
    };
    const review = async (decision) => {
      setBusy(true); setMsg(null);
      try {
        const r = await api("review_gt", { id: gt.id, decision, nhan_xet: nhanXet });
        onSaved(r.row);
        setMsg({ ok: true, text: decision === "duyet" ? "Đã duyệt" : "Đã trả lại" });
        setNhanXet("");
      } catch (e) { setMsg({ ok: false, text: errorText(e.message) }); }
      setBusy(false);
    };

    const ro = (label, val) => h("div", null, h("div", { className: UI.fieldLabel }, label), h("div", { className: "whitespace-pre-wrap text-[13px] text-slate-800" }, val || "—"));

    return h("div", { className: "flex flex-col gap-3" },
      h("div", { className: "flex flex-wrap items-center gap-2" },
        h(D.StatusBadge, { st }),
        gt && gt.nguoi_cap_nhat && st !== "chua" && h("span", { className: "text-[11px] text-slate-400" }, "Cập nhật bởi " + gt.nguoi_cap_nhat + " lúc " + new Date(gt.cap_nhat_luc).toLocaleString("vi-VN")),
        gt && gt.nguoi_duyet && h("span", { className: "text-[11px] text-slate-400" }, "· " + (st === "da_duyet" ? "Duyệt" : "Xử lý") + " bởi " + gt.nguoi_duyet),
        locked && h(UI.Badge, { tone: "grey" }, "Kỳ đã khoá")),
      gt && gt.nhan_xet && h("div", { className: "rounded-md border px-3 py-2 text-[13px] " + (st === "tra_lai" ? "border-red-200 bg-red-50 text-red-800" : "border-slate-200 bg-slate-50 text-slate-700") },
        h("b", null, "Nhận xét của quản lý: "), gt.nhan_xet),
      k.can_cap_nhat && h("div", { className: "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900" },
        h("b", null, "Cần cập nhật: "), (k.gt.du_no_qua_han != null
          ? "giải trình viết khi A2–A4 là " + fmtTr(k.gt.du_no_qua_han, 1) + " tr, số hiện tại " + fmtTr(k.qua_han, 1) + " tr"
          : "số A2–A4 đã thay đổi đáng kể so với lúc lưu giải trình") + " (dữ liệu đã nạp lại). Sửa và lưu lại để xác nhận."),
      prefill && editable && h("div", { className: "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800" },
        "Đã điền sẵn giải trình " + fmtKyLabel(k.gt_prev.ky) + ". Cập nhật tiến độ và chọn lại tháng dự kiến thu."),

      editable
        ? h("div", { className: "grid gap-3" },
            h("label", null, h("span", { className: UI.fieldLabel }, "Giải trình & kế hoạch xử lý *"),
              h("textarea", { rows: 5, value: form.ke_hoach, onChange: set("ke_hoach"), className: UI.input,
                placeholder: "Lý do quá hạn, tình trạng hồ sơ, việc cần làm, ai làm, khi nào…" })),
            h("label", { className: "md:w-1/2" }, h("span", { className: UI.fieldLabel }, "Tháng dự kiến thu *"),
              h("input", { type: "month", value: form.thang_du_kien, onChange: set("thang_du_kien"), className: UI.input, min: data.meta.ky, placeholder: "yyyy-mm" })))
        : h("div", { className: "grid gap-3" },
            ro("Giải trình & kế hoạch xử lý", gt && gt.ke_hoach),
            ro("Tháng dự kiến thu", gt && gt.thang_du_kien)),

      msg && (msg.ok
        ? h("div", { className: "flex items-center gap-1.5 text-[13px] text-green-700" }, h(UI.I.Check, { size: 14 }), msg.text)
        : h(UI.ErrorBox, null, msg.text)),

      editable && (D.PHE_DUYET
        ? h("div", { className: "flex flex-wrap justify-end gap-2" },
            h("button", { type: "button", disabled: busy, onClick: () => save(false), className: btn.secondary }, "Lưu nháp"),
            h("button", { type: "button", disabled: busy, onClick: () => save(true), className: btn.primary }, h(UI.I.Send, { size: 14 }), "Gửi duyệt"))
        : h("div", { className: "flex justify-end" },
            h("button", { type: "button", disabled: busy, onClick: () => save(true), className: btn.primary }, h(UI.I.Check, { size: 14 }), st === "chua" ? "Lưu giải trình" : "Cập nhật giải trình"))),

      D.PHE_DUYET && canApprove && !locked && gt && (st === "cho_duyet" || st === "da_duyet") && h("div", { className: "mt-1 flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50/50 p-3" },
        h("span", { className: UI.fieldLabel }, st === "cho_duyet" ? "Duyệt giải trình" : "Mở lại giải trình đã duyệt"),
        h("textarea", { rows: 2, value: nhanXet, onChange: (e) => setNhanXet(e.target.value), className: UI.input,
          placeholder: st === "cho_duyet" ? "Nhận xét (bắt buộc khi trả lại)" : "Lý do mở lại (bắt buộc)" }),
        h("div", { className: "flex justify-end gap-2" },
          h("button", { type: "button", disabled: busy, onClick: () => review("tra_lai"),
            className: "inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3.5 py-1.5 text-[13px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50" },
            h(UI.I.Undo, { size: 14 }), "Trả lại"),
          st === "cho_duyet" && h("button", { type: "button", disabled: busy, onClick: () => review("duyet"), className: btn.primary }, h(UI.I.Check, { size: 14 }), "Duyệt"))));
  }

  // ── Popup chi tiết 1 KH × sale ────────────────────────────────────
  function KhachModal({ k, data, kyMeta, onClose, onSaved, canEdit, canApprove }) {
    const [det, setDet] = useState(null);
    const [err, setErr] = useState(null);
    const [tick, setTick] = useState(0);
    useEffect(() => {
      let alive = true;
      api("get_kh", { ky: data.meta.ky, ma_kh: k.ma_kh, nganh_hang: k.nganh_hang, nhom_gt: k.nhom_gt })
        .then((r) => alive && setDet(r)).catch((e) => alive && setErr(errorText(e.message)));
      return () => { alive = false; };
    }, [k.ma_kh, k.nganh_hang, k.nhom_gt, data.meta.ky, tick]);
    // Lưu/duyệt xong: cập nhật danh sách + tải lại lịch sử thao tác trong popup.
    const saved = (row) => { onSaved(row); setTick((t) => t + 1); };

    const hd = det ? det.hoa_don.filter((r) => D.NHOM_GT.includes(r.nhom_no)) : [];
    const lichSu = det ? det.lich_su.filter((g) => g.ky !== data.meta.ky) : [];
    const stat = (label, v, cls = "") => h("div", { className: "rounded-md border border-slate-200 bg-white px-3 py-2" },
      h("div", { className: "text-[10px] uppercase tracking-wide text-slate-400" }, label), h("div", { className: "text-[15px] font-semibold tabular-nums " + cls }, v));

    return h(UI.Modal, { open: true, onClose, width: 1480, title: k.ten_kh + " · " + UI.buName(k.nganh_hang) + "  ·  người giải trình: " + (k.nhom_label || "—") + "  (sale: " + k.ten_nv + ")" },
      h("div", { className: "flex max-h-[calc(100vh-110px)] flex-col gap-4 overflow-y-auto p-4" },
        h("div", { className: "grid grid-cols-2 gap-2 md:grid-cols-5" },
          stat("A2–A4 (tr)", fmtTr(k.qua_han), "text-red-700"),
          stat("Kỳ trước A2–A4", fmtTr(k.prev_qua_han)),
          stat("Tổng dư nợ (tr)", fmtTr(k.tong)),
          stat("Thu trong tháng (tr)", fmtTr(k.thu)),
          stat("Quá hạn lâu nhất", k.max_ngay + " ngày")),
        k.gt_prev && k.gt_prev.thang_du_kien && h("div", { className: "rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600" },
          "Giải trình " + fmtKyLabel(k.gt_prev.ky) + " dự kiến thu tháng ", h("b", null, k.gt_prev.thang_du_kien),
          " · Thực thu " + fmtKyLabel(data.meta.ky) + ": ", h("b", null, fmtTr(k.thu, 1) + " tr"),
          " · A2–A4 thay đổi: ", h("b", null, (k.qua_han - k.prev_qua_han >= 0 ? "+" : "") + fmtTr(k.qua_han - k.prev_qua_han, 1) + " tr")),

        h("div", { className: "grid gap-4 xl:grid-cols-3" },
          h("div", { className: "min-w-0 xl:col-span-1" },
            h(UI.Panel, { title: "Giải trình " + fmtKyLabel(data.meta.ky) },
              h("div", { className: "p-4" }, h(GiaiTrinhForm, { k, data, kyMeta, onSaved: saved, canEdit, canApprove }))),
            lichSu.length > 0 && h(UI.Panel, { title: "Giải trình các kỳ trước", className: "mt-4" },
              h("div", { className: "divide-y divide-slate-100" }, lichSu.map((g) => h("div", { key: g.id, className: "px-4 py-2 text-[12px]" },
                h("div", { className: "mb-1 flex items-center gap-2" }, h("b", null, fmtKyLabel(g.ky)), h(D.StatusBadge, { st: D.stOf(g) }),
                  g.du_no_qua_han != null && h("span", { className: "text-slate-400" }, "A2–A4 lúc gửi: " + fmtTr(g.du_no_qua_han) + " tr")),
                h("div", { className: "whitespace-pre-wrap text-slate-700" }, g.ke_hoach || "—"),
                h("div", { className: "text-slate-500" }, "Dự kiến thu tháng " + (g.thang_du_kien || "—")),
                g.nhan_xet && h("div", { className: "text-slate-500" }, h("b", null, "Nhận xét QL: "), g.nhan_xet)))))),
          h("div", { className: "min-w-0 xl:col-span-2" },
            h(UI.Panel, { title: "Hóa đơn quá hạn trên mức an toàn (A2–A4)", subtitle: det ? hd.length + " hóa đơn · triệu đồng" : null },
              err ? h("div", { className: "p-4" }, h(UI.ErrorBox, null, err))
                : !det ? h(UI.LoadingBlock, null)
                : h("div", { className: "scroll-shadow max-h-[calc(100vh-330px)] min-h-[260px] overflow-auto" }, h("table", { className: T.table },
                    h("thead", { className: "sticky top-0" }, h("tr", { className: T.headRow },
                      ["Số HĐ", "Ngày HĐ", "Đến hạn", "Quá hạn", "Nhóm", "Sale", "Còn nợ", "Chứng từ"].map((x, i) => h("th", { key: x, className: T.th(i === 3 || i === 6) }, x)))),
                    h("tbody", null, hd.map((r, i) => h("tr", { key: i, className: T.row(i) },
                      h("td", { className: T.td + " whitespace-nowrap" }, r.so_hd),
                      h("td", { className: T.td + " whitespace-nowrap" }, fmtDate(r.ngay_hd)),
                      h("td", { className: T.td + " whitespace-nowrap" }, fmtDate(r.ngay_den_han)),
                      h("td", { className: T.num }, r.so_ngay_qua_han + " ng"),
                      h("td", { className: T.td }, h(UI.Badge, { tone: D.NHOM_GT.includes(r.nhom_no) ? "red" : "amber" }, r.nhom_no)),
                      h("td", { className: T.td + " whitespace-nowrap text-[11px]" }, r.ten_nv),
                      h("td", { className: T.num }, fmtTr(r.con_no, 1)),
                      (() => {
                        const ct = [r.bbbg, r.hop_dong_ban, r.khong_chung_tu ? "Thiếu BBBG/ĐCCN" : null, r.ghi_chu].filter(Boolean).join(" · ") || "—";
                        return h("td", { className: T.td + " min-w-[200px] text-[11px] text-slate-500", title: ct }, ct);
                      })())))))),
            det && det.log.length > 0 && h(UI.Panel, { title: "Lịch sử thao tác", className: "mt-4" },
              h("div", { className: "max-h-48 divide-y divide-slate-100 overflow-y-auto" }, det.log.map((l) => h("div", { key: l.id, className: "flex gap-3 px-4 py-1.5 text-[12px]" },
                h("span", { className: "w-32 shrink-0 text-slate-400" }, new Date(l.luc).toLocaleString("vi-VN")),
                h("span", { className: "w-20 shrink-0 font-medium" }, ACTION_LABEL[l.hanh_dong] || l.hanh_dong),
                h("span", { className: "text-slate-600" }, l.nguoi, l.hanh_dong === "tra_lai" && l.noi_dung && l.noi_dung.nhan_xet ? " — " + l.noi_dung.nhan_xet : "")))))))));
  }

  // ── Xuất Excel danh sách giải trình ───────────────────────────────
  function exportExcel(list, meta) {
    const rows = list.map((k, i) => ({
      "STT": i + 1, "Mã KH": k.ma_kh, "Khách hàng": k.ten_kh, "Tên KH (kế toán)": k.ten_kh_goc, "Sale": k.ten_nv, "BU": k.nganh.map(UI.buName).join(", "), "Nhóm KH": k.loai_hinh,
      "A2–A4 (tr)": Math.round(k.qua_han / 1e5) / 10, "A2–A4 kỳ trước (tr)": Math.round(k.prev_qua_han / 1e5) / 10,
      "Tổng dư nợ (tr)": Math.round(k.tong / 1e5) / 10, "Thu trong tháng (tr)": Math.round(k.thu / 1e5) / 10,
      "Quá hạn lâu nhất (ngày)": k.max_ngay, "Trạng thái": D.TRANG_THAI[k.trang_thai].label + (k.can_cap_nhat ? " (cần cập nhật)" : ""),
      "Giải trình & kế hoạch xử lý": k.gt ? k.gt.ke_hoach : "", "Tháng dự kiến thu": k.gt ? k.gt.thang_du_kien || "" : "",
      "Nhận xét quản lý": k.gt ? k.gt.nhan_xet : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [5, 10, 30, 45, 22, 18, 14, 10, 10, 10, 10, 10, 14, 60, 12, 30].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Giai trinh " + meta.ky);
    XLSX.writeFile(wb, "Giai_trinh_cong_no_" + meta.ky + ".xlsx");
  }

  // ── Màn chính ─────────────────────────────────────────────────────
  function List({ data, f, patchGt, kyMeta }) {
    const q = R.useQuery();
    const tt = q.get("tt") || "all";
    const [search, setSearch] = useState(q.get("q") || "");
    const [open, setOpen] = useState(null);
    const khach = useMemo(() => D.buildKhach(data, f), [data, f.nganh.join(), f.nv.join(), f.loai.join()]);
    const need = khach.filter((k) => k.can_gt);
    const canEditKeys = data.can_edit_keys === undefined ? [] : data.can_edit_keys; // null = admin/manager sửa tất cả
    const approveNv = new Set(data.can_approve_nv || []);
    const isMine = (k) => canEditKeys == null || canEditKeys.includes(k.key);

    const counts = { all: need.length };
    for (const k of need) { counts[k.trang_thai] = (counts[k.trang_thai] || 0) + 1; if (k.can_cap_nhat) counts.can_cap_nhat = (counts.can_cap_nhat || 0) + 1; }
    const s = UI.deaccent(search.trim());
    const list = need.filter((k) => (tt === "all" || k.trang_thai === tt || (tt === "can_cap_nhat" && k.can_cap_nhat)) && (!s || UI.deaccent(k.ten_kh + " " + (k.ten_kh_goc || "") + " " + k.ten_nv + " " + k.ma_kh).includes(s)));
    const han = D.hanInfo(data.meta.han_giai_trinh);
    const sel = open && khach.find((k) => k.key === open);

    return h("div", { className: "flex flex-col gap-3" },
      data.meta.han_giai_trinh && h("div", { className: "flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] " + (han.days < 0 ? "border-red-200 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-800") },
        h(UI.I.Clock, { size: 14 }), "Hạn giải trình " + fmtKyLabel(data.meta.ky) + ": " + fmtDate(data.meta.han_giai_trinh) + " (" + han.text + ")",
        kyMeta && kyMeta.khoa && " · Kỳ đã khoá"),
      h("div", { className: "flex flex-wrap items-center gap-2" },
        h(UI.Segmented, { value: tt, onChange: (v) => R.setQuery({ tt: v === "all" ? "" : v }),
          options: [{ key: "all", label: "Tất cả", count: counts.all }, ...D.STATUS_LIST.map((st) => ({ key: st, label: D.TRANG_THAI[st].label, count: counts[st] || 0 })), { key: "can_cap_nhat", label: "Cần cập nhật", count: counts.can_cap_nhat || 0 }] }),
        h("div", { className: "flex-1" }),
        h(UI.SearchInput, { value: search, onChange: setSearch, placeholder: "Tìm khách hàng, sale…", className: "w-64" }),
        h("button", { type: "button", onClick: () => exportExcel(list, data.meta), className: btn.secondary }, h(UI.I.Download, { size: 14 }), "Xuất Excel")),

      list.length === 0 ? h(UI.Empty, null, need.length === 0 ? "Không có khách hàng nào có nợ A2–A4 trong phạm vi của bạn." : "Không có dòng phù hợp bộ lọc.")
      : h(UI.Panel, { title: "Khách hàng × BU phải giải trình (nợ A2–A4, tách theo người giải trình)", subtitle: list.length + " dòng · triệu đồng · bấm vào dòng để xem chi tiết và giải trình" },
          h("div", { className: "overflow-x-auto" }, h("table", { className: T.table },
            h("thead", null, h("tr", { className: T.headRow },
              ["Khách hàng", "Sale", "BU", "A2–A4", "+/- kỳ trước", "Tổng dư nợ", "Quá hạn lâu nhất", "Thu trong tháng", "Tháng dự kiến thu", "Trạng thái", ""]
                .map((x, i) => h("th", { key: i, className: "px-3 py-2 text-center align-middle font-semibold" + (i === 0 ? " min-w-[200px]" : i === 1 ? " min-w-[140px]" : "") }, x)))),
            h("tbody", null, list.map((k, i) => {
              const d = k.qua_han - k.prev_qua_han;
              const action = isMine(k) && (k.trang_thai === "chua" || (!D.PHE_DUYET && !(kyMeta && kyMeta.khoa)) || ["nhap", "tra_lai"].includes(k.trang_thai)) ? (k.trang_thai === "chua" ? "Giải trình" : "Sửa")
                : k.nv.some((nv) => approveNv.has(nv)) && k.trang_thai === "cho_duyet" ? "Duyệt" : "Xem";
              return h("tr", { key: k.key, className: T.row(i) + " cursor-pointer", onClick: () => setOpen(k.key) },
                h("td", { className: T.td + " max-w-[300px] whitespace-nowrap" }, h("div", { className: "truncate font-medium text-slate-800", title: k.ten_kh + (k.ten_kh_goc && k.ten_kh_goc !== k.ten_kh ? "\n" + k.ten_kh_goc : "") }, k.ten_kh), h("div", { className: "text-[11px] text-slate-400" }, k.ma_kh + " · " + (k.loai_hinh || ""))),
                h("td", { className: T.td + " max-w-[200px] text-[12px]" }, k.nv.map((nv) => h("div", { key: nv }, nv)),
                  k.nhom_gt.startsWith("am:") && h("div", { className: "mt-0.5 text-[11px] text-slate-400" }, "GT: " + k.nhom_label)),
                h("td", { className: T.td + " text-[12px] text-slate-500" }, k.nganh.map((n) => h("div", { key: n, className: "whitespace-nowrap" }, UI.buName(n)))),
                h("td", { className: T.num + " font-semibold text-red-700" }, fmtTr(k.qua_han)),
                h("td", { className: T.num + (d > 0.5e6 ? " text-red-600" : d < -0.5e6 ? " text-green-700" : " text-slate-400") }, (d > 0 ? "+" : "") + fmtTr(d)),
                h("td", { className: T.num }, fmtTr(k.tong)),
                h("td", { className: T.num }, k.max_ngay + " ng"),
                h("td", { className: T.num }, fmtTr(k.thu)),
                h("td", { className: T.td + " whitespace-nowrap text-[12px]" }, k.gt && k.gt.thang_du_kien
                  ? k.gt.thang_du_kien
                  : h("span", { className: "text-slate-300" }, "—")),
                h("td", { className: T.td }, h("div", { className: "flex flex-col items-start gap-1" }, h(D.StatusBadge, { st: k.trang_thai }),
                  k.can_cap_nhat && h(UI.Badge, { tone: "amber", title: k.gt.du_no_qua_han != null ? "A2–A4 lúc lưu " + fmtTr(k.gt.du_no_qua_han) + " tr, hiện " + fmtTr(k.qua_han) + " tr" : "Số A2–A4 đã thay đổi so với lúc lưu" }, "Cần cập nhật"))),
                h("td", { className: T.td }, h("span", { className: "whitespace-nowrap text-[12px] " + (action === "Xem" ? "text-slate-400" : "font-semibold text-blue-600") }, action)));
            }))))),

      sel && h(KhachModal, {
        k: sel, data, kyMeta, onClose: () => setOpen(null), onSaved: patchGt,
        canEdit: isMine(sel), canApprove: sel.nv.some((nv) => approveNv.has(nv)),
      }));
  }

  function GiaiTrinh() {
    return h(D.KyScreen, null, (ctx) => h(List, ctx));
  }

  R.register("/giai-trinh", GiaiTrinh);
  window.DEBT_GT = { KhachModal }; // bảng Tổng hợp A1–A4 mở popup giải trình trực tiếp
})();
