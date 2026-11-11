// Hash router tối giản: #/tong-quan, #/giai-trinh … có thể kèm query: #/giai-trinh?ky=2026-10
// Đăng ký screen: DEBT_ROUTER.register(path, component). Bootstrap gọi useRoute() để lấy path hiện tại.
(function () {
  const { useState, useEffect } = React;

  const registry = new Map();
  function register(path, component) { registry.set(path, component); }
  function get(path) { return registry.get(path); }
  function list() { return Array.from(registry.keys()); }

  function parseHash() {
    const raw = (window.location.hash || "").replace(/^#/, "");
    const i = raw.indexOf("?");
    return { path: (i < 0 ? raw : raw.slice(0, i)) || "/tong-quan", query: new URLSearchParams(i < 0 ? "" : raw.slice(i + 1)) };
  }
  function currentPath() { return parseHash().path; }
  function currentQuery() { return parseHash().query; }

  function href(path, query) {
    const q = query instanceof URLSearchParams ? query.toString() : new URLSearchParams(query || {}).toString();
    return "#" + path + (q ? "?" + q : "");
  }
  function navigate(path, query) {
    if (!path.startsWith("/")) path = "/" + path;
    const next = href(path, query);
    if (window.location.hash !== next) window.location.hash = next;
  }
  // Đổi một số tham số trên URL hiện tại; giá trị rỗng / mảng rỗng = xoá tham số.
  function setQuery(changes) {
    const { path, query } = parseHash();
    for (const [k, v] of Object.entries(changes)) {
      query.delete(k);
      for (const x of [].concat(v ?? [])) if (x !== "" && x != null) query.append(k, x);
    }
    navigate(path, query);
  }

  function useHash() {
    const [, setTick] = useState(0);
    useEffect(() => {
      const onHash = () => setTick((t) => t + 1);
      window.addEventListener("hashchange", onHash);
      return () => window.removeEventListener("hashchange", onHash);
    }, []);
    return parseHash();
  }
  function useRoute() { return useHash().path; }
  function useQuery() { return useHash().query; }

  window.DEBT_ROUTER = { register, get, list, currentPath, currentQuery, href, navigate, setQuery, useRoute, useQuery };
})();
