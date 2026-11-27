// Notification Center overlay helper (netcoreapp3.1, run by the TV's dotnet as the Shard asks).
// One notification above the running picture for a few seconds: a flat bar, an animated glass bar or a large dark panel.
// The window is like the Vetro launcher's: notification level, transparent, no focus, no input.
//   dotnet ncoverlay.dll --file <job.txt>
//
// The job file is UTF-8 text, one value per line (never shell arguments, so no text can reach a shell):
//   1 title (may be empty)   2 message   3 accent colour as 6 hex digits   4 seconds (1-120)   5 opacity of the background (20-100)
//   6 optional: absolute path of a PNG icon, drawn on the left (decoded by this program; up to 2 MB and 1024x1024)
//   7 optional: absolute path of a second PNG icon, drawn on the right (for example the away club)
//   8 optional: 1 = animated (without it, or when the animator cannot run, the bar is simply there)
//   9 optional: "top" = the bar near the top of the screen
//  10 optional: the look, "glass" or "panel"; anything else is the flat bar
using System;
using System.Collections.Generic;
using System.IO;
using System.Globalization;
using System.Runtime.InteropServices;

internal static class NcOverlay
{
    private const int ElmWinNotification = 12;
    private const int NotificationLevelTop = 40;
    private const int ScreenW = 1920, ScreenH = 1080;
    private const int BarW = 1600, BarMargin = 90, IconSize = 128, Radius = 36, Slide = 90;
    private const int PanelW = 1760, PanelH = 940, PanelIcon = 380, PanelMinAlpha = 240;
    private const double EnterDelay = 0.6, EnterSeconds = 0.6, LeaveSeconds = 0.4;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int TaskCb(IntPtr data);

    private static readonly TaskCb QuitCb = QuitLoop, FrameCb = Frame, SettleCb = Settle, LeaveCb = Leave, EnterCb = Enter;
    private const string Elm = "libelementary.so.1", Evas = "libevas.so.1", Ecore = "libecore.so.1", Util = "libcapi-ui-efl-util.so.0";

    [DllImport(Elm)] private static extern int elm_init(int argc, IntPtr argv);
    [DllImport(Elm)] private static extern IntPtr elm_win_add(IntPtr parent, string name, int type);
    [DllImport(Elm)] private static extern void elm_win_alpha_set(IntPtr win, int alpha);
    [DllImport(Elm)] private static extern void elm_win_borderless_set(IntPtr win, int borderless);
    [DllImport(Elm)] private static extern int elm_win_aux_hint_add(IntPtr win, string hint, string value);
    [DllImport(Elm)] private static extern void elm_win_layer_set(IntPtr win, int layer);
    [DllImport(Elm)] private static extern void elm_win_input_rect_set(IntPtr win, int x, int y, int w, int h);
    [DllImport(Elm)] private static extern void elm_win_prop_focus_skip_set(IntPtr win, int skip);
    [DllImport(Util)] private static extern int efl_util_set_notification_window_level(IntPtr win, int level);
    [DllImport(Evas)] private static extern IntPtr evas_object_evas_get(IntPtr obj);
    [DllImport(Evas)] private static extern IntPtr evas_object_image_add(IntPtr evas);
    [DllImport(Evas)] private static extern void evas_object_image_alpha_set(IntPtr obj, int alpha);
    [DllImport(Evas)] private static extern void evas_object_image_size_set(IntPtr obj, int w, int h);
    [DllImport(Evas)] private static extern void evas_object_image_data_set(IntPtr obj, IntPtr data);
    [DllImport(Evas)] private static extern void evas_object_image_data_update_add(IntPtr obj, int x, int y, int w, int h);
    [DllImport(Evas)] private static extern void evas_object_image_fill_set(IntPtr obj, int x, int y, int w, int h);
    [DllImport(Evas)] private static extern IntPtr evas_object_text_add(IntPtr evas);
    [DllImport(Evas)] private static extern void evas_object_text_font_set(IntPtr obj, string font, int size);
    [DllImport(Evas)] private static extern void evas_object_text_text_set(IntPtr obj, string text);
    [DllImport(Evas)] private static extern int evas_object_text_horiz_advance_get(IntPtr obj);
    [DllImport(Evas)] private static extern void evas_object_raise(IntPtr obj);
    [DllImport(Evas)] private static extern void evas_object_color_set(IntPtr obj, int r, int g, int b, int a);
    [DllImport(Evas)] private static extern void evas_object_pass_events_set(IntPtr obj, int pass);
    [DllImport(Evas)] private static extern void evas_object_move(IntPtr obj, int x, int y);
    [DllImport(Evas)] private static extern void evas_object_resize(IntPtr obj, int w, int h);
    [DllImport(Evas)] private static extern void evas_object_show(IntPtr obj);
    [DllImport(Evas)] private static extern void evas_object_hide(IntPtr obj);
    [DllImport(Ecore)] private static extern IntPtr ecore_timer_add(double seconds, TaskCb cb, IntPtr data);
    [DllImport(Ecore)] private static extern void ecore_main_loop_begin();
    [DllImport(Ecore)] private static extern void ecore_main_loop_quit();
    [DllImport(Ecore)] private static extern IntPtr ecore_animator_add(TaskCb cb, IntPtr data);
    [DllImport(Ecore)] private static extern double ecore_time_get();

    private static int QuitLoop(IntPtr data) { ecore_main_loop_quit(); return 0; }

    [DllImport("libc.so.6")] private static extern int setenv(string name, string value, int overwrite);
    [DllImport("libc.so.6")] private static extern uint getuid();

    // Needed to redraw a moving window. Follows Vetro's dock/src/Program.cs SetupEnvironment (MIT, (c) 2026 Vetro contributors).
    private static void Accelerate()
    {
        string run = "/run";
        foreach (string dir in new[] { "/run/user/5001", "/run", "/run/user/" + getuid(), Environment.GetEnvironmentVariable("XDG_RUNTIME_DIR") })
            if (!string.IsNullOrEmpty(dir) && File.Exists(dir + "/wayland-0")) run = dir;   // the last one found wins
        setenv("XDG_RUNTIME_DIR", run, 1);
        setenv("ELM_ENGINE", "gl", 1);
        setenv("ECORE_EVAS_ENGINE", "wayland_egl", 1);
        foreach (string pair in ("WAYLAND_DISPLAY=wayland-0 ELM_PROFILE=tv ELM_DISPLAY=wl EVAS_FONT_DPI=72 ELM_ACCEL=gl EVAS_GL_NO_BLACKLIST=1 " +
            "ECORE_EVAS_COMP_NOSYNC=1 ECORE_VSYNC_DRM_ALL=1 ECORE_EVAS_GL_SYNC_DRAW_DONE=1 EVAS_GL_PARTIAL_DISABLE=1").Split(' '))
            setenv(pair.Substring(0, pair.IndexOf('=')), pair.Substring(pair.IndexOf('=') + 1), 0);
    }

    // The first `max` characters and an ellipsis, never cutting a character of two halves (emoji) in two.
    private static string Clip(string s, int max)
    {
        if (s.Length <= max) return s;
        int n = max - 1;
        if (n > 0 && char.IsHighSurrogate(s[n - 1])) n--;
        return s.Substring(0, n) + "…";
    }

    // Everything on the bar, at its place inside it, so the whole bar can move and fade as one. Rgb is -1 for a picture.
    private struct Item { public IntPtr O; public int X, Y, Rgb; }
    private static readonly List<Item> Items = new List<Item>();
    private static int _originX, _originY, _slide, _span, _runner = -1;
    private static double _start;
    private static bool _leaving;

    private static void Add(IntPtr o, int x, int y, int rgb)
    {
        Items.Add(new Item { O = o, X = x, Y = y, Rgb = rgb });
        evas_object_raise(o);   // above what was added before, also for a label made earlier to measure text
        evas_object_show(o);
    }

    // p goes from 0 (invisible, shifted towards its edge of the screen) to 1 (in place). Colours are premultiplied by the alpha, as EFL expects.
    private static void Place(double p)
    {
        int y = _originY + (int)Math.Round((1 - p) * _slide), a = (int)Math.Round(255 * p);
        foreach (Item i in Items)
        {
            evas_object_move(i.O, _originX + i.X, y + i.Y);
            if (i.Rgb < 0) evas_object_color_set(i.O, a, a, a, a);
            else evas_object_color_set(i.O, ((i.Rgb >> 16) & 255) * a / 255, ((i.Rgb >> 8) & 255) * a / 255, (i.Rgb & 255) * a / 255, a);
        }
    }

    // Fades in or out, and moves the runner along the lower edge.
    private static int Frame(IntPtr data)
    {
        double now = ecore_time_get(), t = Math.Min(1, (now - _start) / (_leaving ? LeaveSeconds : EnterSeconds));
        if (_runner >= 0) { Item r = Items[_runner]; r.X = 40 + (int)(now * 400 % _span); Items[_runner] = r; }
        Place(_leaving ? 1 - t : t);
        return 1;
    }

    // In case it never ticks.
    private static int Settle(IntPtr data) { if (!_leaving) Place(1); return 0; }

    // After the first frame is drawn.
    private static int Enter(IntPtr data)
    {
        _start = ecore_time_get();
        try { ecore_animator_add(FrameCb, IntPtr.Zero); }
        catch (EntryPointNotFoundException) { Place(1); return 0; }
        ecore_timer_add(EnterSeconds + 0.15, SettleCb, IntPtr.Zero);
        return 0;
    }

    private static int Leave(IntPtr data) { _leaving = true; _start = ecore_time_get(); return 0; }

    // How much of pixel (i, j) is inside a rounded rectangle: 1 inside, 0 outside, in between on the curved edge.
    private static double Cover(int i, int j, int w, int h, int rad)
    {
        double dx = 0, dy = 0;
        if (i < rad) dx = rad - 0.5 - i; else if (i >= w - rad) dx = i - (w - rad) + 0.5;
        if (j < rad) dy = rad - 0.5 - j; else if (j >= h - rad) dy = j - (h - rad) + 0.5;
        if (dx <= 0 || dy <= 0) return 1;
        double d = Math.Sqrt(dx * dx + dy * dy);
        return d <= rad - 1 ? 1 : d >= rad ? 0 : rad - d;
    }

    private static int Pixel(double r, double g, double b, double a)
    {
        int al = (int)Math.Round(a);
        return (al << 24) | (((int)r * al / 255) << 16) | (((int)g * al / 255) << 8) | ((int)b * al / 255);
    }

    // A picture drawn from a pixel buffer (premultiplied ARGB), so no image file or decoder is needed.
    private static void Picture(IntPtr evas, int[] px, int x, int y, int w, int h)
    {
        IntPtr mem = Marshal.AllocHGlobal(px.Length * 4);   // kept until the process exits: the canvas reads it while the bar is up
        Marshal.Copy(px, 0, mem, px.Length);
        IntPtr img = evas_object_image_add(evas);
        evas_object_image_alpha_set(img, 1);
        evas_object_image_size_set(img, w, h);
        evas_object_image_data_set(img, mem);
        evas_object_image_data_update_add(img, 0, 0, w, h);
        evas_object_image_fill_set(img, 0, 0, w, h);
        evas_object_resize(img, w, h);
        Add(img, x, y, -1);
    }

    // The background: a rounded rectangle. Flat is one dark colour; glass is lighter at the top, with a thin bright edge that fades downwards (no blur).
    private static void Panel(IntPtr evas, int w, int h, int alpha, bool glass)
    {
        int[] px = new int[w * h];
        for (int j = 0; j < h; j++)
        {
            double t = j / (double)(h - 1), r = glass ? 40 - 28 * t : 10, g = glass ? 54 - 36 * t : 12, b = glass ? 82 - 52 * t : 18;
            int solid = Pixel(r, g, b, alpha);
            for (int i = 0; i < w; i++)
            {
                if (i >= Radius && i < w - Radius && (!glass || j >= 2 && j < h - 2)) { px[j * w + i] = solid; continue; }
                double inner = !glass ? 1 : i < 2 || j < 2 || i >= w - 2 || j >= h - 2 ? 0 : Cover(i - 2, j - 2, w - 4, h - 4, Radius - 2);
                double shine = (1 - inner) * (0.5 - 0.38 * t);
                px[j * w + i] = Pixel(r + (255 - r) * shine, g + (255 - g) * shine, b + (255 - b) * shine, (alpha + (255 - alpha) * shine) * Cover(i, j, w, h, Radius));
            }
        }
        Picture(evas, px, 0, 0, w, h);
    }

    // The stripe in the colour of the level.
    private static void Stripe(IntPtr evas, int x, int y, int w, int h, int rgb)
    {
        int[] px = new int[w * h];
        for (int j = 0; j < h; j++)
            for (int i = 0; i < w; i++)
                px[j * w + i] = Pixel((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255 * Cover(i, j, w, h, Math.Min(w, h) / 2));
        Picture(evas, px, x, y, w, h);
    }

    // A small PNG decoder (grey, grey+alpha, RGB, RGBA and palette with 8 bits per channel, grey and palette also with 1, 2 or 4; not interlaced),
    // because the EFL image loader is not available to this process.
    // Returns premultiplied-free RGBA bytes, or null for anything it does not understand or that is too big.
    private static byte[] DecodePng(byte[] f, out int w, out int h)
    {
        w = 0; h = 0;
        if (f.Length < 33 || f.Length > 2 * 1024 * 1024 || f[0] != 0x89 || f[1] != 0x50 || f[2] != 0x4E || f[3] != 0x47) return null;
        int pos = 8, depth = 0, ctype = 0, interlace = 0;
        byte[] plte = null, trns = null;
        MemoryStream idat = new MemoryStream();
        while (pos + 12 <= f.Length)
        {
            int len = (f[pos] << 24) | (f[pos + 1] << 16) | (f[pos + 2] << 8) | f[pos + 3];
            if (len < 0 || pos + 12 + len > f.Length) return null;
            string type = System.Text.Encoding.ASCII.GetString(f, pos + 4, 4);
            int d = pos + 8;
            if (type == "IHDR" && len >= 13)
            {
                w = (f[d] << 24) | (f[d + 1] << 16) | (f[d + 2] << 8) | f[d + 3];
                h = (f[d + 4] << 24) | (f[d + 5] << 16) | (f[d + 6] << 8) | f[d + 7];
                depth = f[d + 8]; ctype = f[d + 9]; interlace = f[d + 12];
            }
            else if (type == "PLTE") { plte = new byte[len]; Array.Copy(f, d, plte, 0, len); }
            else if (type == "tRNS") { trns = new byte[len]; Array.Copy(f, d, trns, 0, len); }
            else if (type == "IDAT") { idat.Write(f, d, len); }
            else if (type == "IEND") break;
            pos += 12 + len;
        }
        if (w < 1 || h < 1 || w > 1024 || h > 1024 || interlace != 0) return null;
        if (depth != 8 && !((depth == 1 || depth == 2 || depth == 4) && (ctype == 0 || ctype == 3))) return null;
        int ch;
        switch (ctype) { case 0: ch = 1; break; case 2: ch = 3; break; case 3: ch = 1; break; case 4: ch = 2; break; case 6: ch = 4; break; default: return null; }
        if (ctype == 3 && plte == null) return null;
        int stride = (w * ch * depth + 7) / 8, bpp = depth == 8 ? ch : 1, rawLen = (stride + 1) * h;
        byte[] raw = new byte[rawLen];
        idat.Position = 2;   // skip the zlib header
        try
        {
            using (System.IO.Compression.DeflateStream z = new System.IO.Compression.DeflateStream(idat, System.IO.Compression.CompressionMode.Decompress))
            {
                int got = 0, n;
                while (got < rawLen && (n = z.Read(raw, got, rawLen - got)) > 0) got += n;
                if (got < rawLen) return null;
            }
        }
        catch (InvalidDataException) { return null; }
        byte[] pix = new byte[stride * h];
        for (int y = 0; y < h; y++)
        {
            int ft = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
            for (int x = 0; x < stride; x++)
            {
                int a = x >= bpp ? pix[dst + x - bpp] : 0, b = y > 0 ? pix[dst - stride + x] : 0, c = (x >= bpp && y > 0) ? pix[dst - stride + x - bpp] : 0, v = raw[src + x];
                switch (ft)
                {
                    case 1: v += a; break;
                    case 2: v += b; break;
                    case 3: v += (a + b) / 2; break;
                    case 4:
                        int p = a + b - c, pa = Math.Abs(p - a), pb = Math.Abs(p - b), pc = Math.Abs(p - c);
                        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); break;
                    case 0: break;
                    default: return null;
                }
                pix[dst + x] = (byte)v;
            }
        }
        if (depth < 8)   // several pixels per byte, the first one in the high bits: one byte per pixel from here on
        {
            int mask = (1 << depth) - 1;
            byte[] one = new byte[w * h];
            for (int y = 0; y < h; y++)
            {
                for (int x = 0; x < w; x++)
                {
                    int v = (pix[y * stride + x * depth / 8] >> (8 - depth - x * depth % 8)) & mask;
                    one[y * w + x] = (byte)(ctype == 0 ? v * 255 / mask : v);
                }
            }
            pix = one;
        }
        byte[] rgba = new byte[w * h * 4];
        for (int i = 0; i < w * h; i++)
        {
            int r, g, b, a = 255;
            switch (ctype)
            {
                case 0: r = g = b = pix[i]; break;
                case 2: r = pix[i * 3]; g = pix[i * 3 + 1]; b = pix[i * 3 + 2]; break;
                case 3:
                    int k = pix[i];
                    if (k * 3 + 2 >= plte.Length) return null;
                    r = plte[k * 3]; g = plte[k * 3 + 1]; b = plte[k * 3 + 2];
                    if (trns != null && k < trns.Length) a = trns[k];
                    break;
                case 4: r = g = b = pix[i * 2]; a = pix[i * 2 + 1]; break;
                default: r = pix[i * 4]; g = pix[i * 4 + 1]; b = pix[i * 4 + 2]; a = pix[i * 4 + 3]; break;
            }
            rgba[i * 4] = (byte)r; rgba[i * 4 + 1] = (byte)g; rgba[i * 4 + 2] = (byte)b; rgba[i * 4 + 3] = (byte)a;
        }
        return rgba;
    }

    // The pixels of an icon file, or null when there is none or it cannot be decoded (the bar is then laid out without it).
    private static byte[] LoadIcon(string path, out int w, out int h)
    {
        w = 0; h = 0;
        try { return path.Length > 0 && Path.IsPathRooted(path) && File.Exists(path) ? DecodePng(File.ReadAllBytes(path), out w, out h) : null; }
        catch (IOException) { return null; }
        catch (UnauthorizedAccessException) { return null; }
    }

    // The icon fitted into a square of `size`, keeping its shape (box filter), with rounded corners, drawn through the same pixel-buffer path as the bar.
    private static void Icon(IntPtr evas, int x, int y, int size, byte[] src, int w, int h)
    {
        int dw = w >= h ? size : Math.Max(1, w * size / h), dh = h >= w ? size : Math.Max(1, h * size / w);
        int[] px = new int[dw * dh];
        int rad = Math.Min(dw, dh) / 5;
        for (int j = 0; j < dh; j++)
        {
            for (int i = 0; i < dw; i++)
            {
                int x0 = i * w / dw, x1 = Math.Max(x0 + 1, (i + 1) * w / dw), y0 = j * h / dh, y1 = Math.Max(y0 + 1, (j + 1) * h / dh);
                long sr = 0, sg = 0, sb = 0, sa = 0; int n = 0;
                for (int yy = y0; yy < y1 && yy < h; yy++)
                {
                    for (int xx = x0; xx < x1 && xx < w; xx++)
                    {
                        int o = (yy * w + xx) * 4, al = src[o + 3];
                        sr += src[o] * al; sg += src[o + 1] * al; sb += src[o + 2] * al; sa += al; n++;
                    }
                }
                if (n == 0) continue;
                double alpha = (sa / (double)n) / 255.0 * Cover(i, j, dw, dh, rad);   // premultiplied: colour = average of (colour * alpha) already
                int pa = (int)Math.Round(alpha * 255);
                double norm = sa > 0 ? 1.0 / sa : 0;   // weighted average colour, then premultiplied by the final alpha
                int pr = (int)Math.Round(sr * norm * alpha), pg = (int)Math.Round(sg * norm * alpha), pb = (int)Math.Round(sb * norm * alpha);
                px[j * dw + i] = (pa << 24) | (pr << 16) | (pg << 8) | pb;
            }
        }
        Picture(evas, px, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh);
    }

    private static IntPtr Label(IntPtr evas, int size)
    {
        IntPtr t = evas_object_text_add(evas);
        evas_object_text_font_set(t, "SamsungOne", size);
        return t;
    }

    private static int Width(IntPtr t, string value)
    {
        evas_object_text_text_set(t, value);
        return evas_object_text_horiz_advance_get(t);
    }

    // `value` as at most `lines` lines no wider than `max` pixels, cut between words where it can; what does not fit ends in an ellipsis.
    private static List<string> Wrap(IntPtr t, string value, int max, int lines)
    {
        List<string> result = new List<string>();
        string rest = value.Trim();
        while (rest.Length > 0 && result.Count < lines)
        {
            int n = rest.Length;
            while (n > 1 && Width(t, rest.Substring(0, n)) > max) n--;
            if (n < rest.Length && result.Count < lines - 1)
            {
                int cut = rest.LastIndexOf(' ', n);
                if (cut >= n / 2) n = cut; else if (n > 1 && char.IsHighSurrogate(rest[n - 1])) n--;
                result.Add(rest.Substring(0, n).TrimEnd());
                rest = rest.Substring(n).TrimStart();
                continue;
            }
            string line = rest.Substring(0, n);
            if (n < rest.Length) for (int k = n; k > 1; k--) { line = Clip(rest, k); if (Width(t, line) <= max) break; }
            result.Add(line);
            break;
        }
        return result;
    }

    // Text at (x, y), or centred in the `centre` pixels that start at x when that is more than 0.
    private static void Text(IntPtr t, int x, int y, string value, int rgb, int centre)
    {
        int w = Width(t, value);
        Add(t, centre > 0 ? x + Math.Max(0, (centre - w) / 2) : x, y, rgb);
    }

    // The bar: a logo at each end, the title and up to two lines between them.
    private static void DrawBar(IntPtr evas, int h, string title, List<string> body, IntPtr titleLabel, byte[] icon1, int w1, int h1, byte[] icon2, int w2, int h2)
    {
        int textH = 56 + ((title.Length > 0 ? 1 : 0) + body.Count) * 58;
        int tx = 58, ty = (h - textH) / 2 + 24;
        if (icon1 != null) { Icon(evas, 58, (h - IconSize) / 2, IconSize, icon1, w1, h1); tx = 58 + IconSize + 30; }
        if (icon2 != null) Icon(evas, BarW - 58 - IconSize, (h - IconSize) / 2, IconSize, icon2, w2, h2);
        if (title.Length > 0) { Text(titleLabel, tx, ty, title, 0xFFFFFF, 0); ty += 62; }
        foreach (string line in body) { Text(Label(evas, 38), tx, ty, line, 0xD6DEEE, 0); ty += 54; }
    }

    // The panel: large logos side by side, then the title and up to four lines, all centred.
    private static void DrawPanel(IntPtr evas, string title, List<string> body, IntPtr titleLabel, byte[] icon1, int w1, int h1, byte[] icon2, int w2, int h2)
    {
        int icons = (icon1 != null ? 1 : 0) + (icon2 != null ? 1 : 0);
        int total = (icons > 0 ? PanelIcon + 50 : 0) + (title.Length > 0 ? 110 : 0) + body.Count * 70;
        int y = (PanelH - total) / 2;
        if (icons > 0)
        {
            int x = (PanelW - (icons == 2 ? 2 * PanelIcon + 300 : PanelIcon)) / 2;
            if (icon1 != null) { Icon(evas, x, y, PanelIcon, icon1, w1, h1); x += PanelIcon + 300; }
            if (icon2 != null) Icon(evas, x, y, PanelIcon, icon2, w2, h2);
            y += PanelIcon + 50;
        }
        if (title.Length > 0) { Text(titleLabel, 80, y, title, 0xFFFFFF, PanelW - 160); y += 110; }
        foreach (string line in body) { Text(Label(evas, 52), 80, y, line, 0xD6DEEE, PanelW - 160); y += 70; }
    }

    private static int Main(string[] args)
    {
        if (args.Length != 2 || args[0] != "--file") { Console.Error.WriteLine("usage: ncoverlay --file job.txt"); return 2; }
        string[] lines;
        try
        {
            FileInfo fi = new FileInfo(args[1]);
            if (!fi.Exists || fi.Length > 8192) { Console.Error.WriteLine("job file missing or too big"); return 2; }
            lines = File.ReadAllText(args[1], System.Text.Encoding.UTF8).Split('\n');
        }
        catch (IOException) { Console.Error.WriteLine("job file unreadable"); return 2; }
        Func<int, string> at = delegate (int n) { return n < lines.Length ? lines[n].TrimEnd('\r') : ""; };

        string title = at(0).Trim();
        string message = at(1).Trim();
        int accent;
        if (at(2).Length != 6 || !int.TryParse(at(2), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out accent)) accent = 0x00beff;
        int seconds;
        if (!int.TryParse(at(3), NumberStyles.Integer, CultureInfo.InvariantCulture, out seconds)) seconds = 6;
        seconds = Math.Max(1, Math.Min(120, seconds));
        int opacity;
        if (!int.TryParse(at(4), NumberStyles.Integer, CultureInfo.InvariantCulture, out opacity)) opacity = 88;
        opacity = Math.Max(20, Math.Min(100, opacity));
        if (title.Length == 0 && message.Length == 0) return 2;
        bool panel = at(9) == "panel", glass = at(9) == "glass";
        bool motion = (panel || glass) && at(7) == "1", onTop = !panel && at(8) == "top";

        int w1, h1, w2, h2;
        byte[] icon1 = LoadIcon(at(5).Trim(), out w1, out h1), icon2 = LoadIcon(at(6).Trim(), out w2, out h2);
        if (motion) Accelerate();
        elm_init(0, IntPtr.Zero);
        IntPtr win = elm_win_add(IntPtr.Zero, "nc-overlay", ElmWinNotification);
        if (win == IntPtr.Zero) { Console.Error.WriteLine("elm_win_add failed"); return 1; }
        elm_win_alpha_set(win, 1);
        elm_win_borderless_set(win, 1);
        elm_win_prop_focus_skip_set(win, 1);
        efl_util_set_notification_window_level(win, NotificationLevelTop);
        elm_win_layer_set(win, 900);
        elm_win_input_rect_set(win, 0, 0, 0, 0);
        elm_win_aux_hint_add(win, "wm.comp.win.effect.enable", "0");
        IntPtr evas = evas_object_evas_get(win);
        if (evas == IntPtr.Zero) return 1;

        // The text is measured on the canvas before the window gets its size.
        IntPtr titleLabel = Label(evas, panel ? 80 : 46);
        int icons = (icon1 != null ? 1 : 0) + (icon2 != null ? 1 : 0);
        int textW = panel ? PanelW - 160 : BarW - 116 - icons * (IconSize + 30);
        List<string> head = Wrap(titleLabel, title, textW, 1);
        title = head.Count > 0 ? head[0] : "";
        List<string> body = Wrap(Label(evas, panel ? 52 : 38), message, textW, panel ? 4 : 2);
        int textH = 56 + ((title.Length > 0 ? 1 : 0) + body.Count) * 58;
        int boxW = panel ? PanelW : BarW, boxH = panel ? PanelH : icons > 0 ? Math.Max(textH, IconSize + 48) : textH;
        int top = panel ? (ScreenH - boxH) / 2 : onTop ? BarMargin : ScreenH - BarMargin - boxH, left = (ScreenW - boxW) / 2;
        // Animated: the window is the box and the room it slides through.
        _slide = panel ? 0 : onTop ? -Slide : Slide;
        int room = Math.Abs(_slide);
        _originX = motion ? 0 : left;
        _originY = !motion ? top : onTop ? room : 0;
        if (motion) elm_win_aux_hint_add(win, "wm.policy.win.user.geometry", "1");
        evas_object_move(win, motion ? left : 0, !motion ? 0 : onTop ? top - room : top);
        evas_object_resize(win, motion ? boxW : ScreenW, motion ? boxH + room : ScreenH);

        int alpha = 255 * opacity / 100;
        Panel(evas, boxW, boxH, panel ? Math.Max(alpha, PanelMinAlpha) : alpha, glass);
        Stripe(evas, 22, 20, 12, boxH - 40, accent);
        if (motion) { _runner = Items.Count; _span = boxW - 240; Stripe(evas, 40, boxH - 14, 160, 8, accent); }
        if (panel) DrawPanel(evas, title, body, titleLabel, icon1, w1, h1, icon2, w2, h2);
        else DrawBar(evas, boxH, title, body, titleLabel, icon1, w1, h1, icon2, w2, h2);

        Place(motion ? 0.01 : 1);
        evas_object_pass_events_set(win, 1);
        evas_object_show(win);
        if (motion)
        {
            ecore_timer_add(EnterDelay, EnterCb, IntPtr.Zero);
            ecore_timer_add(seconds - LeaveSeconds, LeaveCb, IntPtr.Zero);
        }
        ecore_timer_add(seconds, QuitCb, IntPtr.Zero);
        ecore_main_loop_begin();
        // The vendor notification window must not be deleted in a short-lived client: hide it and let the process exit close everything.
        evas_object_hide(win);
        return 0;
    }
}
