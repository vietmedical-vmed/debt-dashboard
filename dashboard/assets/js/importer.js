// Đọc file "KNK_Báo cáo công nợ Txx.yyyy.xlsb" do kế toán gửi.
// Chạy được cả trên trình duyệt (window.DEBT_IMPORT) lẫn Node (module.exports) để kiểm thử.
//
// Sheet dùng:
//   - "BC công nợ - NK"   : kỳ báo cáo, ngày báo cáo, biến động dư nợ (mục I), số tổng để đối chiếu
//   - "Dulieutong"        : chi tiết từng hóa đơn (gồm kỳ báo cáo và kỳ trước)
//   - "Công nợ hàng vay"  : hàng vay / hàng gửi chưa xuất hóa đơn
//   - "Data thu tiền"     : các khoản khách hàng thanh toán (lấy tổng thu trong tháng báo cáo)
// Cột được dò theo TÊN tiêu đề, không theo vị trí, để file đổi thứ tự cột vẫn đọc được.
(function (root) {
  const SHEETS = {
    bc: "BC công nợ - NK",
    chiTiet: "Dulieutong",
    hangVay: "Công nợ hàng vay",
    thuTien: "Data thu tiền",
  };

  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const low = (s) => norm(s).toLowerCase();
  const num = (v) => {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return isFinite(v) ? v : 0;
    const n = Number(String(v).replace(/,/g, ""));
    return isFinite(n) ? n : 0;
  };
  const txt = (v) => { const s = norm(v); return s === "" ? null : s; };

  // Ngày Excel (serial) → "yyyy-mm-dd". Chuỗi dd/mm/yyyy cũng nhận.
  function toDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "number" && v > 20000 && v < 80000) {
      const ms = Math.round((v - 25569) * 86400000);
      return new Date(ms).toISOString().slice(0, 10);
    }
    const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return null;
  }

  // "2026.10" | 2026.1 | "10/2026" | "2026-10" → "2026-10"
  function toKy(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") {
      const s = v.toFixed(2); // 2026.1 → "2026.10"
      return s.slice(0, 4) + "-" + s.slice(5, 7);
    }
    const s = norm(v);
    let m = s.match(/^(\d{4})[.\-/](\d{1,2})$/);
    if (m) return m[1] + "-" + m[2].padStart(2, "0");
    m = s.match(/^(\d{1,2})\/(\d{4})$/);
    if (m) return m[2] + "-" + m[1].padStart(2, "0");
    return null;
  }

  // Trả mảng các dòng (mảng giá trị). Dùng !data (dense) để không phải duyệt
  // hết vùng !ref — sheet hàng vay khai báo tới 1.048.576 dòng.
  function rowsOf(ws) {
    if (!ws) return [];
    const out = [];
    if (ws["!data"]) {
      const d = ws["!data"];
      for (let r = 0; r < d.length; r++) {
        const row = d[r];
        out.push(row ? row.map((c) => (c ? c.v : null)) : []);
      }
      return out;
    }
    const XLSX = root.XLSX || (typeof require === "function" ? require("xlsx") : null);
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  }

  // Tìm dòng tiêu đề chứa đủ các nhãn `must`; trả { index, col(name, nth) }.
  function findHeader(rows, must, maxScan = 40) {
    for (let r = 0; r < Math.min(rows.length, maxScan); r++) {
      const labels = (rows[r] || []).map(low);
      if (must.every((m) => labels.includes(low(m)))) {
        return {
          index: r,
          col(name, nth = 1) {
            let seen = 0;
            for (let c = 0; c < labels.length; c++) if (labels[c] === low(name) && ++seen === nth) return c;
            return -1;
          },
        };
      }
    }
    return null;
  }

  const NGANH_BU = { "ctch": "chcs", "nội soi tiêu hao": "thnk", "can thiệp tim mạch": "cttm" };
  const buOf = (nganh) => NGANH_BU[low(nganh)] || null;

  // ── Sheet BC: kỳ, ngày báo cáo, mục I, số đối chiếu ─────────────────
  function parseBC(rows) {
    const res = { ky: null, ky_truoc: null, ngay_bao_cao: null, bien_dong: [], doi_chieu: {} };
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        const l = low(row[c]);
        const next = () => { for (let k = c + 1; k < row.length; k++) if (row[k] != null && row[k] !== "") return row[k]; return null; };
        if (l === "tháng báo cáo") res.ky = toKy(next());
        else if (l === "tháng trước") res.ky_truoc = toKy(next());
        else if (l.startsWith("ngày báo cáo")) res.ngay_bao_cao = toDate(next());
      }
    }
    // Mục I. Biến động dư nợ theo ngành hàng (đơn vị triệu đồng)
    const start = rows.findIndex((r) => r && low(r[0]).startsWith("i. biến động"));
    if (start >= 0) {
      const hdr = findHeader(rows.slice(start), ["Dư nợ đầu kỳ", "Dư nợ cuối kỳ"], 6);
      if (hdr) {
        const h0 = start + hdr.index;
        const cDau = hdr.col("Dư nợ đầu kỳ"), cCuoi = hdr.col("Dư nợ cuối kỳ");
        for (let r = h0 + 1; r < h0 + 12 && r < rows.length; r++) {
          const row = rows[r] || [];
          const label = norm(row[2]) || norm(row[1]);
          if (!label || row[cDau] == null) { if (res.bien_dong.length) break; continue; }
          res.bien_dong.push({
            nganh_hang: low(row[1]) === "tổng" ? "Tổng" : label,
            dau_ky: num(row[cDau]), doanh_thu: num(row[cDau + 1]), thu_tien: num(row[cDau + 2]),
            dieu_chinh: num(row[cDau + 3]), cuoi_ky: num(row[cCuoi]),
          });
          if (low(row[1]) === "tổng") break;
        }
      }
    }
    // Số tổng theo nhóm nợ để đối chiếu (triệu đồng)
    const pickGroups = (row) => ({ A0: num(row[3]), A1: num(row[4]), A2: num(row[5]), A3: num(row[6]), A4: num(row[7]), tong: num(row[11]) });
    for (const row of rows) {
      if (!row) continue;
      const l = low(row[1]);
      if (l === "tổng dư nợ tháng báo cáo" && !res.doi_chieu.ky) res.doi_chieu.ky = pickGroups(row);
      else if (l === "tổng dư nợ tháng trước" && !res.doi_chieu.ky_truoc) res.doi_chieu.ky_truoc = pickGroups(row);
      else if (l.startsWith("trong đó: không có biên") && res.doi_chieu.chua_bbbg == null) res.doi_chieu.chua_bbbg = num(row[11]);
      else if (low(row[2]) === "tổng công nợ hàng vay" && res.doi_chieu.hang_vay == null) res.doi_chieu.hang_vay = num(row[8]);
    }
    return res;
  }

  // ── Sheet Dulieutong: chi tiết hóa đơn ──────────────────────────────
  function parseChiTiet(rows) {
    const hdr = findHeader(rows, ["Mã KH", "Tên KH", "Còn nợ", "Nhóm công nợ"]);
    if (!hdr) throw new Error(`Sheet "${SHEETS.chiTiet}": không tìm thấy dòng tiêu đề (Mã KH, Tên KH, Còn nợ, Nhóm công nợ)`);
    const C = (n) => hdr.col(n);
    const col = {
      loai_hinh: C("Loại hình doanh nghiệp"), khu_vuc: C("Khu vực"), ma_kh: C("Mã KH"), ten_kh: C("Tên KH"),
      ten_nv: C("Tên NV"), gia_tri_hd: C("Giá trị hóa đơn/lần thanh toán"), da_thanh_toan: C("Đã thanh toán"),
      con_no: C("Còn nợ"), ngay_hd: C("Ngày hóa đơn"), so_hd: C("Số hóa đơn"), ngay_hop_dong: C("Ngày hợp đồng"),
      so_hop_dong: C("Số hợp đồng"), lan_tt: C("Lần thanh toán"), so_ngay_den_han: C("Số ngày đến hạn"),
      ngay_den_han: C("Ngày đến hạn"), so_ngay_qua_han: C("Số ngày quá hạn"), khay: C("Khay"),
      nganh_hang: C("Ngành hàng"), khoi: C("Khối kinh doanh"), ghi_chu: C("Ghi chú"), cn_nhom_b: C("CN nhóm B"),
      nhom_no: C("Nhóm công nợ"), hop_dong_ban: C("Hợp đồng bán"), bbbg: C("BBBG"), bb_doi_chieu: C("BB đối chiếu"),
      ky: C("Tháng báo cáo"), loai_tru: C("Không lên báo cáo công nợ (x)"), note: C("Note"),
    };
    for (const k of ["ma_kh", "ten_nv", "con_no", "nhom_no", "ky", "nganh_hang"]) {
      if (col[k] < 0) throw new Error(`Sheet "${SHEETS.chiTiet}": thiếu cột ${k}`);
    }
    const get = (row, k) => (col[k] >= 0 ? row[col[k]] : null);
    const out = [];
    for (let r = hdr.index + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;
      const ma = txt(get(row, "ma_kh"));
      const ky = toKy(get(row, "ky"));
      if (!ma || !ky) continue;
      const khoi = txt(get(row, "khoi"));
      if (khoi && low(khoi) !== "ngoại khoa") continue;
      const nganh = txt(get(row, "nganh_hang"));
      out.push({
        ky,
        loai_hinh: txt(get(row, "loai_hinh")),
        khu_vuc: txt(get(row, "khu_vuc")),
        ma_kh: ma,
        ten_kh: txt(get(row, "ten_kh")),
        ten_nv: txt(get(row, "ten_nv")) || "(chưa có NV)",
        gia_tri_hd: num(get(row, "gia_tri_hd")),
        da_thanh_toan: num(get(row, "da_thanh_toan")),
        con_no: num(get(row, "con_no")),
        ngay_hd: toDate(get(row, "ngay_hd")),
        so_hd: txt(get(row, "so_hd")),
        ngay_hop_dong: toDate(get(row, "ngay_hop_dong")),
        so_hop_dong: txt(get(row, "so_hop_dong")),
        lan_tt: txt(get(row, "lan_tt")),
        so_ngay_den_han: Math.round(num(get(row, "so_ngay_den_han"))),
        ngay_den_han: toDate(get(row, "ngay_den_han")),
        so_ngay_qua_han: Math.round(num(get(row, "so_ngay_qua_han"))),
        khay: txt(get(row, "khay")),
        nganh_hang: nganh,
        bu: buOf(nganh),
        nhom_no: txt(get(row, "nhom_no")),
        khong_chung_tu: low(get(row, "cn_nhom_b")) === "x",
        hop_dong_ban: txt(get(row, "hop_dong_ban")),
        bbbg: txt(get(row, "bbbg")),
        bb_doi_chieu: txt(get(row, "bb_doi_chieu")),
        ghi_chu: txt(get(row, "ghi_chu")),
        note: txt(get(row, "note")),
        loai_tru: low(get(row, "loai_tru")) === "x",
      });
    }
    return out;
  }

  // ── Sheet hàng vay ──────────────────────────────────────────────────
  function parseHangVay(rows) {
    const hdr = findHeader(rows, ["Chứng từ", "Đối tượng", "Tổng giá trị", "Tên nhân viên"]);
    if (!hdr) return [];
    const C = (n) => hdr.col(n);
    const col = {
      khay: C("Khay"), thang: C("Tháng"), nam: C("Năm"), chung_tu: C("Chứng từ"), ma_kh: C("Mã đối tượng"),
      ten_kh: C("Đối tượng"), ma_hang: C("Mã hàng hóa (mã bravo)"), ten_hang: C("Tên hàng"), dvt: C("Đvt"),
      sl: C("SL"), don_gia: C("Đơn giá vốn"), gia_tri: C("Tổng giá trị"), ten_nv: C("Tên nhân viên"),
      nganh_hang: C("Ngành hàng"), khoi: C("Khối kinh doanh"), ghi_chu: C("Ghi chú"),
    };
    const get = (row, k) => (col[k] >= 0 ? row[col[k]] : null);
    const out = [];
    for (let r = hdr.index + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;
      const ten = txt(get(row, "ten_kh"));
      const gt = num(get(row, "gia_tri"));
      if (!ten || !gt) continue;
      const khoi = txt(get(row, "khoi"));
      if (khoi && low(khoi) !== "ngoại khoa") continue;
      const thang = txt(get(row, "thang")), nam = txt(get(row, "nam"));
      const nganh = txt(get(row, "nganh_hang"));
      out.push({
        khay: txt(get(row, "khay")),
        thang_xuat: nam && thang ? `${String(nam).slice(0, 4)}-${String(thang).padStart(2, "0")}` : null,
        chung_tu: txt(get(row, "chung_tu")),
        ma_kh: txt(get(row, "ma_kh")),
        ten_kh: ten,
        ma_hang: txt(get(row, "ma_hang")),
        ten_hang: txt(get(row, "ten_hang")),
        dvt: txt(get(row, "dvt")),
        sl: num(get(row, "sl")),
        don_gia: num(get(row, "don_gia")),
        gia_tri: gt,
        ten_nv: txt(get(row, "ten_nv")) || "(chưa có NV)",
        nganh_hang: nganh,
        bu: buOf(nganh),
        ghi_chu: txt(get(row, "ghi_chu")),
      });
    }
    return out;
  }

  // ── Sheet thu tiền: tổng thu trong tháng báo cáo theo KH × NV × ngành ──
  function parseThuTien(rows, ky) {
    const hdr = findHeader(rows, ["Mã KH", "Tên nhân viên", "Tháng thanh toán", "Phân loại"]);
    if (!hdr || !ky) return [];
    const cMa = hdr.col("Mã KH"), cTen = hdr.col("Tên KH"), cNv = hdr.col("Tên nhân viên");
    const cThang = hdr.col("Tháng thanh toán"), cLoai = hdr.col("Phân loại"), cNganh = hdr.col("Ngành hàng");
    // Cột "Số tiền" xuất hiện 2 lần: lần 1 = giá trị hóa đơn, lần 2 = số tiền thanh toán.
    const cTien = hdr.col("Số tiền", 2) >= 0 ? hdr.col("Số tiền", 2) : hdr.col("Số tiền");
    const map = new Map();
    for (let r = hdr.index + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      if (low(row[cLoai]) !== "thanh toán") continue;
      if (toKy(row[cThang]) !== ky) continue;
      const ma = txt(row[cMa]);
      if (!ma) continue;
      const nv = txt(row[cNv]) || "(chưa có NV)";
      const nganh = txt(row[cNganh]);
      const key = ma + "|" + nv + "|" + nganh;
      const cur = map.get(key) || { ky, ma_kh: ma, ten_kh: txt(row[cTen]), ten_nv: nv, nganh_hang: nganh, bu: buOf(nganh), so_tien: 0, so_ct: 0 };
      cur.so_tien += num(row[cTien]);
      cur.so_ct += 1;
      map.set(key, cur);
    }
    return [...map.values()];
  }

  // Tổng hợp nhanh để đối chiếu với sheet BC (triệu đồng).
  function tongTheoNhom(rows, ky) {
    const t = { A0: 0, A1: 0, A2: 0, A3: 0, A4: 0, tong: 0, chua_bbbg: 0, so_dong: 0, loai_tru: 0 };
    for (const r of rows) {
      if (r.ky !== ky) continue;
      if (r.loai_tru) { t.loai_tru += r.con_no / 1e6; continue; }
      t.so_dong++;
      if (t[r.nhom_no] != null) t[r.nhom_no] += r.con_no / 1e6;
      t.tong += r.con_no / 1e6;
      // Báo cáo kế toán: "Dư nợ chưa có BBBG/ĐCCN" chưa gồm CTTM.
      if (r.khong_chung_tu && r.bu !== "cttm") t.chua_bbbg += r.con_no / 1e6;
    }
    return t;
  }

  // Đọc toàn bộ workbook. `XLSX` là thư viện SheetJS.
  function parseWorkbook(wb) {
    const missing = [SHEETS.bc, SHEETS.chiTiet].filter((s) => !wb.Sheets[s]);
    if (missing.length) throw new Error("File thiếu sheet: " + missing.join(", "));
    const bc = parseBC(rowsOf(wb.Sheets[SHEETS.bc]));
    if (!bc.ky) throw new Error(`Không đọc được "Tháng báo cáo" trên sheet "${SHEETS.bc}"`);
    const chiTiet = parseChiTiet(rowsOf(wb.Sheets[SHEETS.chiTiet]));
    const hangVay = parseHangVay(rowsOf(wb.Sheets[SHEETS.hangVay]));
    const thuTien = parseThuTien(rowsOf(wb.Sheets[SHEETS.thuTien]), bc.ky);

    const kys = [...new Set(chiTiet.map((r) => r.ky))].sort();
    const warnings = [];
    const lech = (a, b) => Math.abs((a || 0) - (b || 0)) > 1; // lệch > 1 triệu
    const tongKy = tongTheoNhom(chiTiet, bc.ky);
    const dc = bc.doi_chieu.ky;
    if (dc) {
      for (const g of ["A0", "A1", "A2", "A3", "A4", "tong"]) {
        if (lech(tongKy[g], dc[g])) warnings.push(`Kỳ ${bc.ky} nhóm ${g}: chi tiết ${tongKy[g].toFixed(1)} tr ≠ sheet BC ${dc[g].toFixed(1)} tr`);
      }
    }
    if (bc.doi_chieu.chua_bbbg != null && lech(tongKy.chua_bbbg, bc.doi_chieu.chua_bbbg)) {
      warnings.push(`Dư nợ chưa có BBBG/ĐCCN: chi tiết ${tongKy.chua_bbbg.toFixed(1)} tr ≠ sheet BC ${bc.doi_chieu.chua_bbbg.toFixed(1)} tr`);
    }
    const tongHV = hangVay.reduce((s, r) => s + r.gia_tri, 0) / 1e6;
    if (bc.doi_chieu.hang_vay != null && lech(tongHV, bc.doi_chieu.hang_vay)) {
      warnings.push(`Hàng vay: chi tiết ${tongHV.toFixed(1)} tr ≠ sheet BC ${bc.doi_chieu.hang_vay.toFixed(1)} tr`);
    }
    if (bc.ky_truoc && bc.doi_chieu.ky_truoc && kys.includes(bc.ky_truoc)) {
      const t = tongTheoNhom(chiTiet, bc.ky_truoc);
      if (lech(t.tong, bc.doi_chieu.ky_truoc.tong)) warnings.push(`Kỳ trước ${bc.ky_truoc}: chi tiết ${t.tong.toFixed(1)} tr ≠ sheet BC ${bc.doi_chieu.ky_truoc.tong.toFixed(1)} tr`);
    }
    if (!kys.includes(bc.ky)) warnings.push(`Sheet ${SHEETS.chiTiet} không có dòng nào của kỳ ${bc.ky}`);

    return {
      ky: bc.ky,
      ky_truoc: bc.ky_truoc,
      ngay_bao_cao: bc.ngay_bao_cao,
      bien_dong: bc.bien_dong,
      doi_chieu: { ...bc.doi_chieu, tinh_lai: tongKy, hang_vay_tinh_lai: tongHV },
      kys,
      cong_no: chiTiet,
      hang_vay: hangVay,
      thu_tien: thuTien,
      warnings,
    };
  }

  // Tùy chọn đọc chỉ các sheet cần thiết (nhanh hơn nhiều với file 5 MB).
  const READ_OPTS = { type: "array", dense: true, cellDates: false, cellFormula: false, cellHTML: false, cellText: false, sheets: Object.values(SHEETS) };

  const api = { SHEETS, READ_OPTS, parseWorkbook, tongTheoNhom, toKy, toDate, buOf };
  root.DEBT_IMPORT = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
