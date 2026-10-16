# Kotodama relay: PC control helper (mouse / keyboard / AI cursor overlay)
# Protocol: one JSON object per line on stdin, one JSON reply per line on stdout. Text is base64 (UTF-8).
# Emergency stop: pressing the physical Esc key stops everything (an {"event":"esc"} line is written).
$ErrorActionPreference = 'Stop'
if ($env:CONTROL_DRY -eq '1') { $dry = $true } else { $dry = $false }

Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Core -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public class AiCtl : Form
{
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);

    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] struct IU { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public IU u; }

    static AiCtl inst;
    static Rectangle scr = new Rectangle(0, 0, 1920, 1080);
    static Rectangle virt;
    public static volatile bool Esc;
    public static bool Dry;
    static volatile bool injecting;
    float ax = -200, ay = -200;
    DateTime rippleAt = DateTime.MinValue;
    bool shown = false;

    static AiCtl() { try { SetProcessDPIAware(); } catch (Exception) { } }

    AiCtl()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        TopMost = true;
        virt = SystemInformation.VirtualScreen;
        Bounds = virt;
        BackColor = Color.Magenta;
        TransparencyKey = Color.Magenta;
        DoubleBuffered = true;
        var t = new System.Windows.Forms.Timer();
        t.Interval = 33;
        t.Tick += (s, e) => { if (shown && (DateTime.Now - rippleAt).TotalMilliseconds < 800) Invalidate(); };
        t.Start();
    }

    protected override CreateParams CreateParams
    {
        get { var cp = base.CreateParams; cp.ExStyle |= 0x80 | 0x20 | 0x08000000; return cp; } // TOOLWINDOW | TRANSPARENT | NOACTIVATE
    }
    protected override bool ShowWithoutActivation { get { return true; } }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        if (!shown) return;
        float x = ax - virt.X, y = ay - virt.Y;
        double age = (DateTime.Now - rippleAt).TotalMilliseconds;
        if (age < 800)
        {
            float r = 10 + (float)(age / 800.0 * 52);
            int a = (int)(255 * (1 - age / 800.0));
            using (var p = new Pen(Color.FromArgb(a, 255, 60, 190), 5)) g.DrawEllipse(p, x - r, y - r, 2 * r, 2 * r);
            using (var p = new Pen(Color.FromArgb(a, 60, 140, 255), 3)) g.DrawEllipse(p, x - r * 0.65f, y - r * 0.65f, 2 * r * 0.65f, 2 * r * 0.65f);
        }
        var pts = new PointF[] { new PointF(x, y), new PointF(x, y + 40), new PointF(x + 10, y + 31), new PointF(x + 19, y + 47), new PointF(x + 26, y + 43), new PointF(x + 17, y + 28), new PointF(x + 30, y + 28) };
        var rc = new RectangleF(x, y, 32, 48);
        using (var fill = new LinearGradientBrush(rc, Color.Red, Color.Blue, LinearGradientMode.Horizontal))
        {
            var cb = new ColorBlend(4);
            cb.Colors = new Color[] { Color.FromArgb(255, 235, 30, 40), Color.FromArgb(255, 235, 30, 40), Color.FromArgb(255, 30, 80, 245), Color.FromArgb(255, 30, 80, 245) };
            cb.Positions = new float[] { 0f, 0.42f, 0.5f, 1f };
            fill.InterpolationColors = cb;
            g.FillPolygon(fill, pts);
        }
        using (var rb = new LinearGradientBrush(rc, Color.Red, Color.Violet, LinearGradientMode.ForwardDiagonal))
        {
            var cb = new ColorBlend(7);
            cb.Colors = new Color[] { Color.Red, Color.Orange, Color.Yellow, Color.LimeGreen, Color.DeepSkyBlue, Color.Blue, Color.Violet };
            cb.Positions = new float[] { 0f, 0.17f, 0.33f, 0.5f, 0.67f, 0.83f, 1f };
            rb.InterpolationColors = cb;
            using (var pen = new Pen(rb, 3.5f)) { pen.LineJoin = LineJoin.Round; g.DrawPolygon(pen, pts); }
        }
    }

    public static void Start()
    {
        var th = new Thread(() => { inst = new AiCtl(); Application.Run(inst); });
        th.SetApartmentState(ApartmentState.STA);
        th.IsBackground = true;
        th.Start();
        for (int i = 0; i < 100 && (inst == null || !inst.IsHandleCreated); i++) Thread.Sleep(50);
        var esc = new Thread(() =>
        {
            while (true)
            {
                Thread.Sleep(40);
                if (!injecting && (GetAsyncKeyState(0x1B) & 0x8000) != 0)
                {
                    Esc = true; ShowArrow(false);
                    Console.Out.WriteLine("{\"event\":\"esc\"}"); Console.Out.Flush();
                    Thread.Sleep(500);
                }
            }
        });
        esc.IsBackground = true;
        esc.Start();
    }

    public static void ShowArrow(bool on)
    {
        var f = inst; if (f == null || !f.IsHandleCreated) return;
        f.BeginInvoke(new Action(() => { f.shown = on; if (on) f.Visible = true; f.Invalidate(); }));
    }
    static void Place(float x, float y, bool click)
    {
        var f = inst; if (f == null || !f.IsHandleCreated) return;
        f.ax = x; f.ay = y; if (click) f.rippleAt = DateTime.Now;
        f.BeginInvoke(new Action(() => f.Invalidate()));
    }

    public static string SetScreen(int w, int h)
    {
        Rectangle pick = Screen.PrimaryScreen.Bounds;
        foreach (var s in Screen.AllScreens) if (s.Bounds.Width == w && s.Bounds.Height == h) { pick = s.Bounds; break; }
        scr = pick; Esc = false;
        var c = Cursor.Position; Place(c.X, c.Y, false);
        return "{\"x\":" + pick.X + ",\"y\":" + pick.Y + ",\"w\":" + pick.Width + ",\"h\":" + pick.Height + "}";
    }

    static Point Map(double nx, double ny)
    {
        nx = Math.Max(0, Math.Min(1000, nx)); ny = Math.Max(0, Math.Min(1000, ny));
        return new Point(scr.X + (int)Math.Round(nx / 1000.0 * (scr.Width - 1)), scr.Y + (int)Math.Round(ny / 1000.0 * (scr.Height - 1)));
    }

    public static void Move(double nx, double ny)
    {
        var t = Map(nx, ny); var c = Cursor.Position;
        int steps = 12;
        for (int i = 1; i <= steps; i++)
        {
            if (Esc) return;
            double k = i / (double)steps; k = k * k * (3 - 2 * k);
            int x = (int)Math.Round(c.X + (t.X - c.X) * k), y = (int)Math.Round(c.Y + (t.Y - c.Y) * k);
            if (!Dry) SetCursorPos(x, y);
            Place(x, y, false);
            Thread.Sleep(14);
        }
    }

    public static void Click(double nx, double ny, string button, int count)
    {
        Move(nx, ny); if (Esc) return;
        var t = Map(nx, ny); Place(t.X, t.Y, true);
        uint down = button == "right" ? 0x8u : 0x2u, up = button == "right" ? 0x10u : 0x4u;
        for (int i = 0; i < count; i++)
        {
            if (Esc) return;
            if (!Dry) { mouse_event(down, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(40); mouse_event(up, 0, 0, 0, UIntPtr.Zero); }
            Thread.Sleep(80);
        }
    }

    public static void Scroll(double nx, double ny, bool hasPos, string dir, int n)
    {
        if (hasPos) Move(nx, ny);
        n = Math.Max(1, Math.Min(20, n));
        for (int i = 0; i < n; i++)
        {
            if (Esc) return;
            if (!Dry)
            {
                if (dir == "up") mouse_event(0x800, 0, 0, 120, UIntPtr.Zero);
                else if (dir == "down") mouse_event(0x800, 0, 0, -120, UIntPtr.Zero);
                else if (dir == "right") mouse_event(0x1000, 0, 0, 120, UIntPtr.Zero);
                else mouse_event(0x1000, 0, 0, -120, UIntPtr.Zero);
            }
            Thread.Sleep(60);
        }
    }

    public static void TypeText(string s)
    {
        if (s.Length > 600) s = s.Substring(0, 600);
        foreach (char ch in s)
        {
            if (Esc) return;
            if (ch == '\r') continue;
            if (ch == '\n') { Tap(0x0D); continue; }
            if (Dry) { Thread.Sleep(5); continue; }
            var arr = new INPUT[2];
            for (int i = 0; i < 2; i++)
            {
                arr[i].type = 1;
                arr[i].u.ki.wVk = 0; arr[i].u.ki.wScan = ch;
                arr[i].u.ki.dwFlags = (i == 0 ? 0x4u : 0x6u); // UNICODE (| KEYUP)
            }
            SendInput(2, arr, Marshal.SizeOf(typeof(INPUT)));
            Thread.Sleep(12);
        }
    }

    static bool Extended(int vk) { return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E; }
    static void Tap(int vk)
    {
        if (Dry) return;
        uint ex = Extended(vk) ? 1u : 0u;
        keybd_event((byte)vk, 0, ex, UIntPtr.Zero); Thread.Sleep(25); keybd_event((byte)vk, 0, ex | 2u, UIntPtr.Zero);
    }
    static int VkOf(string name)
    {
        string n = name.Trim().ToLowerInvariant();
        switch (n)
        {
            case "enter": case "return": return 0x0D;
            case "tab": return 0x09;
            case "esc": case "escape": return 0x1B;
            case "backspace": return 0x08;
            case "delete": case "del": return 0x2E;
            case "space": return 0x20;
            case "up": return 0x26; case "down": return 0x28; case "left": return 0x25; case "right": return 0x27;
            case "home": return 0x24; case "end": return 0x23; case "pageup": return 0x21; case "pagedown": return 0x22;
            case "ctrl": case "control": return 0x11; case "alt": return 0x12; case "shift": return 0x10;
        }
        if (n.Length == 1) { char c = char.ToUpperInvariant(n[0]); if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return c; }
        if (n.Length >= 2 && n[0] == 'f') { int f; if (int.TryParse(n.Substring(1), out f) && f >= 1 && f <= 12) return 0x70 + f - 1; }
        return -1;
    }

    public static string Shot(int maxW)
    {
        bool was = inst != null && inst.shown;
        if (was) { ShowArrow(false); Thread.Sleep(80); }
        var full = new Bitmap(scr.Width, scr.Height);
        using (var g = Graphics.FromImage(full)) g.CopyFromScreen(scr.X, scr.Y, 0, 0, scr.Size);
        if (was) ShowArrow(true);
        double k = Math.Min(1.0, maxW / (double)scr.Width);
        int w = Math.Max(1, (int)(scr.Width * k)), h = Math.Max(1, (int)(scr.Height * k));
        var o = new Bitmap(w, h);
        using (var g = Graphics.FromImage(o))
        {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.DrawImage(full, 0, 0, w, h);
            // AIが位置を読み取りやすいよう、0〜1000の目盛り線と数字を重ねる
            using (var pen = new Pen(Color.FromArgb(70, 255, 0, 200), 1))
            using (var font = new Font("Arial", 9, FontStyle.Bold))
            using (var bg = new SolidBrush(Color.FromArgb(185, 0, 0, 0)))
            using (var fg = new SolidBrush(Color.FromArgb(255, 255, 235, 90)))
            {
                for (int i = 100; i < 1000; i += 100)
                {
                    float x = w * i / 1000f, y = h * i / 1000f;
                    g.DrawLine(pen, x, 0, x, h); g.DrawLine(pen, 0, y, w, y);
                    string s = i.ToString(); var sz = g.MeasureString(s, font);
                    g.FillRectangle(bg, x + 1, 1, sz.Width, sz.Height); g.DrawString(s, font, fg, x + 1, 1);
                    g.FillRectangle(bg, 1, y + 1, sz.Width, sz.Height); g.DrawString(s, font, fg, 1, y + 1);
                }
            }
        }
        full.Dispose();
        var enc = System.Linq.Enumerable.First(ImageCodecInfo.GetImageEncoders(), c => c.MimeType == "image/jpeg");
        var ps = new EncoderParameters(1); ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 72L);
        using (var ms = new System.IO.MemoryStream()) { o.Save(ms, enc, ps); o.Dispose(); return "{\"w\":" + w + ",\"h\":" + h + ",\"sw\":" + scr.Width + ",\"sh\":" + scr.Height + ",\"img\":\"" + Convert.ToBase64String(ms.ToArray()) + "\"}"; }
    }

    public static bool Confirm(string text)
    {
        var r = MessageBox.Show(text, "コトダマ：PCの操作", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2, MessageBoxOptions.DefaultDesktopOnly);
        return r == DialogResult.Yes;
    }

    public static string Key(string combo)
    {
        var parts = combo.Split('+');
        var mods = new System.Collections.Generic.List<int>();
        int key = -1;
        for (int i = 0; i < parts.Length; i++)
        {
            string p = parts[i].Trim().ToLowerInvariant();
            if (p == "win" || p == "windows" || p == "super" || p == "cmd") return "blocked: win key";
            int vk = VkOf(p); if (vk < 0) return "unknown key: " + parts[i];
            if (i < parts.Length - 1) mods.Add(vk); else key = vk;
        }
        if (key == 0x73 && mods.Contains(0x12)) return "blocked: alt+f4";
        injecting = true;
        try
        {
            foreach (int m in mods) if (!Dry) keybd_event((byte)m, 0, 0, UIntPtr.Zero);
            Tap(key);
            for (int i = mods.Count - 1; i >= 0; i--) if (!Dry) keybd_event((byte)mods[i], 0, 2, UIntPtr.Zero);
            Thread.Sleep(120);
        }
        finally { injecting = false; }
        return "";
    }
}
'@

function Reply($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush() }
[AiCtl]::Dry = $dry
[AiCtl]::Start()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $c = $null
    try { $c = $line | ConvertFrom-Json } catch { continue }
    $r = @{ id = $c.id; ok = $true }
    try {
        if ([AiCtl]::Esc -and $c.cmd -ne 'init' -and $c.cmd -ne 'stop' -and $c.cmd -ne 'ping' -and $c.cmd -ne 'confirm' -and $c.cmd -ne 'shot') {
            $r.ok = $false; $r.esc = $true
        } else {
            switch ($c.cmd) {
                'ping' { }
                'shot' { $r.shot = [AiCtl]::Shot([int]$c.maxw) }
                'confirm' { $r.yes = [AiCtl]::Confirm([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$c.t))) }
                'init' { $r.screen = [AiCtl]::SetScreen([int]$c.w, [int]$c.h); [AiCtl]::ShowArrow($true) }
                'move' { [AiCtl]::Move([double]$c.x, [double]$c.y) }
                'click' { [AiCtl]::Click([double]$c.x, [double]$c.y, [string]$c.b, [int]$c.n) }
                'scroll' { [AiCtl]::Scroll([double]$c.x, [double]$c.y, [bool]$c.pos, [string]$c.dir, [int]$c.n) }
                'type' { [AiCtl]::TypeText([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$c.t))) }
                'key' { $e = [AiCtl]::Key([string]$c.key); if ($e) { $r.ok = $false; $r.error = $e } }
                'stop' { [AiCtl]::ShowArrow($false); Reply $r; Start-Sleep -Milliseconds 200; exit }
                default { $r.ok = $false; $r.error = 'unknown command' }
            }
        }
    } catch { $r.ok = $false; $r.error = [string]$_.Exception.Message }
    if ([AiCtl]::Esc) { $r.esc = $true }
    Reply $r
}
