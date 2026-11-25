// Giải trình: danh sách KH × sale có nợ phải giải trình (A2–A4; từ kỳ áp dụng là A1–A4), sale nhập giải trình, quản lý duyệt / trả lại.
(function () {
  const { useState, useMemo, useEffect, useRef } = React;
  const h = React.createElement;
  const UI = window.DEBT_UI;
  const D = window.DEBT_DATA;
  const R = window.DEBT_ROUTER;
  const { api, errorText } = window.DEBT_API;
  const C = window.DEBT_CONFIG;
  const { T, fmtTr, fmtPct, fmtDate, fmtKyLabel, btn } = UI;

  const ACTION_LABEL = { luu: "Lưu nháp", gui: window.DEBT_CONFIG.PHE_DUYET ? "Gửi duyệt" : "Lưu giải trình", duyet: "Duyệt", tra_lai: "Trả lại" };

  // Hóa đơn hiện trong popup: A1–A4 (A1 bắt buộc giải trình hay không tùy kỳ, xem D.nhomGt).
  const HD_GT = ["A1", "A2", "A3", "A4"];
  // Khoá hóa đơn để lưu danh sách đã tích chọn: số HĐ | ngày HĐ | đến hạn, trùng thì thêm #n theo thứ tự hiện.
  // Phải khớp hdKeys() trong supabase/functions/debt-api/index.ts.
  function hdKeys(rows) {
    const seen = new Map();
    return rows.map((r) => {
      const base = [r.so_hd ?? "", r.ngay_hd ?? "", r.ngay_den_han ?? ""].join("|");
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return n > 1 ? base + "#" + n : base;
    });
  }
  // Tổng tiền dự kiến thu đã lưu (triệu đồng) — dùng ở lịch sử các kỳ.
  const tienThuText = (gt) => (gt && gt.so_tien_du_kien != null ? fmtTr(gt.so_tien_du_kien, 1) + " tr" : "");
  const NHOM_TEN = { A4: "A4 – quá hạn > 2 năm", A3: "A3 – quá hạn 1–2 năm", A2: "A2 – quá hạn trên mức an toàn, < 1 năm", A1: "A1 – quá hạn trong mức an toàn" };
  // Nhóm nợ đơn vị đang có (A4 → A1). Nhóm bắt buộc: G = D.nhomGt(kỳ); đơn vị không có nhóm nào trong G (chỉ có A1) thì A1 bắt buộc.
  const nhomsOf = (k) => D.NHOM_GT_ORDER.filter((n) => (k[n] || 0) > 0.5);
  const batBuoc = (G, nhoms, n) => G.includes(n) || !nhoms.some((x) => G.includes(x));
  // Màu theo mức độ: A2–A4 đỏ, A1 vàng (không phụ thuộc bắt buộc hay không).
  const isTrenAT = (n) => D.NHOM_TREN_AT.includes(n);

  // ── Form giải trình + duyệt ───────────────────────────────────────
  // Ô tổng tiền các hóa đơn đang tích chọn của 1 nhóm nợ; server tự cộng lại theo hóa đơn khi lưu.
  function TongChon({ pick, editable, n }) {
    const choseAll = editable && pick && pick.total > 0 && pick.n < pick.total
      && h("button", { type: "button", onClick: pick.selectAll, className: "shrink-0 text-[12px] font-medium text-blue-700 hover:underline" }, "Chọn hết hóa đơn " + n);
    if (!pick || !pick.n) return h("div", { className: "flex items-center gap-3 rounded-md border border-dashed border-slate-300 px-3 py-2 text-[12px] text-slate-400" },
      h("span", { className: "flex-1" }, pick && pick.saved != null
        ? h(React.Fragment, null, "Đã lưu tổng tiền thu ", h("b", { className: "text-slate-600" }, fmtTr(pick.saved, 1) + " tr"), " (hóa đơn đã chọn không còn trong dữ liệu hiện tại).")
        : editable ? "Tích chọn hóa đơn " + n + " bên phải để tính tổng tiền dự kiến thu." : "Chưa chọn hóa đơn dự kiến thu."),
      choseAll);
    return h("div", { className: "flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2" },
      h("div", { className: "min-w-0 flex-1" },
        h("div", { className: "text-[10px] font-semibold uppercase tracking-wide text-blue-700" }, "Tổng tiền thu · " + pick.n + "/" + pick.total + " hóa đơn " + n),
        h("div", { className: "text-[17px] font-bold tabular-nums text-blue-800" }, fmtTr(pick.sum, 1) + " tr",
          h("span", { className: "ml-2 text-[12px] font-normal text-blue-700" }, "(" + UI.fmtInt(Math.round(pick.sum)) + " đ)"))),
      h("div", { className: "flex shrink-0 flex-col items-end gap-1" }, choseAll,
        editable && h("button", { type: "button", onClick: pick.clear, className: "text-[12px] text-blue-700 hover:underline" }, "Bỏ chọn")));
  }

  // Nội dung ban đầu từng nhóm: giải trình kỳ này (theo nhóm; bản chung → nhóm cao nhất),
  // không có thì điền sẵn nội dung kỳ trước. Tháng dự kiến thu không kế thừa: mỗi kỳ phải chọn lại.
  function initSections(k, nhoms, G) {
    const gt = k.gt, prev = !gt && k.gt_prev;
    const top = nhoms.find((n) => G.includes(n)) || nhoms[0];
    const out = {};
    for (const n of nhoms) {
      let ke_hoach = "", thang = "";
      if (gt) {
        const sec = D.secOf(gt, n);
        if (sec) { ke_hoach = sec.ke_hoach || ""; thang = sec.thang_du_kien || ""; }
        else if (D.isLegacyGt(gt) && n === top) { ke_hoach = gt.ke_hoach || ""; thang = gt.thang_du_kien || ""; }
      } else if (prev) {
        const sec = D.secOf(prev, n);
        if (sec) ke_hoach = sec.ke_hoach || "";
        else if (D.isLegacyGt(prev) && n === top) ke_hoach = prev.ke_hoach || "";
      }
      out[n] = { ke_hoach, thang_du_kien: thang };
    }
    return out;
  }

  function GiaiTrinhForm({ k, data, kyMeta, onSaved, canEdit, canApprove, picks }) {
    const gt = k.gt;
    const prefill = !gt && k.gt_prev;
    const nhoms = nhomsOf(k);
    const G = D.nhomGt(data.meta.ky), L = D.gtLabel(data.meta.ky);
    const [secs, setSecs] = useState(() => initSections(k, nhoms, G));
    const [nhanXet, setNhanXet] = useState("");
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);
    const st = k.trang_thai;
    const locked = kyMeta && kyMeta.khoa;
    // Không duyệt: sửa lại được tới khi khoá kỳ.
    const editable = canEdit && !locked && (!D.PHE_DUYET || ["chua", "nhap", "tra_lai"].includes(st));
    const set = (n, key) => (e) => { const v = e.target.value; setSecs((s) => ({ ...s, [n]: { ...(s[n] || {}), [key]: v } })); };

    const save = async (submit) => {
      setBusy(true); setMsg(null);
      const theo_nhom = {};
      for (const n of nhoms) theo_nhom[n] = { ...(secs[n] || {}), hd_chon: picks && picks[n] ? picks[n].keys : [] };
      try {
        const r = await api("save_gt", { ky: data.meta.ky, ma_kh: k.ma_kh, nganh_hang: k.nganh_hang, nhom_gt: k.nhom_gt, submit, fields: { ten_kh: k.ten_kh, theo_nhom } });
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
    const legacy = D.isLegacyGt(gt);
    // 1 phần giải trình của 1 nhóm nợ
    const Section = (n) => {
      const req = batBuoc(G, nhoms, n);
      const sec = D.secOf(gt, n);
      return h("div", { key: n, className: "flex flex-col gap-2.5 rounded-md border " + (isTrenAT(n) ? "border-red-200" : "border-amber-200") + " p-3" },
        h("div", { className: "flex flex-wrap items-center gap-2" },
          h(UI.Badge, { tone: isTrenAT(n) ? "red" : "amber" }, n),
          h("span", { className: "text-[12px] font-semibold text-slate-700" }, NHOM_TEN[n].slice(5)),
          h("span", { className: "ml-auto text-[12px] tabular-nums text-slate-500" }, "Còn nợ " + fmtTr(k[n], 1) + " tr"),
          !req && h("span", { className: "text-[11px] text-slate-400" }, "· không bắt buộc")),
        editable
          ? h(React.Fragment, null,
              h("label", null, h("span", { className: UI.fieldLabel }, "Giải trình & kế hoạch xử lý" + (req ? " *" : "")),
                h("textarea", { rows: 3, value: (secs[n] || {}).ke_hoach || "", onChange: set(n, "ke_hoach"), className: UI.input,
                  placeholder: "Lý do quá hạn, tình trạng hồ sơ, việc cần làm, ai làm, khi nào…" })),
              h(TongChon, { pick: picks && picks[n], editable: true, n }),
              h("label", { className: "md:w-1/2" }, h("span", { className: UI.fieldLabel }, "Tháng dự kiến thu" + (req ? " *" : "")),
                h("input", { type: "month", value: (secs[n] || {}).thang_du_kien || "", onChange: set(n, "thang_du_kien"), className: UI.input, min: data.meta.ky, placeholder: "yyyy-mm" })))
          : h(React.Fragment, null,
              ro("Giải trình & kế hoạch xử lý", sec && sec.ke_hoach),
              h(TongChon, { pick: picks && picks[n], editable: false, n }),
              ro("Tháng dự kiến thu", sec && sec.thang_du_kien)));
    };

    return h("div", { className: "flex flex-col gap-3" },
      h("div", { className: "flex flex-wrap items-center gap-2" },
        !k.can_gt && st === "chua" ? h(UI.Badge, { tone: "grey" }, "Không bắt buộc") : h(D.StatusBadge, { st }),
        gt && gt.nguoi_cap_nhat && st !== "chua" && h("span", { className: "text-[11px] text-slate-400" }, "Cập nhật bởi " + gt.nguoi_cap_nhat + " lúc " + new Date(gt.cap_nhat_luc).toLocaleString("vi-VN")),
        gt && gt.nguoi_duyet && h("span", { className: "text-[11px] text-slate-400" }, "· " + (st === "da_duyet" ? "Duyệt" : "Xử lý") + " bởi " + gt.nguoi_duyet),
        locked && h(UI.Badge, { tone: "grey" }, "Kỳ đã khoá")),
      gt && gt.nhan_xet && h("div", { className: "rounded-md border px-3 py-2 text-[13px] " + (st === "tra_lai" ? "border-red-200 bg-red-50 text-red-800" : "border-slate-200 bg-slate-50 text-slate-700") },
        h("b", null, "Nhận xét của quản lý: "), gt.nhan_xet),
      k.can_cap_nhat && h("div", { className: "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900" },
        h("b", null, "Cần cập nhật: "), (gt && gt.theo_nhom && nhoms.some((n) => G.includes(n) && !(gt.theo_nhom[n] && gt.theo_nhom[n].ke_hoach))
          ? "có nhóm nợ " + L + " chưa có giải trình"
          : k.gt.du_no_qua_han != null
            ? "giải trình viết khi " + L + " là " + fmtTr(k.gt.du_no_qua_han, 1) + " tr, số hiện tại " + fmtTr(k.qua_han, 1) + " tr"
            : "số " + L + " đã thay đổi đáng kể so với lúc lưu giải trình") + " (dữ liệu đã nạp lại). Sửa và lưu lại để xác nhận."),
      !k.can_gt && h("div", { className: "rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600" },
        "Khách hàng chỉ có nợ A1 (quá hạn trong mức an toàn): giải trình không bắt buộc, không tính vào tiến độ giải trình."),
      prefill && editable && h("div", { className: "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800" },
        "Đã điền sẵn giải trình " + fmtKyLabel(k.gt_prev.ky) + " theo nhóm nợ. Cập nhật tiến độ và chọn lại tháng dự kiến thu."),
      legacy && h("div", { className: "rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600" },
        editable ? "Giải trình này lưu trước khi tách theo nhóm nợ: nội dung đã đưa vào nhóm cao nhất. Bổ sung các nhóm còn lại và lưu lại."
          : h(React.Fragment, null, h("b", null, "Giải trình chung (trước khi tách theo nhóm): "), gt.ke_hoach || "—", " · tháng " + (gt.thang_du_kien || "—"))),
      nhoms.length > 1 && editable && h("div", { className: "text-[11px] text-slate-500" }, "Mỗi nhóm nợ giải trình riêng: nội dung, tháng dự kiến thu và hóa đơn dự kiến thu của nhóm đó."),

      ...nhoms.map(Section),

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

  // Ô tích chọn có trạng thái "một phần" (indeterminate).
  function TriCheck({ on, some, onChange, title, disabled, cls }) {
    const ref = useRef(null);
    useEffect(() => { if (ref.current) ref.current.indeterminate = !!some && !on; });
    return h("input", { type: "checkbox", ref, checked: !!on, onChange, disabled, className: cls, title, "aria-label": title });
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

    const hd = det ? det.hoa_don.filter((r) => HD_GT.includes(r.nhom_no)) : [];
    // Tích chọn hóa đơn → tổng tiền thu của nhóm nợ chứa hóa đơn đó. Khoá hóa đơn giống debt-api; giữ khi tải lại sau lưu.
    const [chon, setChon] = useState(() => new Set());
    const keys = hdKeys(hd);
    // Lần đầu tải hóa đơn: tích lại các hóa đơn đã chọn lúc lưu giải trình.
    const initRef = useRef(false);
    useEffect(() => {
      if (!det || initRef.current) return;
      initRef.current = true;
      const g = k.gt;
      const saved0 = g ? (g.theo_nhom ? Object.values(g.theo_nhom).flatMap((x) => (x && x.hd_chon) || []) : g.hd_chon || []) : [];
      if (saved0.length) setChon(new Set(saved0));
    }, [det]);
    const setMany = (list, on) => setChon((s) => { const n = new Set(s); for (const x of list) { if (on) n.add(x); else n.delete(x); } return n; });
    const toggle = (key) => setChon((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
    const nChon = keys.filter((x) => chon.has(x)).length;
    const allOn = hd.length > 0 && nChon === hd.length;
    // Theo nhóm nợ: danh sách khoá, số đã chọn, tổng tiền
    const byNhom = {};
    hd.forEach((r, i) => { (byNhom[r.nhom_no] = byNhom[r.nhom_no] || []).push({ r, key: keys[i] }); });
    const picks = {};
    for (const n of D.NHOM_GT_ORDER) {
      const list = byNhom[n] || [];
      const sel = list.filter((x) => chon.has(x.key));
      const sec = D.secOf(k.gt, n);
      const savedKeys = sec ? sec.hd_chon || [] : [];
      picks[n] = {
        n: sel.length, total: list.length, keys: sel.map((x) => x.key), sum: sel.reduce((t, x) => t + (Number(x.r.con_no) || 0), 0),
        saved: sec && sec.so_tien != null && !savedKeys.some((x) => keys.includes(x)) ? sec.so_tien : null,
        clear: () => setMany(list.map((x) => x.key), false), selectAll: () => setMany(list.map((x) => x.key), true),
      };
    }
    const sumChon = D.NHOM_GT_ORDER.reduce((t, n) => t + picks[n].sum, 0);
    const cb = "h-4 w-4 cursor-pointer accent-blue-600 align-middle";
    const lichSu = det ? det.lich_su.filter((g) => g.ky !== data.meta.ky) : [];
    const stat = (label, v, cls = "") => h("div", { className: "rounded-md border border-slate-200 bg-white px-3 py-2" },
      h("div", { className: "text-[10px] uppercase tracking-wide text-slate-400" }, label), h("div", { className: "text-[15px] font-semibold tabular-nums " + cls }, v));
    const nCol = 9;
    const L = D.gtLabel(data.meta.ky), a1Req = D.a1BatBuoc(data.meta.ky);

    return h(UI.Modal, { open: true, onClose, width: 1480, title: k.ten_kh + " · " + UI.buName(k.nganh_hang) + "  ·  người giải trình: " + (k.nhom_label || "—") + "  (sale: " + k.ten_nv + ")" },
      h("div", { className: "flex max-h-[calc(100vh-110px)] flex-col gap-4 overflow-y-auto p-4" },
        h("div", { className: "grid grid-cols-2 gap-2 md:grid-cols-6" },
          stat(L + " (tr)", fmtTr(k.qua_han), "text-red-700"),
          stat(a1Req ? "Trong đó A1 (tr)" : "A1 (tr) · không bắt buộc", fmtTr(k.A1), "text-amber-700"),
          stat("Kỳ trước " + L + " · +/-", h(React.Fragment, null, fmtTr(k.prev_qua_han), h("span", { className: "ml-2 text-[13px]" }, h(UI.Delta, { v: k.qua_han - k.prev_qua_han })))),
          stat("Tổng dư nợ (tr)", fmtTr(k.tong)),
          stat("Thu trong tháng (tr)", fmtTr(k.thu)),
          stat("Quá hạn lâu nhất", k.max_ngay + " ngày")),
        k.gt_prev && k.gt_prev.thang_du_kien && h("div", { className: "rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600" },
          "Giải trình " + fmtKyLabel(k.gt_prev.ky) + " dự kiến thu tháng ", h("b", null, D.gtLines(k.gt_prev).map((x) => (x.n ? x.n + ": " : "") + (x.thang_du_kien || "—")).join(", ")),
          " · Thực thu " + fmtKyLabel(data.meta.ky) + ": ", h("b", null, fmtTr(k.thu, 1) + " tr"),
          " · " + L + " thay đổi: ", h("b", null, h(UI.Delta, { v: k.qua_han - k.prev_qua_han, digits: 1, suffix: " tr" }))),

        h("div", { className: "grid gap-4 xl:grid-cols-5" },
          h("div", { className: "min-w-0 xl:col-span-2" },
            h(UI.Panel, { title: "Giải trình " + fmtKyLabel(data.meta.ky) + " theo nhóm nợ" },
              h("div", { className: "p-4" }, h(GiaiTrinhForm, { k, data, kyMeta, onSaved: saved, canEdit, canApprove, picks }))),
            lichSu.length > 0 && h(UI.Panel, { title: "Giải trình các kỳ trước", className: "mt-4" },
              h("div", { className: "divide-y divide-slate-100" }, lichSu.map((g) => h("div", { key: g.id, className: "px-4 py-2 text-[12px]" },
                h("div", { className: "mb-1 flex items-center gap-2" }, h("b", null, fmtKyLabel(g.ky)), h(D.StatusBadge, { st: D.stOf(g) }),
                  g.du_no_qua_han != null && h("span", { className: "text-slate-400" }, D.gtLabel(g.ky) + " lúc gửi: " + fmtTr(g.du_no_qua_han) + " tr")),
                D.gtLines(g).map((x, i) => h("div", { key: i, className: "mb-1" },
                  h("div", { className: "whitespace-pre-wrap text-slate-700" }, x.n && h("b", { className: "mr-1" }, x.n + ":"), x.ke_hoach || "—"),
                  h("div", { className: "text-slate-500" }, "Dự kiến thu tháng " + (x.thang_du_kien || "—") + (x.so_tien != null ? " · " + fmtTr(x.so_tien, 1) + " tr" : "")))),
                g.nhan_xet && h("div", { className: "text-slate-500" }, h("b", null, "Nhận xét QL: "), g.nhan_xet)))))),
          h("div", { className: "min-w-0 xl:col-span-3" },
            h(UI.Panel, { title: "Hóa đơn quá hạn (A1–A4)" + (a1Req ? "" : " · A1 không bắt buộc giải trình"),
              subtitle: det ? hd.length + " hóa đơn · triệu đồng · tích hóa đơn để tính tiền thu của nhóm nợ đó" + (nChon ? " · đã chọn " + nChon + " (" + fmtTr(sumChon, 1) + " tr)" : "") : null },
              err ? h("div", { className: "p-4" }, h(UI.ErrorBox, null, err))
                : !det ? h(UI.LoadingBlock, null)
                : h("div", { className: "scroll-shadow max-h-[calc(100vh-330px)] min-h-[260px] overflow-auto" }, h("table", { className: T.table },
                    h("thead", { className: "sticky top-0 z-[1]" }, h("tr", { className: T.headRow },
                      h("th", { className: "w-9 bg-slate-50 px-3 py-2 text-center" },
                        h(TriCheck, { on: allOn, some: nChon > 0, onChange: () => setMany(keys, !allOn), disabled: !hd.length, cls: cb, title: allOn ? "Bỏ chọn tất cả" : "Chọn tất cả hóa đơn" })),
                      ["Số HĐ", "Ngày HĐ", "Đến hạn", "Quá hạn", "Nhóm", "Sale", "Còn nợ", "Chứng từ"].map((x, i) => h("th", { key: x, className: T.th(i === 3 || i === 6) + " bg-slate-50" }, x)))),
                    h("tbody", null, D.NHOM_GT_ORDER.filter((n) => byNhom[n]).flatMap((n) => {
                      const list = byNhom[n], p = picks[n];
                      const tong = list.reduce((t, x) => t + (Number(x.r.con_no) || 0), 0);
                      return [
                        h("tr", { key: "g" + n, className: "border-t border-slate-200 " + (isTrenAT(n) ? "bg-red-50/60" : "bg-amber-50/60") },
                          h("td", { className: "px-3 py-1.5 text-center" },
                            h(TriCheck, { on: p.n === p.total, some: p.n > 0, onChange: () => (p.n === p.total ? p.clear() : p.selectAll()), cls: cb, title: "Chọn tất cả hóa đơn " + n })),
                          h("td", { colSpan: 6, className: "px-3 py-1.5 text-[12px] font-semibold text-slate-700" }, NHOM_TEN[n] + " · " + list.length + " hóa đơn",
                            p.n > 0 && h("span", { className: "ml-2 font-normal text-blue-700" }, "· đã chọn " + p.n + " (" + fmtTr(p.sum, 1) + " tr)")),
                          h("td", { className: T.num + " py-1.5 font-semibold" }, fmtTr(tong, 1)), h("td", null)),
                        ...list.map(({ r, key }, i) => h("tr", { key, onClick: () => toggle(key),
                          className: "cursor-pointer " + (chon.has(key) ? "bg-blue-50 hover:bg-blue-100/60" : T.row(i)) },
                          h("td", { className: "px-3 py-2 text-center", onClick: (e) => e.stopPropagation() },
                            h("input", { type: "checkbox", checked: chon.has(key), onChange: () => toggle(key), className: cb, "aria-label": "Chọn hóa đơn " + (r.so_hd || i + 1) })),
                          h("td", { className: T.td + " whitespace-nowrap" }, r.so_hd),
                          h("td", { className: T.td + " whitespace-nowrap" }, fmtDate(r.ngay_hd)),
                          h("td", { className: T.td + " whitespace-nowrap" }, fmtDate(r.ngay_den_han)),
                          h("td", { className: T.num }, r.so_ngay_qua_han + " ng"),
                          h("td", { className: T.td }, h(UI.Badge, { tone: isTrenAT(r.nhom_no) ? "red" : "amber" }, r.nhom_no)),
                          h("td", { className: T.td + " whitespace-nowrap text-[11px]" }, r.ten_nv),
                          h("td", { className: T.num }, fmtTr(r.con_no, 1)),
                          (() => {
                            const ct = [r.bbbg, r.hop_dong_ban, r.khong_chung_tu ? "Thiếu BBBG/ĐCCN" : null, r.ghi_chu].filter(Boolean).join(" · ") || "—";
                            return h("td", { className: T.td + " min-w-[200px] text-[11px] text-slate-500", title: ct }, ct);
                          })()))];
                    }),
                    !hd.length && h("tr", null, h("td", { colSpan: nCol, className: "px-4 py-8 text-center text-slate-400" }, "Không có hóa đơn A1–A4")))))),
            det && det.log.length > 0 && h(UI.Panel, { title: "Lịch sử thao tác", className: "mt-4" },
              h("div", { className: "max-h-48 divide-y divide-slate-100 overflow-y-auto" }, det.log.map((l) => h("div", { key: l.id, className: "flex gap-3 px-4 py-1.5 text-[12px]" },
                h("span", { className: "w-32 shrink-0 text-slate-400" }, new Date(l.luc).toLocaleString("vi-VN")),
                h("span", { className: "w-20 shrink-0 font-medium" }, ACTION_LABEL[l.hanh_dong] || l.hanh_dong),
                h("span", { className: "text-slate-600" }, l.nguoi, l.hanh_dong === "tra_lai" && l.noi_dung && l.noi_dung.nhan_xet ? " — " + l.noi_dung.nhan_xet : "")))))))));
  }

  // ── Xuất Excel danh sách giải trình ───────────────────────────────
  function exportExcel(list, meta) {
    const L = D.gtLabel(meta.ky);
    const rows = list.map((k, i) => ({
      "STT": i + 1, "Mã KH": k.ma_kh, "Khách hàng": k.ten_kh, "Tên KH (kế toán)": k.ten_kh_goc, "Sale": k.ten_nv, "BU": k.nganh.map(UI.buName).join(", "), "Nhóm KH": k.loai_hinh,
      [L + " (tr)"]: Math.round(k.qua_han / 1e5) / 10, [L + " kỳ trước (tr)"]: Math.round(k.prev_qua_han / 1e5) / 10,
      "Tổng dư nợ (tr)": Math.round(k.tong / 1e5) / 10, "Thu trong tháng (tr)": Math.round(k.thu / 1e5) / 10,
      "Quá hạn lâu nhất (ngày)": k.max_ngay, "Trạng thái": D.TRANG_THAI[k.trang_thai].label + (k.can_cap_nhat ? " (cần cập nhật)" : ""),
      "Giải trình & kế hoạch xử lý": k.gt ? k.gt.ke_hoach : "", "Tháng dự kiến thu": k.gt ? D.gtLines(k.gt).filter((x) => x.thang_du_kien).map((x) => (x.n ? x.n + ": " : "") + x.thang_du_kien).join("; ") : "",
      "Tiền dự kiến thu (tr)": k.gt && k.gt.so_tien_du_kien != null ? Math.round(k.gt.so_tien_du_kien / 1e5) / 10 : "",
      "Nhận xét quản lý": k.gt ? k.gt.nhan_xet : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [5, 10, 30, 45, 22, 18, 14, 10, 10, 10, 10, 10, 14, 60, 12, 12, 30].map((w) => ({ wch: w }));
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
    const khach = useMemo(() => D.buildKhach(data, f), [data, f.nganh.join(), f.mien.join(), f.nv.join(), f.loai.join()]);
    const need = khach.filter((k) => k.can_gt);
    // Đơn vị chỉ có nợ A1: giải trình không bắt buộc (tự nguyện), xem ở mục lọc "A1".
    const a1 = khach.filter((k) => !k.can_gt && (k.A1 || 0) > 0.5).sort((a, b) => b.A1 - a.A1);
    const isA1 = tt === "a1";
    const canEditKeys = data.can_edit_keys === undefined ? [] : data.can_edit_keys; // null = admin/manager sửa tất cả
    const approveNv = new Set(data.can_approve_nv || []);
    const isMine = (k) => canEditKeys == null || canEditKeys.includes(k.key);

    const counts = { all: need.length };
    for (const k of need) { counts[k.trang_thai] = (counts[k.trang_thai] || 0) + 1; if (k.can_cap_nhat) counts.can_cap_nhat = (counts.can_cap_nhat || 0) + 1; }
    const s = UI.deaccent(search.trim());
    const list = (isA1 ? a1 : need).filter((k) => (tt === "all" || isA1 || k.trang_thai === tt || (tt === "can_cap_nhat" && k.can_cap_nhat)) && (!s || UI.deaccent(k.ten_kh + " " + (k.ten_kh_goc || "") + " " + k.ten_nv + " " + k.ma_kh).includes(s)));
    const han = D.hanInfo(data.meta.han_giai_trinh);
    const sel = open && khach.find((k) => k.key === open);
    const L = D.gtLabel(data.meta.ky);

    return h("div", { className: "flex flex-col gap-3" },
      data.meta.han_giai_trinh && h("div", { className: "flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] " + (han.days < 0 ? "border-red-200 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-800") },
        h(UI.I.Clock, { size: 14 }), "Hạn giải trình " + fmtKyLabel(data.meta.ky) + ": " + fmtDate(data.meta.han_giai_trinh) + " (" + han.text + ")",
        kyMeta && kyMeta.khoa && " · Kỳ đã khoá"),
      h("div", { className: "flex flex-wrap items-center gap-2" },
        h(UI.Segmented, { value: tt, onChange: (v) => R.setQuery({ tt: v === "all" ? "" : v }),
          options: [{ key: "all", label: "Tất cả", count: counts.all }, ...D.STATUS_LIST.map((st) => ({ key: st, label: D.TRANG_THAI[st].label, count: counts[st] || 0 })), { key: "can_cap_nhat", label: "Cần cập nhật", count: counts.can_cap_nhat || 0 },
            ...(a1.length || isA1 ? [{ key: "a1", label: "Chỉ có A1 (không bắt buộc)", count: a1.length }] : [])] }),
        h("div", { className: "flex-1" }),
        h(UI.SearchInput, { value: search, onChange: setSearch, placeholder: "Tìm khách hàng, sale…", className: "w-64" }),
        h("button", { type: "button", onClick: () => exportExcel(list, data.meta), className: btn.secondary }, h(UI.I.Download, { size: 14 }), "Xuất Excel")),

      list.length === 0 ? h(UI.Empty, null, isA1 ? "Không có khách hàng nào chỉ có nợ A1." : need.length === 0 ? "Không có khách hàng nào có nợ " + L + " trong phạm vi của bạn." : "Không có dòng phù hợp bộ lọc.")
      : h(UI.Panel, { title: isA1 ? "Khách hàng × BU chỉ có nợ A1 (giải trình không bắt buộc, tách theo người giải trình)" : "Khách hàng × BU phải giải trình (nợ " + L + ", tách theo người giải trình)", subtitle: list.length + " dòng · triệu đồng · bấm vào dòng để xem chi tiết và giải trình" },
          h("div", { className: "overflow-x-auto" }, h("table", { className: T.table },
            h("thead", null, h("tr", { className: T.headRow },
              ["Khách hàng", "Sale", "BU", isA1 ? "A1" : L, isA1 ? "Tổng quá hạn kỳ trước" : "+/- kỳ trước", "Tổng dư nợ", "Quá hạn lâu nhất", "Thu trong tháng", "Tháng dự kiến thu", "Trạng thái", ""]
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
                isA1 ? h("td", { className: T.num + " font-semibold text-amber-700" }, fmtTr(k.A1)) : h("td", { className: T.num + " font-semibold text-red-700" }, fmtTr(k.qua_han)),
                isA1 ? h("td", { className: T.num + " text-slate-500" }, fmtTr(k.prev_qua_han)) : h("td", { className: T.num + " " + UI.deltaCls(d) }, (d > 0 ? "+" : "") + fmtTr(d)),
                h("td", { className: T.num }, fmtTr(k.tong)),
                h("td", { className: T.num }, k.max_ngay + " ng"),
                h("td", { className: T.num }, fmtTr(k.thu)),
                h("td", { className: T.td + " whitespace-nowrap text-[12px]" }, k.gt && k.trang_thai !== "chua" && D.gtLines(k.gt).some((x) => x.thang_du_kien)
                  ? D.gtLines(k.gt).filter((x) => x.thang_du_kien).map((x, j) => h("div", { key: j },
                      x.n && h("span", { className: "mr-1 text-slate-400" }, x.n + ":"), x.thang_du_kien,
                      x.so_tien != null && h("span", { className: "ml-1 text-[11px] text-slate-500" }, "· " + fmtTr(x.so_tien, 1) + " tr")))
                  : h("span", { className: "text-slate-300" }, "—")),
                h("td", { className: T.td }, h("div", { className: "flex flex-col items-start gap-1" },
                  !k.can_gt && k.trang_thai === "chua" ? h(UI.Badge, { tone: "grey" }, "Không bắt buộc") : h(D.StatusBadge, { st: k.trang_thai }),
                  k.can_cap_nhat && h(UI.Badge, { tone: "amber", title: k.gt.du_no_qua_han != null ? L + " lúc lưu " + fmtTr(k.gt.du_no_qua_han) + " tr, hiện " + fmtTr(k.qua_han) + " tr" : "Số " + L + " đã thay đổi so với lúc lưu" }, "Cần cập nhật"))),
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
