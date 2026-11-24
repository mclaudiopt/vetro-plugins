// Notification Center overlay helper (netcoreapp3.1, run by the TV's dotnet as the Shard asks).
// Draws one bar near the bottom of the screen, above the running picture, for a few seconds, then exits.
// The window is the same kind the Vetro launcher uses (notification level, transparent, no focus, no input), so it never interrupts what is playing.
//
//   dotnet ncoverlay.dll --file <job.txt>
//
// The job file is UTF-8 text, one value per line (never shell arguments, so no text can reach a shell):
//   1 title (may be empty)   2 message   3 accent colour as 6 hex digits   4 seconds (1-120)   5 opacity of the bar (20-100)
//   6 optional: absolute path of a PNG icon (decoded by this program; up to 2 MB and 1024x1024)
using System;
using System.IO;
using System.Globalization;
using System.Runtime.InteropServices;

internal static class NcOverlay
{
    private const int ElmWinNotification = 12;
    private const int NotificationLevelTop = 40;
    private const int ScreenW = 1920, ScreenH = 1080;
    private const int BarW = 1600, BarMarginBottom = 90, LineChars = 66, Radius = 36;

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int TaskCb(IntPtr data);

    private static readonly TaskCb QuitCb = QuitLoop;
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
    [DllImport(Evas)] private static extern void evas_object_color_set(IntPtr obj, int r, int g, int b, int a);
    [DllImport(Evas)] private static extern void evas_object_pass_events_set(IntPtr obj, int pass);
    [DllImport(Evas)] private static extern void evas_object_move(IntPtr obj, int x, int y);
    [DllImport(Evas)] private static extern void evas_object_resize(IntPtr obj, int w, int h);
    [DllImport(Evas)] private static extern void evas_object_show(IntPtr obj);
    [DllImport(Evas)] private static extern void evas_object_hide(IntPtr obj);
    [DllImport(Ecore)] private static extern IntPtr ecore_timer_add(double seconds, TaskCb cb, IntPtr data);
    [DllImport(Ecore)] private static extern void ecore_main_loop_begin();
    [DllImport(Ecore)] private static extern void ecore_main_loop_quit();

    private static int QuitLoop(IntPtr data) { ecore_main_loop_quit(); return 0; }

    private static string Clip(string s, int max)
    {
        s = (s ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
        return s.Length <= max ? s : s.Substring(0, max - 1) + "…";
    }

    // A rounded, anti-aliased rectangle drawn into a pixel buffer (premultiplied ARGB), so no image file or decoder is needed.
    private static IntPtr RoundedRect(IntPtr evas, int x, int y, int w, int h, int radius, int r, int g, int b, int a)
    {
        int[] px = new int[w * h];
        int rad = Math.Min(radius, Math.Min(w, h) / 2);
        for (int j = 0; j < h; j++)
        {
            for (int i = 0; i < w; i++)
            {
                double dx = 0, dy = 0;
                if (i < rad) dx = rad - 0.5 - i; else if (i >= w - rad) dx = i - (w - rad) + 0.5;
                if (j < rad) dy = rad - 0.5 - j; else if (j >= h - rad) dy = j - (h - rad) + 0.5;
                double cover = 1.0;
                if (dx > 0 && dy > 0)
                {
                    double d = Math.Sqrt(dx * dx + dy * dy);
                    cover = d <= rad - 1 ? 1.0 : d >= rad ? 0.0 : rad - d;
                }
                int al = (int)Math.Round(a * cover);
                px[j * w + i] = (al << 24) | ((r * al / 255) << 16) | ((g * al / 255) << 8) | (b * al / 255);
            }
        }
        IntPtr mem = Marshal.AllocHGlobal(px.Length * 4);   // kept until the process exits: the canvas reads it while the bar is up
        Marshal.Copy(px, 0, mem, px.Length);
        IntPtr img = evas_object_image_add(evas);
        evas_object_image_alpha_set(img, 1);
        evas_object_image_size_set(img, w, h);
        evas_object_image_data_set(img, mem);
        evas_object_image_data_update_add(img, 0, 0, w, h);
        evas_object_image_fill_set(img, 0, 0, w, h);
        evas_object_move(img, x, y);
        evas_object_resize(img, w, h);
        evas_object_show(img);
        return img;
    }

    // A small PNG decoder (8-bit grey, grey+alpha, RGB, RGBA and palette; not interlaced), because the EFL image loader is not available to this process.
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
        if (w < 1 || h < 1 || w > 1024 || h > 1024 || depth != 8 || interlace != 0) return null;
        int ch;
        switch (ctype) { case 0: ch = 1; break; case 2: ch = 3; break; case 3: ch = 1; break; case 4: ch = 2; break; case 6: ch = 4; break; default: return null; }
        if (ctype == 3 && plte == null) return null;
        int stride = w * ch, rawLen = (stride + 1) * h;
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
                int a = x >= ch ? pix[dst + x - ch] : 0, b = y > 0 ? pix[dst - stride + x] : 0, c = (x >= ch && y > 0) ? pix[dst - stride + x - ch] : 0, v = raw[src + x];
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

    // The icon scaled to size x size (box filter), with rounded corners, drawn through the same pixel-buffer path as the bar.
    private static void Icon(IntPtr evas, int x, int y, int size, string path)
    {
        try
        {
            if (!Path.IsPathRooted(path) || !File.Exists(path)) return;
            int w, h;
            byte[] src = DecodePng(File.ReadAllBytes(path), out w, out h);
            if (src == null) return;
            int[] px = new int[size * size];
            int rad = size / 5;
            for (int j = 0; j < size; j++)
            {
                for (int i = 0; i < size; i++)
                {
                    int x0 = i * w / size, x1 = Math.Max(x0 + 1, (i + 1) * w / size), y0 = j * h / size, y1 = Math.Max(y0 + 1, (j + 1) * h / size);
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
                    double dx = 0, dy = 0;
                    if (i < rad) dx = rad - 0.5 - i; else if (i >= size - rad) dx = i - (size - rad) + 0.5;
                    if (j < rad) dy = rad - 0.5 - j; else if (j >= size - rad) dy = j - (size - rad) + 0.5;
                    double cover = 1.0;
                    if (dx > 0 && dy > 0) { double d = Math.Sqrt(dx * dx + dy * dy); cover = d <= rad - 1 ? 1.0 : d >= rad ? 0.0 : rad - d; }
                    double alpha = (sa / (double)n) / 255.0 * cover;   // premultiplied: colour = average of (colour * alpha) already
                    int pa = (int)Math.Round(alpha * 255);
                    double norm = sa > 0 ? 1.0 / sa : 0;   // weighted average colour, then premultiplied by the final alpha
                    int pr = (int)Math.Round(sr * norm * alpha), pg = (int)Math.Round(sg * norm * alpha), pb = (int)Math.Round(sb * norm * alpha);
                    px[j * size + i] = (pa << 24) | (pr << 16) | (pg << 8) | pb;
                }
            }
            IntPtr mem = Marshal.AllocHGlobal(px.Length * 4);
            Marshal.Copy(px, 0, mem, px.Length);
            IntPtr img = evas_object_image_add(evas);
            evas_object_image_alpha_set(img, 1);
            evas_object_image_size_set(img, size, size);
            evas_object_image_data_set(img, mem);
            evas_object_image_data_update_add(img, 0, 0, size, size);
            evas_object_image_fill_set(img, 0, 0, size, size);
            evas_object_move(img, x, y);
            evas_object_resize(img, size, size);
            evas_object_show(img);
        }
        catch (IOException) { /* no icon: the bar is shown without it */ }
        catch (UnauthorizedAccessException) { }
    }

    private static void Text(IntPtr evas, int x, int y, string value, int size, int r, int g, int b)
    {
        IntPtr t = evas_object_text_add(evas);
        evas_object_text_font_set(t, "SamsungOne", size);
        evas_object_text_text_set(t, value);
        evas_object_color_set(t, r, g, b, 255);
        evas_object_move(t, x, y);
        evas_object_show(t);
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

        string title = Clip(at(0), 60);
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

        string line1 = message, line2 = "";
        if (message.Length > LineChars)
        {
            int cut = message.LastIndexOf(' ', LineChars);
            if (cut < LineChars / 2) cut = LineChars;
            line1 = message.Substring(0, cut).TrimEnd();
            line2 = Clip(message.Substring(cut).TrimStart(), LineChars);
        }
        int lineCount = (title.Length > 0 ? 1 : 0) + (line1.Length > 0 ? 1 : 0) + (line2.Length > 0 ? 1 : 0);
        string icon = at(5).Trim();
        bool hasIcon = icon.Length > 0 && Path.IsPathRooted(icon) && File.Exists(icon);
        int textH = 56 + lineCount * 58;
        int bodyH = hasIcon ? Math.Max(textH, 176) : textH;
        int top = ScreenH - BarMarginBottom - bodyH, left = (ScreenW - BarW) / 2;

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
        evas_object_move(win, 0, 0);
        evas_object_resize(win, ScreenW, ScreenH);
        IntPtr evas = evas_object_evas_get(win);
        if (evas == IntPtr.Zero) return 1;

        RoundedRect(evas, left, top, BarW, bodyH, Radius, 10, 12, 18, 255 * opacity / 100);
        RoundedRect(evas, left + 22, top + 20, 12, bodyH - 40, 6, (accent >> 16) & 255, (accent >> 8) & 255, accent & 255, 255);
        int tx = left + 58, ty = top + (bodyH - textH) / 2 + 24;
        if (hasIcon) { Icon(evas, left + 58, top + (bodyH - 128) / 2, 128, icon); tx = left + 58 + 128 + 30; }
        if (title.Length > 0) { Text(evas, tx, ty, title, 46, 255, 255, 255); ty += 62; }
        if (line1.Length > 0) { Text(evas, tx, ty, line1, 38, 214, 222, 238); ty += 54; }
        if (line2.Length > 0) { Text(evas, tx, ty, line2, 38, 214, 222, 238); }

        evas_object_pass_events_set(win, 1);
        evas_object_show(win);
        ecore_timer_add(seconds, QuitCb, IntPtr.Zero);
        ecore_main_loop_begin();
        // The vendor notification window must not be deleted in a short-lived client: hide it and let the process exit close everything.
        evas_object_hide(win);
        return 0;
    }
}
