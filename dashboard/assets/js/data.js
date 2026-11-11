// Tải + tổng hợp số liệu 1 kỳ (client-side). Mọi màn dùng chung bộ lọc trên URL:
//   ky=2026-10 & nganh=CTCH & nv=<tên NV> & loai=<nhóm KH>
(function () {
  const { useState, useEffect, useMemo } = React;
  const h = React.createElement;
  const { api, errorText } = window.DEBT_API;
  const R = window.DEBT_ROUTER;
  const UI = window.DEBT_UI;
  const NHOM_GT = window.DEBT_CONFIG.NHOM_GIAI_TRINH;
  const NHOM = ["A0", "A1", "A2", "A3", "A4"];
  const NHOM_LABEL = {
    A0: "A0 – trong hạn", A1: "A1 – quá hạn trong mức an toàn", A2: "A2 – quá hạn trên mức an toàn, < 1 năm",
    A3: "A3 – quá hạn 1–2 năm", A4: "A4 – quá hạn > 2 năm",
  };
  const TRANG_THAI = {
    chua: { label: "Chưa giải trình", tone: "red" },
    nhap: { label: "Nháp", tone: "amber" },
    cho_duyet: { label: "Chờ duyệt", tone: "blue" },
    tra_lai: { label: "Bị trả lại", tone: "red" },
    da_duyet: { label: "Đã duyệt", tone: "green" },
    da_gt: { label: "Đã giải trình", tone: "green" },
  };
  const PHE_DUYET = !!window.DEBT_CONFIG.PHE_DUYET;
  // Danh sách trạng thái hiển thị + trạng thái "xong".
  const STATUS_LIST = PHE_DUYET ? ["chua", "nhap", "tra_lai", "cho_duyet", "da_duyet"] : ["chua", "da_gt"];
  const DONE = PHE_DUYET ? "da_duyet" : "da_gt";
  const STATUS_BG = { chua: "bg-red-500", nhap: "bg-amber-400", tra_lai: "bg-red-300", cho_duyet: "bg-blue-300", da_duyet: "bg-blue-600", da_gt: "bg-blue-600" };
  // Trạng thái giải trình lưu trong DB → trạng thái hiển thị.
  const stOf = (gt) => !gt ? "chua" : PHE_DUYET ? gt.trang_thai : (gt.trang_thai === "nhap" ? "chua" : "da_gt");
  // Giải trình viết theo số A2–A4 lúc lưu; số hiện tại lệch > 10% và > 10 triệu (vd sau khi nạp lại file) → "Cần cập nhật".
  const canCapNhat = (luc_luu, hien_tai) => luc_luu != null && Math.abs((hien_tai || 0) - luc_luu) > Math.max(10e6, 0.1 * Math.abs(luc_luu));

  // ── Cache theo kỳ; Reload trên header xoá cache ──
  const cache = new Map();
  let kyListCache = null;
  function invalidate() { cache.clear(); kyListCache = null; }

  function useKyList() {
    const nonce = UI.useReload();
    const [st, setSt] = useState({ rows: kyListCache, error: null });
    useEffect(() => {
      let alive = true;
      if (kyListCache) { setSt({ rows: kyListCache, error: null }); return; }
      api("list_ky").then((r) => { kyListCache = r.rows; if (alive) setSt({ rows: r.rows, error: null }); })
        .catch((e) => alive && setSt({ rows: null, error: errorText(e.message) }));
      return () => { alive = false; };
    }, [nonce]);
    return st;
  }

  function useKyData(ky) {
    const nonce = UI.useReload();
    const [tick, setTick] = useState(0);
    const [st, setSt] = useState({ data: ky ? cache.get(ky) : null, error: null, loading: false });
    useEffect(() => {
      if (!ky) return;
      let alive = true;
      const hit = cache.get(ky);
      if (hit) { setSt({ data: hit, error: null, loading: false }); return; }
      setSt((s) => ({ ...s, loading: true, error: null }));
      api("get_ky", { ky }).then((r) => { cache.set(ky, r); if (alive) setSt({ data: r, error: null, loading: false }); })
        .catch((e) => alive && setSt({ data: null, error: errorText(e.message), loading: false }));
      return () => { alive = false; };
    }, [ky, nonce, tick]);
    // Sau khi lưu/duyệt: cập nhật 1 dòng giải trình trong cache, không tải lại cả kỳ.
    const patchGt = (row) => {
      const d = cache.get(ky); if (!d) return;
      const i = d.giai_trinh.findIndex((g) => g.id === row.id || (g.ky === row.ky && g.ma_kh === row.ma_kh && g.ten_nv === row.ten_nv));
      const prev = i >= 0 ? d.giai_trinh[i] : {};
      const merged = { ...prev, ...row, _can_approve: prev._can_approve ?? (d.can_approve_nv || []).includes(row.ten_nv) };
      const list = d.giai_trinh.slice();
      if (i >= 0) list[i] = merged; else list.push(merged);
      const next = { ...d, giai_trinh: list };
      cache.set(ky, next);
      setSt({ data: next, error: null, loading: false });
    };
    const refetch = () => { cache.delete(ky); setTick((t) => t + 1); };
    return { ...st, patchGt, refetch };
  }

  // ── Bộ lọc dùng chung trên URL ──
  function useFilters() {
    const q = R.useQuery();
    return {
      ky: q.get("ky") || "",
      nganh: q.getAll("nganh"),
      nv: q.getAll("nv"),
      loai: q.getAll("loai"),
      set: (changes) => R.setQuery(changes),
    };
  }

  // Thanh lọc chuẩn: Kỳ + Ngành hàng + Sale + Nhóm KH.
  function KyFilterBar({ kyList, data, f, extra }) {
    const curRows = data ? data.agg.filter((r) => r.ky === data.meta.ky) : [];
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
    const nvs = data ? uniq([...curRows.map((r) => r.ten_nv), ...data.hang_vay.map((r) => r.ten_nv)]) : [];
    return h(UI.FilterBar, null,
      h(UI.FilterSelect, {
        label: "Kỳ", allowAll: false,
        options: (kyList || []).map((k) => ({ value: k.ky, label: UI.fmtKyLabel(k.ky) + (k.khoa ? " (đã khoá)" : "") })),
        selected: f.ky ? [f.ky] : [], onChange: (v) => f.set({ ky: v[0] || "" }),
      }),
      h(UI.FilterSelect, { label: "Ngành hàng", multiple: true, options: uniq(curRows.map((r) => r.nganh_hang)), selected: f.nganh, onChange: (v) => f.set({ nganh: v }) }),
      nvs.length > 1 && h(UI.FilterSelect, { label: "Sale", multiple: true, searchable: true, options: nvs, selected: f.nv, onChange: (v) => f.set({ nv: v }) }),
      h(UI.FilterSelect, { label: "Nhóm KH", multiple: true, options: uniq(curRows.map((r) => r.loai_hinh)), selected: f.loai, onChange: (v) => f.set({ loai: v }) }),
      extra);
  }

  // Khung chung: chọn kỳ mặc định = kỳ mới nhất, tải dữ liệu, hiện thanh lọc.
  function KyScreen({ children, extraFilters }) {
    const f = useFilters();
    const list = useKyList();
    const ky = f.ky || (list.rows && list.rows[0] && list.rows[0].ky) || "";
    const st = useKyData(ky);
    if (list.error) return h(UI.LoadingBlock, { error: list.error });
    if (list.rows && list.rows.length === 0) {
      return h(UI.Empty, null, "Chưa có kỳ báo cáo nào. Admin vào tab ", h("a", { href: R.href("/quan-tri"), className: UI.btn.link }, "Quản trị"), " để nạp file công nợ kế toán gửi.");
    }
    const ff = { ...f, ky };
    return h(React.Fragment, null,
      h(KyFilterBar, { kyList: list.rows, data: st.data, f: ff, extra: extraFilters }),
      st.error ? h(UI.LoadingBlock, { error: st.error })
        : !st.data ? h(UI.LoadingBlock, null)
        : children({ data: st.data, f: ff, patchGt: st.patchGt, refetch: st.refetch, kyMeta: (list.rows || []).find((k) => k.ky === ky) }));
  }

  // ── Tổng hợp ──
  function applyFilter(rows, f) {
    return rows.filter((r) =>
      (!f.nganh.length || f.nganh.includes(r.nganh_hang)) &&
      (!f.nv.length || f.nv.includes(r.ten_nv)) &&
      (!f.loai.length || !("loai_hinh" in r) || f.loai.includes(r.loai_hinh)));
  }

  const sum = (rows, pick = (r) => r.con_no) => rows.reduce((t, r) => t + (Number(pick(r)) || 0), 0);
  function groupSum(rows, keyFn, valFn = (r) => r.con_no) {
    const m = new Map();
    for (const r of rows) { const k = keyFn(r); m.set(k, (m.get(k) || 0) + (Number(valFn(r)) || 0)); }
    return m;
  }

  // Bảng đơn vị giải trình của kỳ = KH × ngành hàng × nhóm giải trình (area manager phụ trách, hoặc sale tự giải trình):
  // số dư theo nhóm nợ, A2–A4, so kỳ trước, thu trong tháng, giải trình.
  function buildKhach(data, f) {
    const ky = data.meta.ky, kyTruoc = data.meta.ky_truoc;
    const rows = applyFilter(data.agg, f);
    const key = (r) => r.ma_kh + "\u0001" + r.nganh_hang + "\u0001" + (r.nhom_gt || "");
    const m = new Map();
    const get = (r) => {
      const k = key(r);
      let x = m.get(k);
      if (!x) m.set(k, x = { key: k, ma_kh: r.ma_kh, nganh_hang: r.nganh_hang, nhom_gt: r.nhom_gt || "", nhom_label: (data.nhom_label || {})[r.nhom_gt] || "", ten_kh: r.ten_kh, ten_kh_goc: r.ten_kh_goc || r.ten_kh, nv: new Set(), loai_hinh: r.loai_hinh, khu_vuc: r.khu_vuc,
        nganh: new Set([r.nganh_hang]), A0: 0, A1: 0, A2: 0, A3: 0, A4: 0, tong: 0, qua_han: 0, prev_qua_han: 0, prev_tong: 0, max_ngay: 0, so_hd: 0, chua_bbbg: 0, thu: 0 });
      return x;
    };
    for (const r of rows) {
      const x = get(r);
      if (r.ky === ky) {
        x.ten_kh = r.ten_kh || x.ten_kh;
        x.ten_kh_goc = r.ten_kh_goc || x.ten_kh_goc;
        x.nv.add(r.ten_nv);
        x[r.nhom_no] = (x[r.nhom_no] || 0) + r.con_no;
        x.tong += r.con_no;
        x.so_hd += r.so_hd;
        if (NHOM_GT.includes(r.nhom_no)) { x.qua_han += r.con_no; x.max_ngay = Math.max(x.max_ngay, r.max_ngay_qua_han || 0); }
        if (r.khong_chung_tu) x.chua_bbbg += r.con_no;
      } else if (r.ky === kyTruoc) {
        x.prev_tong += r.con_no;
        if (NHOM_GT.includes(r.nhom_no)) x.prev_qua_han += r.con_no;
      }
    }
    for (const t of applyFilter(data.thu_tien, f)) { const x = m.get(key(t)); if (x) x.thu += t.so_tien; }
    const gtCur = new Map(), gtPrev = new Map();
    for (const g of data.giai_trinh) (g.ky === ky ? gtCur : gtPrev).set(key(g), g);
    const out = [];
    for (const x of m.values()) {
      if (x.tong === 0 && x.prev_tong === 0) continue;
      x.nganh = [...x.nganh];
      x.nv = [...x.nv].sort((a, b) => a.localeCompare(b, "vi"));
      x.ten_nv = x.nv.join(", ");
      x.gt = gtCur.get(x.key) || null;
      x.gt_prev = gtPrev.get(x.key) || null;
      x.trang_thai = stOf(x.gt);
      // Server tính cờ trên số trọn cặp (người chỉ thấy 1 phần cặp không có số đó); bản cũ không có thì tự tính.
      x.can_cap_nhat = x.trang_thai !== "chua" && (x.gt && x.gt._can_cap_nhat !== undefined ? !!x.gt._can_cap_nhat : canCapNhat(x.gt && x.gt.du_no_qua_han, x.qua_han));
      x.can_gt = x.qua_han > 0.5; // > 0 đồng (tránh sai số làm tròn)
      out.push(x);
    }
    return out.sort((a, b) => b.qua_han - a.qua_han || b.tong - a.tong);
  }

  // Ngày còn lại tới hạn giải trình.
  function hanInfo(han) {
    if (!han) return null;
    const d = Math.ceil((new Date(han + "T23:59:59") - new Date()) / 86400000);
    return { days: d, text: d < 0 ? "quá hạn " + -d + " ngày" : d === 0 ? "hôm nay" : "còn " + d + " ngày" };
  }

  const StatusBadge = ({ st }) => {
    const t = TRANG_THAI[st] || TRANG_THAI.chua;
    return h(UI.Badge, { tone: t.tone }, t.label);
  };

  window.DEBT_DATA = {
    NHOM, NHOM_LABEL, NHOM_GT, TRANG_THAI, PHE_DUYET, STATUS_LIST, DONE, STATUS_BG, stOf, canCapNhat, useKyList, useKyData, useFilters, KyScreen, applyFilter, sum, groupSum,
    buildKhach, hanInfo, StatusBadge, invalidate,
  };
})();
