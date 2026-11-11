#include "p3d/fileio.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <mutex>
#include <unordered_map>

#if defined(_WIN32)
#define NOMINMAX
#include <windows.h>
#elif defined(__EMSCRIPTEN__)
#include <emscripten.h>
#include <cstring>
#include <limits.h>
#include <unistd.h>
#else
#include <limits.h>
#include <unistd.h>
#endif

namespace p3d::io {
    namespace fs = std::filesystem;

    std::string NormalizeSeparators(const std::string& path) {
        std::string out = path;
        std::replace(out.begin(), out.end(), '\\', '/');
        return out;
    }

    std::string JoinPath(const std::string& a, const std::string& b) {
        if (a.empty()) return b;
        if (b.empty()) return a;
        const bool aSlash = a.back() == '/' || a.back() == '\\';
        const bool bSlash = b.front() == '/' || b.front() == '\\';
        if (aSlash && bSlash) return a + b.substr(1);
        if (aSlash || bSlash) return a + b;
        return a + "/" + b;
    }

#if defined(__linux__)
    namespace {

        // Cache of directory listing -> {lowercase name -> on-disk spelling}, so
        // ResolvePath only needs one directory_iterator pass per directory instead
        // of one per call. Guarded by g_cacheMutex since asset loading (ModLoader,
        // PsxDiscExtractor) may resolve paths from background threads.
        struct DirCache {
            std::unordered_map<std::string, std::string> lowerToActual;
        };

        std::mutex g_cacheMutex;
        std::unordered_map<std::string, DirCache> g_dirCache;

        std::string ToLowerAscii(const std::string& s) {
            std::string out = s;
            std::transform(out.begin(), out.end(), out.begin(),
                           [](unsigned char c) { return (char)std::tolower(c); });
            return out;
        }

        // Caller must hold g_cacheMutex.
        const DirCache* GetOrLoadDirCacheLocked(const std::string& parentPath) {
            auto it = g_dirCache.find(parentPath);
            if (it != g_dirCache.end()) {
                return &it->second;
            }

            std::error_code ec;
            const fs::path dir = parentPath.empty() ? fs::path(".") : fs::path(parentPath);
            fs::directory_iterator iter(dir, ec);
            if (ec) {
                return nullptr;
            }

            DirCache cache;
            const fs::directory_iterator end;
            for (; iter != end; iter.increment(ec)) {
                if (ec) break;
                const std::string name = iter->path().filename().string();
                cache.lowerToActual[ToLowerAscii(name)] = name;
            }

            auto result = g_dirCache.emplace(parentPath, std::move(cache));
            return &result.first->second;
        }

    }
#endif


#if defined(__EMSCRIPTEN__)
    // ---------------------------------------------------------------------
    // Web asset store.
    //
    // The disc assets are extracted by the page (web/shell/js/extractor.js)
    // into IndexedDB, one Blob per file, keyed by its lower-case relative path
    // ("xc/lev01.lcf"). Nothing is copied into wasm memory up front -- an iPhone
    // would not survive holding the whole disc in RAM. Instead, opens and
    // reads are served lazily from those Blobs; reads are asynchronous in the
    // browser, so they suspend the engine through Asyncify and resume once
    // the bytes arrive. Small files are fetched whole on open, large ones
    // (movies, sound banks) through a sliding read-ahead window.
    //
    // Everything else (bundled pc/ data, userfiles/ saves) lives in the
    // regular Emscripten filesystem and is checked first.
    // ---------------------------------------------------------------------
    } // namespace p3d::io

    EM_JS(double, rcweb_asset_size, (const char* path), {
        return Module.rcAssets ? Module.rcAssets.size(UTF8ToString(path)) : -1;
    });
    EM_JS(int, rcweb_asset_is_dir, (const char* path), {
        return (Module.rcAssets && Module.rcAssets.isDir(UTF8ToString(path))) ? 1 : 0;
    });
    // Returns a malloc'd "name\tD|F\n..." listing, or 0 when the directory is unknown.
    EM_JS(char*, rcweb_asset_list, (const char* path), {
        if (!Module.rcAssets) return 0;
        var text = Module.rcAssets.list(UTF8ToString(path));
        return text === null ? 0 : stringToNewUTF8(text);
    });
    EM_ASYNC_JS(int, rcweb_asset_read, (const char* path, double offset, int length, unsigned char* dst), {
        if (!Module.rcAssets) return -1;
        var bytes = await Module.rcAssets.read(UTF8ToString(path), offset, length);
        if (!bytes) return -1;
        HEAPU8.set(bytes, dst);
        return bytes.length;
    });
    EM_JS(void, rcweb_persist_userfiles, (), {
        if (Module.rcPersistUserFiles) Module.rcPersistUserFiles();
    });

    namespace p3d::io {
    namespace {
        constexpr int64_t kWebWholeFileLimit = 4 * 1024 * 1024;
        constexpr int64_t kWebWindowSize = 1024 * 1024;

        struct WebAsset {
            std::string key;
            int64_t size = 0;
            int64_t pos = 0;
            std::vector<uint8_t> window;
            int64_t windowStart = 0;
        };

        std::string WebAssetKey(const std::string& path) {
            std::string p = NormalizeSeparators(path);
            if (p.rfind("/rechan/", 0) == 0) p = p.substr(8);
            while (p.rfind("./", 0) == 0) p = p.substr(2);
            while (!p.empty() && p.front() == '/') p.erase(p.begin());
            std::string out;
            out.reserve(p.size());
            for (char c : p) {
                if (c == '/' && !out.empty() && out.back() == '/') continue;
                out.push_back((char)std::tolower((unsigned char)c));
            }
            while (!out.empty() && out.back() == '/') out.pop_back();
            return out;
        }

        int64_t WebAssetSize(const std::string& path) {
            const double size = rcweb_asset_size(WebAssetKey(path).c_str());
            return size < 0 ? -1 : (int64_t)size;
        }

        bool WebAssetIsDir(const std::string& path) {
            return rcweb_asset_is_dir(WebAssetKey(path).c_str()) != 0;
        }

        bool WebAssetFill(WebAsset& a, int64_t start, int64_t length) {
            if (start >= a.size) {
                a.window.clear();
                a.windowStart = start;
                return true;
            }
            length = std::min<int64_t>(length, a.size - start);
            a.window.resize((size_t)length);
            const int got = rcweb_asset_read(a.key.c_str(), (double)start, (int)length, a.window.data());
            if (got < 0) {
                a.window.clear();
                return false;
            }
            a.window.resize((size_t)got);
            a.windowStart = start;
            return true;
        }

        size_t WebAssetRead(WebAsset& a, void* dst, size_t bytes) {
            uint8_t* out = static_cast<uint8_t*>(dst);
            size_t done = 0;
            while (done < bytes && a.pos < a.size) {
                const int64_t winEnd = a.windowStart + (int64_t)a.window.size();
                if (a.pos < a.windowStart || a.pos >= winEnd) {
                    const int64_t want = std::max<int64_t>(kWebWindowSize, (int64_t)(bytes - done));
                    if (!WebAssetFill(a, a.pos, want) || a.window.empty()) break;
                    continue;
                }
                const size_t avail = (size_t)(winEnd - a.pos);
                const size_t n = std::min(avail, bytes - done);
                std::memcpy(out + done, a.window.data() + (a.pos - a.windowStart), n);
                done += n;
                a.pos += (int64_t)n;
            }
            return done;
        }
    }

    void PersistUserFiles() {
        rcweb_persist_userfiles();
    }
#else
    void PersistUserFiles() {}
#endif

    std::string ResolvePath(const char* path) {
        if (!path || !path[0]) {
            return {};
        }
        return ResolvePath(std::string(path));
    }

    std::string ResolvePath(const std::string& path) {
#if defined(__EMSCRIPTEN__)
        std::string normalized = NormalizeSeparators(path);
        std::error_code ec;
        if (fs::exists(fs::path(normalized), ec)) {
            return normalized;
        }
        // Extracted assets are stored lower-case, so their lower-case key is
        // also their "on-disk spelling".
        const std::string key = WebAssetKey(normalized);
        if (WebAssetSize(key) >= 0 || WebAssetIsDir(key)) {
            return key;
        }
        return normalized;
#elif !defined(__linux__)
        return path;
#else
        std::string normalized = NormalizeSeparators(path);

        std::error_code ec;
        const fs::path requested(normalized);
        if (fs::exists(requested, ec)) {
            return normalized;
        }

        std::lock_guard<std::mutex> lock(g_cacheMutex);

        fs::path resolved = requested.root_path();
        for (const fs::path& component : requested.relative_path()) {
            const fs::path exactCandidate = resolved / component;
            ec.clear();
            if (fs::exists(exactCandidate, ec)) {
                resolved = exactCandidate;
                continue;
            }

            const std::string parentKey = resolved.empty() ? std::string(".") : resolved.string();
            const DirCache* cache = GetOrLoadDirCacheLocked(parentKey);
            if (!cache) {
                return normalized;
            }

            const auto found = cache->lowerToActual.find(ToLowerAscii(component.string()));
            if (found == cache->lowerToActual.end()) {
                return normalized;
            }

            resolved /= found->second;
        }

        return resolved.string();
#endif
    }

    void InvalidateResolveCache(const std::string& dir) {
#if defined(__linux__)
        std::lock_guard<std::mutex> lock(g_cacheMutex);
        if (dir.empty()) {
            g_dirCache.clear();
            return;
        }

        const std::string normalized = NormalizeSeparators(dir);
        for (auto it = g_dirCache.begin(); it != g_dirCache.end();) {
            if (it->first == normalized || it->first.rfind(normalized, 0) == 0) {
                it = g_dirCache.erase(it);
            }
            else {
                ++it;
            }
        }
#else
        (void)dir;
#endif
    }

    bool FileExists(const std::string& path) {
        std::error_code ec;
#if defined(__EMSCRIPTEN__)
        if (fs::is_regular_file(path, ec)) return true;
        return WebAssetSize(path) >= 0;
#else
        return fs::is_regular_file(path, ec);
#endif
    }

    bool DirExists(const std::string& path) {
        std::error_code ec;
#if defined(__EMSCRIPTEN__)
        if (fs::is_directory(path, ec)) return true;
        return WebAssetIsDir(path);
#else
        return fs::is_directory(path, ec);
#endif
    }

    bool CreateDirectories(const std::string& path) {
        if (path.empty()) {
            return true;
        }
        std::error_code ec;
        fs::create_directories(path, ec);
        return !ec;
    }

    std::vector<DirEntryInfo> ListDirectory(const std::string& path, bool recursive) {
        std::vector<DirEntryInfo> result;
        std::error_code ec;

        auto addEntry = [&](const fs::directory_entry& entry) {
            DirEntryInfo info;
            info.name = entry.path().filename().string();
            info.fullPath = entry.path().string();
            info.isDirectory = entry.is_directory(ec);
            result.push_back(std::move(info));
        };

#if defined(__EMSCRIPTEN__)
        if (!fs::is_directory(path, ec)) {
            ec.clear();
            // Web asset directory: walk the listing the page provides.
            std::vector<std::string> pending{ path };
            while (!pending.empty()) {
                const std::string dir = pending.back();
                pending.pop_back();
                char* listing = rcweb_asset_list(WebAssetKey(dir).c_str());
                if (!listing) continue;
                const char* cursor = listing;
                while (*cursor) {
                    const char* tab = std::strchr(cursor, '\t');
                    const char* nl = std::strchr(cursor, '\n');
                    if (!tab || !nl || tab > nl) break;
                    DirEntryInfo info;
                    info.name.assign(cursor, tab);
                    info.fullPath = JoinPath(dir, info.name);
                    info.isDirectory = tab[1] == 'D';
                    if (recursive && info.isDirectory) pending.push_back(info.fullPath);
                    result.push_back(std::move(info));
                    cursor = nl + 1;
                }
                std::free(listing);
                if (!recursive) break;
            }
            return result;
        }
#endif

        if (recursive) {
            fs::recursive_directory_iterator iter(path, ec);
            if (ec) return result;
            const fs::recursive_directory_iterator end;
            for (; iter != end; iter.increment(ec)) {
                if (ec) break;
                addEntry(*iter);
            }
        }
        else {
            fs::directory_iterator iter(path, ec);
            if (ec) return result;
            const fs::directory_iterator end;
            for (; iter != end; iter.increment(ec)) {
                if (ec) break;
                addEntry(*iter);
            }
        }

        return result;
    }

    std::optional<std::vector<uint8_t>> ReadFile(const std::string& path) {
        FileHandle file;
        if (!file.Open(path, FileHandle::Mode::Read)) {
            return std::nullopt;
        }

        const int64_t size = file.Size();
        if (size < 0) {
            return std::nullopt;
        }

        std::vector<uint8_t> data(static_cast<size_t>(size));
        if (size > 0 && file.Read(data.data(), data.size()) != data.size()) {
            return std::nullopt;
        }

        return data;
    }

    bool WriteFile(const std::string& path, const void* data, size_t size) {
        FileHandle file;
        if (!file.Open(path, FileHandle::Mode::Write, /*resolveCase=*/false)) {
            return false;
        }
        if (size > 0 && file.Write(data, size) != size) {
            return false;
        }
        return true;
    }

    bool WriteFile(const std::string& path, const std::vector<uint8_t>& data) {
        return WriteFile(path, data.data(), data.size());
    }

    std::optional<std::string> ReadTextFile(const std::string& path) {
        auto data = ReadFile(path);
        if (!data) {
            return std::nullopt;
        }
        return std::string(reinterpret_cast<const char*>(data->data()), data->size());
    }

    bool WriteTextFile(const std::string& path, const std::string& text) {
        return WriteFile(path, text.data(), text.size());
    }

    FileHandle::~FileHandle() {
        Close();
    }

    FileHandle::FileHandle(FileHandle&& other) noexcept
        : m_file(other.m_file), m_size(other.m_size), m_web(other.m_web), m_writing(other.m_writing) {
        other.m_writing = false;
        other.m_file = nullptr;
        other.m_size = -1;
        other.m_web = nullptr;
    }

    FileHandle& FileHandle::operator=(FileHandle&& other) noexcept {
        if (this != &other) {
            Close();
            m_file = other.m_file;
            m_size = other.m_size;
            m_web = other.m_web;
            m_writing = other.m_writing;
            other.m_writing = false;
            other.m_file = nullptr;
            other.m_size = -1;
            other.m_web = nullptr;
        }
        return *this;
    }

    bool FileHandle::Open(const std::string& path, Mode mode, bool resolveCase) {
        Close();

        const char* modeStr = "rb";
        if (mode == Mode::Write) modeStr = "wb";
        else if (mode == Mode::Append) modeStr = "ab";

        const std::string resolvedPath = resolveCase ? ResolvePath(path) : path;

        FILE* file = std::fopen(resolvedPath.c_str(), modeStr);
        if (!file) {
#if defined(__EMSCRIPTEN__)
            if (mode == Mode::Read) {
                const std::string key = WebAssetKey(resolvedPath);
                const int64_t size = WebAssetSize(key);
                if (size >= 0) {
                    auto* asset = new WebAsset();
                    asset->key = key;
                    asset->size = size;
                    if (size <= kWebWholeFileLimit && !WebAssetFill(*asset, 0, size)) {
                        delete asset;
                        return false;
                    }
                    m_web = asset;
                    m_size = size;
                    return true;
                }
            }
#endif
            return false;
        }

        // Probe the size unconditionally: for "wb" this yields 0 (fopen already
        // truncated), for "ab" it yields the pre-existing length, for "rb" the
        // full file length -- matches the original ccFile::Open behaviour.
        std::fseek(file, 0, SEEK_END);
        m_size = std::ftell(file);
        std::fseek(file, 0, SEEK_SET);

        m_file = file;
        m_writing = (mode != Mode::Read);
        return true;
    }

    void FileHandle::Close() {
#if defined(__EMSCRIPTEN__)
        if (m_web) {
            delete static_cast<WebAsset*>(m_web);
            m_web = nullptr;
        }
#endif
        if (m_file) {
            std::fclose(static_cast<FILE*>(m_file));
            m_file = nullptr;
            if (m_writing) {
                PersistUserFiles();
            }
        }
        m_writing = false;
        m_size = -1;
    }

    int64_t FileHandle::Tell() const {
#if defined(__EMSCRIPTEN__)
        if (m_web) {
            return static_cast<const WebAsset*>(m_web)->pos;
        }
#endif
        if (!m_file) {
            return -1;
        }
        return std::ftell(static_cast<FILE*>(m_file));
    }

    bool FileHandle::Seek(int64_t offset, int whence) {
#if defined(__EMSCRIPTEN__)
        if (m_web) {
            auto* a = static_cast<WebAsset*>(m_web);
            int64_t target = offset;
            if (whence == SEEK_CUR) target = a->pos + offset;
            else if (whence == SEEK_END) target = a->size + offset;
            if (target < 0) return false;
            a->pos = target;
            return true;
        }
#endif
        if (!m_file) {
            return false;
        }
        return std::fseek(static_cast<FILE*>(m_file), static_cast<long>(offset), whence) == 0;
    }

    size_t FileHandle::Read(void* dst, size_t bytes) {
#if defined(__EMSCRIPTEN__)
        if (m_web) {
            return WebAssetRead(*static_cast<WebAsset*>(m_web), dst, bytes);
        }
#endif
        if (!m_file) {
            return 0;
        }
        return std::fread(dst, 1, bytes, static_cast<FILE*>(m_file));
    }

    size_t FileHandle::Write(const void* src, size_t bytes) {
        if (!m_file) {
            return 0;
        }
        return std::fwrite(src, 1, bytes, static_cast<FILE*>(m_file));
    }

    void FileHandle::Flush() {
        if (m_file) {
            std::fflush(static_cast<FILE*>(m_file));
        }
    }

    std::string GetExecutablePath() {
#if defined(_WIN32)
        char buf[MAX_PATH];
        DWORD len = GetModuleFileNameA(nullptr, buf, MAX_PATH);
        if (len > 0 && len < MAX_PATH) {
            return std::string(buf, len);
        }
        return {};
#elif defined(RC_PLATFORM_SWITCH)
        // No /proc/self/exe equivalent on Horizon OS, and this is dead code
        // anyway: the only caller (autoupdater.cpp) is compiled out whenever
        // RC_PLATFORM_NULL is set, which every current Switch build defines.
        return {};
#else
        char buf[PATH_MAX];
        ssize_t len = readlink("/proc/self/exe", buf, sizeof(buf) - 1);
        if (len > 0) {
            buf[len] = '\0';
            return std::string(buf);
        }
        return {};
#endif
    }

    std::string GetExecutableDir() {
        const std::string path = GetExecutablePath();
        const size_t pos = path.find_last_of("\\/");
        return (pos != std::string::npos) ? path.substr(0, pos) : ".";
    }

    std::string GetTempDir() {
#if defined(_WIN32)
        char buf[MAX_PATH];
        DWORD len = GetTempPathA(MAX_PATH, buf);
        if (len > 0 && len < MAX_PATH) {
            return std::string(buf);
        }
        return "C:\\Windows\\Temp\\";
#else
        const char* tmp = std::getenv("TMPDIR");
        if (!tmp) tmp = "/tmp";
        std::string result(tmp);
        if (!result.empty() && result.back() != '/') result += '/';
        return result;
#endif
    }
}
