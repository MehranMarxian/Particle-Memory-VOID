// VOID / PARTICLE MEMORY — Windows screensaver wrapper.
//
// A single-file .scr: embeds the entire built web app (vite dist/) as
// resources, serves it on a random localhost port from a tiny hand-rolled
// HTTP server, and launches Edge/Chrome in kiosk mode. The app itself runs
// the authored memory cycle and terminates on input; the /shutdown route
// (fetched by the app when the screensaver exits) closes everything.
//
// Windows screensaver contract:
//   /s            run the screensaver
//   /c            show configuration (we open the editor in a window)
//   /p <hwnd>     mini preview — not supported, exits immediately
//
// Build: see packaging/build.ps1  (csc from .NET Framework, no SDK needed)
// C# 5 dialect on purpose — compiles with the inbox Framework compiler.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;

namespace VoidScreensaver
{
    static class Program
    {
        static bool _shutdown;
        static Process _browser;
        static string _sourcesDir;

        static string ContentType(string path)
        {
            string ext = path.ToLowerInvariant();
            if (ext.EndsWith(".html")) return "text/html; charset=utf-8";
            if (ext.EndsWith(".js")) return "application/javascript; charset=utf-8";
            if (ext.EndsWith(".css")) return "text/css; charset=utf-8";
            if (ext.EndsWith(".png")) return "image/png";
            if (ext.EndsWith(".jpg") || ext.EndsWith(".jpeg")) return "image/jpeg";
            if (ext.EndsWith(".webp")) return "image/webp";
            if (ext.EndsWith(".bmp")) return "image/bmp";
            if (ext.EndsWith(".svg")) return "image/svg+xml";
            if (ext.EndsWith(".json")) return "application/json";
            if (ext.EndsWith(".ico")) return "image/x-icon";
            if (ext.EndsWith(".woff2")) return "font/woff2";
            return "application/octet-stream";
        }

        static byte[] ReadAll(Stream s)
        {
            using (var ms = new MemoryStream())
            {
                byte[] buf = new byte[8192];
                int n;
                while ((n = s.Read(buf, 0, buf.Length)) > 0) ms.Write(buf, 0, n);
                return ms.ToArray();
            }
        }

        static byte[] ResourceFor(string resName)
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            foreach (string name in asm.GetManifestResourceNames())
            {
                if (string.Equals(name, resName, StringComparison.OrdinalIgnoreCase))
                {
                    using (Stream rs = asm.GetManifestResourceStream(name))
                    {
                        return ReadAll(rs);
                    }
                }
            }
            return null;
        }

        static void SendResponse(NetworkStream stream, int status, string contentType, byte[] body)
        {
            string head = "HTTP/1.1 " + status + " " + (status == 200 ? "OK" : (status == 404 ? "Not Found" : "Error")) + "\r\n" +
                "Content-Type: " + contentType + "\r\n" +
                "Content-Length: " + body.Length + "\r\n" +
                "Cache-Control: no-cache\r\n" +
                "Connection: close\r\n\r\n";
            byte[] headBytes = Encoding.UTF8.GetBytes(head);
            stream.Write(headBytes, 0, headBytes.Length);
            if (body != null && body.Length > 0) stream.Write(body, 0, body.Length);
            stream.Flush();
        }

        static string[] ListUserSources()
        {
            var found = new List<string>();
            try
            {
                string[] exts = { ".png", ".jpg", ".jpeg", ".webp", ".bmp" };
                foreach (string f in Directory.GetFiles(_sourcesDir))
                {
                    string ext = Path.GetExtension(f).ToLowerInvariant();
                    foreach (string e in exts)
                    {
                        if (ext == e) { found.Add(Path.GetFileName(f)); break; }
                    }
                }
                found.Sort(StringComparer.OrdinalIgnoreCase);
            }
            catch { }
            return found.ToArray();
        }

        static readonly object LogLock = new object();

        static void LogHttp(Exception ex)
        {
            lock (LogLock)
            {
                try
                {
                    string line = DateTime.Now.ToString("HH:mm:ss.fff") + " " + ex.GetType().Name + " " + ex.Message + " | " + ex.StackTrace;
                    File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "void-http.log"), line + System.Environment.NewLine);
                }
                catch { }
            }
        }

        static void HandleClient(object obj)
        {
            TcpClient client = (TcpClient)obj;
            NetworkStream stream = null;
            try
            {
                stream = client.GetStream();
                stream.ReadTimeout = 10000;
                // Read the full request head (through the blank line) — the
                // first reads can be slow while the process JIT warms up.
                StringBuilder line = new StringBuilder();
                byte[] buf = new byte[8192];
                while (line.Length < 16384)
                {
                    int n = stream.Read(buf, 0, buf.Length);
                    if (n <= 0) break;
                    line.Append(Encoding.UTF8.GetString(buf, 0, n));
                    if (line.ToString().IndexOf("\r\n\r\n") >= 0) break;
                }
                string request = line.ToString().Split('\n')[0].TrimEnd('\r');
                string[] parts = request.Split(' ');
                if (parts.Length < 2 || parts[0] != "GET")
                {
                    SendResponse(stream, 400, "text/plain", Encoding.UTF8.GetBytes("bad request"));
                    return;
                }
                string raw = parts[1];
                int q = raw.IndexOf('?');
                string query = q >= 0 ? raw.Substring(q + 1) : "";
                string path = q >= 0 ? raw.Substring(0, q) : raw;
                if (path == "/") path = "/index.html";
                path = Uri.UnescapeDataString(path);

                if (path == "/shutdown")
                {
                    SendResponse(stream, 200, "text/plain", Encoding.UTF8.GetBytes("bye"));
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        Thread.Sleep(300);
                        _shutdown = true;
                    });
                    return;
                }

                if (path == "/sources/list.json")
                {
                    string[] list = ListUserSources();
                    var sb = new StringBuilder("{\"sources\":[");
                    for (int i = 0; i < list.Length; i++)
                    {
                        if (i > 0) sb.Append(",");
                        sb.Append("\"").Append(list[i].Replace("\"", "")).Append("\"");
                    }
                    sb.Append("]}");
                    SendResponse(stream, 200, "application/json", Encoding.UTF8.GetBytes(sb.ToString()));
                    return;
                }

                if (path.StartsWith("/sources/"))
                {
                    string name = Path.GetFileName(path.Substring("/sources/".Length));
                    string full = Path.Combine(_sourcesDir, name);
                    if (File.Exists(full) && name.IndexOf("..") < 0)
                    {
                        SendResponse(stream, 200, ContentType(name), File.ReadAllBytes(full));
                    }
                    else
                    {
                        SendResponse(stream, 404, "text/plain", Encoding.UTF8.GetBytes("no source"));
                    }
                    return;
                }

                // Embedded app resources: "/assets/foo.js" -> "assets.foo.js"
                string resName = path.TrimStart('/').Replace('/', '.').Replace("\\", ".");
                byte[] body = ResourceFor(resName);
                if (body == null)
                {
                    SendResponse(stream, 404, "text/plain", Encoding.UTF8.GetBytes("not found: " + resName));
                }
                else
                {
                    SendResponse(stream, 200, ContentType(path), body);
                }
            }
            catch (Exception ex)
            {
                LogHttp(ex);
            }
            finally
            {
                // Close gracefully: half-close (FIN) and drain the client's
                // remaining request bytes, or Windows sends RST and the
                // browser/caller loses the response.
                try { client.Client.Shutdown(SocketShutdown.Send); } catch { }
                try
                {
                    stream.ReadTimeout = 2000;
                    byte[] drain = new byte[4096];
                    while (stream.Read(drain, 0, drain.Length) > 0) { }
                }
                catch { }
                try { client.Close(); } catch { }
            }
        }

        static void ListenerLoop(object obj)
        {
            TcpListener listener = (TcpListener)obj;
            while (!_shutdown)
            {
                try
                {
                    if (listener.Pending())
                    {
                        TcpClient c = listener.AcceptTcpClient();
                        ThreadPool.QueueUserWorkItem(HandleClient, c);
                    }
                    else
                    {
                        Thread.Sleep(10);
                    }
                }
                catch
                {
                    if (_shutdown) return;
                }
            }
        }

        static string FindBrowser()
        {
            string custom = Environment.GetEnvironmentVariable("VOID_BROWSER");
            if (!string.IsNullOrEmpty(custom) && File.Exists(custom)) return custom;
            string[] candidates = new string[] {
                Environment.ExpandEnvironmentVariables(@"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
                Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
                Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
                Environment.ExpandEnvironmentVariables(@"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
                Environment.ExpandEnvironmentVariables(@"%LocalAppData%\Google\Chrome\Application\chrome.exe")
            };
            foreach (string c in candidates)
            {
                if (File.Exists(c)) return c;
            }
            return null;
        }

        static void Main(string[] args)
        {
            try
            {
                Run(args);
            }
            catch (Exception ex)
            {
                try
                {
                    File.WriteAllText(
                        Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "void-crash.log"),
                        ex.ToString());
                }
                catch { }
                throw;
            }
        }

        static void Run(string[] args)
        {
            string a0 = args.Length > 0 && args[0] != null ? args[0].ToLowerInvariant() : "";
            if (a0 == "/p" || a0 == "-p") return; // mini preview unsupported
            bool config = a0.StartsWith("/c") || a0.StartsWith("-c");
            string portFile = null;
            for (int i = 0; i < args.Length; i++)
            {
                string ai = (args[i] ?? "").ToLowerInvariant();
                if (ai.StartsWith("/port:") || ai.StartsWith("-port:"))
                    portFile = args[i].Substring(6);
            }

            _sourcesDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                "VOID", "Sources");
            try { Directory.CreateDirectory(_sourcesDir); } catch { }

            TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            ThreadPool.QueueUserWorkItem(ListenerLoop, listener);

            if (portFile != null)
            {
                File.WriteAllText(portFile, port.ToString());
            }
            string url = "http://localhost:" + port + "/" + (config ? "?config=1" : "?saver=1&installed=1");
            string exe = portFile != null ? null : FindBrowser();
            if (exe != null)
            {
                string profile = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "VOID", "Profile");
                try { Directory.CreateDirectory(profile); } catch { }
                // Persistent profile = the app's localStorage (last preset, last
                // source settings) survives between screensaver runs.
                string kiosk = config ? "--new-window " : "--kiosk --edge-kiosk-type=fullscreen ";
                string quote = "\"";
                string bargs = kiosk +
                    "--no-first-run --no-default-browser-check --disable-session-crashed-bubble " +
                    "--disable-features=Translate --autoplay-policy=no-user-gesture-required " +
                    "--user-data-dir=" + quote + profile + quote + " " + quote + url + quote;
                _browser = Process.Start(new ProcessStartInfo(exe, bargs) { UseShellExecute = false });
            }
            else
            {
                Process.Start(url); // default browser, no kiosk flags
            }

            while (!_shutdown)
            {
                Thread.Sleep(400);
                if (portFile != null) continue; // smoke mode: run until /shutdown or killed
                if (_browser != null && _browser.HasExited)
                {
                    // User closed the browser window (alt-f4 counts as input).
                    break;
                }
            }

            try { if (_browser != null && !_browser.HasExited) _browser.Kill(); } catch { }
            try { listener.Stop(); } catch { }
            Environment.Exit(0);
        }
    }
}
