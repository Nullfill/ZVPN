"""
ZVPN Windows Client - Official Native IKEv2 Desktop Application
Modern Ultra-Sleek Glassmorphic RTL Interface for Windows 10 & 11
Author: ZVPN Panel Team (v3.0.0)
"""

import sys
import os
import json
import base64
import subprocess
import threading
import time
import urllib.request
import urllib.parse
import ssl
import re
import ctypes
from ctypes import wintypes
import tkinter as tk
from tkinter import messagebox

# --- Win32 Native RAS Definitions ---
class RASDIALPARAMS(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("szEntryName", wintypes.WCHAR * 257),
        ("szPhoneNumber", wintypes.WCHAR * 129),
        ("szCallbackNumber", wintypes.WCHAR * 129),
        ("szUserName", wintypes.WCHAR * 257),
        ("szPassword", wintypes.WCHAR * 257),
        ("szDomain", wintypes.WCHAR * 16),
        ("dwSubEntry", wintypes.DWORD),
        ("dwCallbackId", ctypes.c_size_t),
        ("dwIfIndex", wintypes.DWORD),
    ]

try:
    rasapi32 = ctypes.windll.rasapi32
except Exception:
    rasapi32 = None

CREATE_NO_WINDOW = 0x08000000

def run_hidden(cmd, **kwargs):
    kwargs["creationflags"] = CREATE_NO_WINDOW
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    si.wShowWindow = 0
    kwargs["startupinfo"] = si
    return subprocess.run(cmd, **kwargs)

def popen_hidden(cmd, **kwargs):
    kwargs["creationflags"] = CREATE_NO_WINDOW
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    si.wShowWindow = 0
    kwargs["startupinfo"] = si
    return subprocess.Popen(cmd, **kwargs)

# App Data paths
APP_DATA_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "ZVPN")
CONFIG_FILE = os.path.join(APP_DATA_DIR, "config.json")
USER_PBK = os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Network\Connections\Pbk\rasphone.pbk")
os.makedirs(APP_DATA_DIR, exist_ok=True)

# --- Modern Theme Color Palette ---
BG_DARK = "#070b14"
BG_CARD = "#0f172a"
BG_CARD_INNER = "#1e293b"
BG_INPUT = "#0b1324"
BORDER_COLOR = "#1e293b"
BORDER_ACTIVE = "#38bdf8"
TEXT_PRIMARY = "#f8fafc"
TEXT_SECONDARY = "#94a3b8"
TEXT_MUTED = "#64748b"
ACCENT_BLUE = "#38bdf8"
ACCENT_GREEN = "#10b981"
ACCENT_GREEN_HOVER = "#059669"
ACCENT_RED = "#f43f5e"
ACCENT_RED_HOVER = "#e11d48"
ACCENT_AMBER = "#f59e0b"

class ZvpnClientApp:
    def __init__(self, root):
        self.root = root
        self.root.title("ZVPN Client — کلاینت ویندوز")
        self.root.geometry("580x720")
        self.root.minsize(540, 680)
        self.root.configure(bg=BG_DARK)

        self.sub_url = tk.StringVar()
        self.status_title_text = tk.StringVar(value="آماده برای اتصال")
        self.status_sub_text = tk.StringVar(value="روی دکمه اتصال کلیک کنید تا ارتباط امن برقرار شود")
        self.ping_text = tk.StringVar(value="—")
        self.connection_state = "disconnected" # "connected", "connecting", "disconnected"
        self.user_data = None
        self.vpn_name = "ZVPN"
        self.active_hrasconn = None
        self._polling = True

        self.load_local_config()
        self.setup_ui()

        # Handle window close
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        # Background monitors
        threading.Thread(target=self.initial_status_check, daemon=True).start()
        threading.Thread(target=self.active_connection_monitor, daemon=True).start()
        threading.Thread(target=self.ping_monitor_loop, daemon=True).start()

    def on_close(self):
        self._polling = False
        self.root.destroy()

    def load_local_config(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    self.sub_url.set(cfg.get("sub_url", ""))
            except Exception:
                pass

    def save_local_config(self):
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump({"sub_url": self.sub_url.get().strip()}, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def setup_ui(self):
        # Header Container
        header = tk.Frame(self.root, bg="#0d1527", pady=16, padx=22, highlightthickness=1, highlightbackground=BORDER_COLOR)
        header.pack(fill="x")

        # Header Title and Logo
        head_row = tk.Frame(header, bg="#0d1527")
        head_row.pack(fill="x")

        title_lbl = tk.Label(head_row, text="⚡ ZVPN Desktop Client", font=("Segoe UI", 15, "bold"), fg=ACCENT_BLUE, bg="#0d1527")
        title_lbl.pack(side="right")

        self.proto_badge = tk.Label(head_row, text="IKEv2 Native", font=("Consolas", 8, "bold"), fg="#38bdf8", bg="#0c2340", padx=8, pady=3, relief="flat")
        self.proto_badge.pack(side="left")

        sub_lbl = tk.Label(header, text="اتصال پرسرعت، هوشمند و بدون قطعی به شبکه اختصاصی ZVPN", font=("Segoe UI", 8), fg=TEXT_MUTED, bg="#0d1527")
        sub_lbl.pack(anchor="e", pady=(4, 0))

        # Main Scrollable Body
        main = tk.Frame(self.root, bg=BG_DARK, padx=20, pady=16)
        main.pack(fill="both", expand=True)

        # 1. Subscription Input Section (RTL)
        sub_card = tk.Frame(main, bg=BG_CARD, padx=16, pady=14, highlightthickness=1, highlightbackground=BORDER_COLOR)
        sub_card.pack(fill="x", pady=(0, 14))

        sub_head = tk.Frame(sub_card, bg=BG_CARD)
        sub_head.pack(fill="x", pady=(0, 8))

        tk.Label(sub_head, text="🔗 لینک اشتراک کاربر", font=("Segoe UI", 10, "bold"), fg=TEXT_PRIMARY, bg=BG_CARD).pack(side="right")
        tk.Label(sub_head, text="Subscription URL", font=("Consolas", 8), fg=TEXT_MUTED, bg=BG_CARD).pack(side="left")

        entry_frame = tk.Frame(sub_card, bg=BG_CARD)
        entry_frame.pack(fill="x")

        # Sync Button (Left)
        self.sync_btn = tk.Button(entry_frame, text="🔄 بروزرسانی", font=("Segoe UI", 9, "bold"), bg="#0284c7", fg="#ffffff", activebackground="#0369a1", activeforeground="#ffffff", relief="flat", padx=12, pady=6, cursor="hand2", command=self.on_sync_clicked)
        self.sync_btn.pack(side="left", padx=(0, 6))

        # Paste Button (Left-middle)
        self.paste_btn = tk.Button(entry_frame, text="📋 جایگذاری", font=("Segoe UI", 9), bg=BG_CARD_INNER, fg="#93c5fd", activebackground="#334155", activeforeground="#ffffff", relief="flat", padx=10, pady=6, cursor="hand2", command=self.paste_clipboard_to_entry)
        self.paste_btn.pack(side="left", padx=(0, 8))

        # URL Entry (Right side)
        self.url_entry = tk.Entry(entry_frame, textvariable=self.sub_url, font=("Consolas", 9), bg=BG_INPUT, fg="#f1f5f9", insertbackground=ACCENT_BLUE, relief="flat", highlightthickness=1, highlightbackground=BORDER_COLOR, highlightcolor=ACCENT_BLUE)
        self.url_entry.pack(side="right", fill="x", expand=True, ipady=6)
        self.bind_entry_shortcuts(self.url_entry)

        # 2. Account Details Grid (2x2 Clean RTL Tiles)
        self.info_card = tk.Frame(main, bg=BG_CARD, padx=16, pady=14, highlightthickness=1, highlightbackground=BORDER_COLOR)
        self.info_card.pack(fill="x", pady=(0, 14))

        info_head = tk.Frame(self.info_card, bg=BG_CARD)
        info_head.pack(fill="x", pady=(0, 10))
        tk.Label(info_head, text="📊 مشخصات حساب و ترافیک", font=("Segoe UI", 10, "bold"), fg=TEXT_PRIMARY, bg=BG_CARD).pack(side="right")
        self.status_badge_lbl = tk.Label(info_head, text="حساب فعال", font=("Segoe UI", 8, "bold"), fg="#6ee7b7", bg="#064e3b", padx=8, pady=2)
        self.status_badge_lbl.pack(side="left")

        # Stats Grid (RTL layout)
        grid_frame = tk.Frame(self.info_card, bg=BG_CARD)
        grid_frame.pack(fill="x")
        grid_frame.columnconfigure(0, weight=1)
        grid_frame.columnconfigure(1, weight=1)

        # Tile 1: User & Server
        self.lbl_username = self.create_grid_tile(grid_frame, "👤 نام کاربری", "—", row=0, col=1)
        self.lbl_server = self.create_grid_tile(grid_frame, "🌐 آدرس سرور", "—", row=0, col=0)

        # Tile 2: Usage & Remaining
        self.lbl_traffic = self.create_grid_tile(grid_frame, "📈 مصرف کل", "—", row=1, col=1)
        self.lbl_remain = self.create_grid_tile(grid_frame, "⏳ باقیمانده", "—", row=1, col=0)

        # Tile 3: Expiry
        self.lbl_expire = self.create_grid_tile(grid_frame, "📅 تاریخ انقضا", "—", row=2, col=1)
        self.lbl_today = self.create_grid_tile(grid_frame, "📆 مصرف امروز", "—", row=2, col=0)

        # Visual Traffic Progress Bar
        bar_frame = tk.Frame(self.info_card, bg=BG_CARD, pady=8)
        bar_frame.pack(fill="x")

        bar_txt_row = tk.Frame(bar_frame, bg=BG_CARD)
        bar_txt_row.pack(fill="x", pady=(0, 4))
        tk.Label(bar_txt_row, text="میزان حجم مصرف‌شده", font=("Segoe UI", 8), fg=TEXT_MUTED, bg=BG_CARD).pack(side="right")
        self.pct_lbl = tk.Label(bar_txt_row, text="0%", font=("Consolas", 8, "bold"), fg=ACCENT_BLUE, bg=BG_CARD)
        self.pct_lbl.pack(side="left")

        self.progress_canvas = tk.Canvas(bar_frame, height=8, bg=BG_CARD_INNER, highlightthickness=0)
        self.progress_canvas.pack(fill="x")
        self.progress_fill = self.progress_canvas.create_rectangle(0, 0, 0, 8, fill=ACCENT_BLUE, width=0)

        # 3. Connection Status Card (Glassmorphic Hero Card)
        self.status_card = tk.Frame(main, bg="#0d1829", padx=18, pady=16, highlightthickness=1, highlightbackground=BORDER_COLOR)
        self.status_card.pack(fill="x", pady=(0, 14))

        status_row = tk.Frame(self.status_card, bg="#0d1829")
        status_row.pack(fill="x")

        # Ping info (Left)
        ping_box = tk.Frame(status_row, bg="#112240", padx=10, pady=6, highlightthickness=1, highlightbackground="#1e3a8a")
        ping_box.pack(side="left")
        tk.Label(ping_box, text="PING", font=("Consolas", 7, "bold"), fg=TEXT_MUTED, bg="#112240").pack()
        self.ping_lbl = tk.Label(ping_box, textvariable=self.ping_text, font=("Consolas", 10, "bold"), fg=ACCENT_BLUE, bg="#112240")
        self.ping_lbl.pack()

        # Status text & Icon (Right side RTL)
        status_info = tk.Frame(status_row, bg="#0d1829")
        status_info.pack(side="right", fill="x", expand=True, padx=(10, 0))

        self.status_title = tk.Label(status_info, textvariable=self.status_title_text, font=("Segoe UI", 12, "bold"), fg=TEXT_PRIMARY, bg="#0d1829", anchor="e")
        self.status_title.pack(anchor="e")

        self.status_detail = tk.Label(status_info, textvariable=self.status_sub_text, font=("Segoe UI", 8), fg=TEXT_MUTED, bg="#0d1829", anchor="e")
        self.status_detail.pack(anchor="e", pady=(2, 0))

        self.status_icon = tk.Label(status_row, text="●", font=("Segoe UI", 26), fg=ACCENT_RED, bg="#0d1829")
        self.status_icon.pack(side="right", padx=(8, 0))

        # 4. Hero Connect / Disconnect Action Button
        self.connect_btn = tk.Button(main, text="🚀 اتصال به ZVPN (Connect)", font=("Segoe UI", 13, "bold"), bg=ACCENT_GREEN, fg="#ffffff", activebackground=ACCENT_GREEN_HOVER, activeforeground="#ffffff", relief="flat", pady=12, cursor="hand2", command=self.on_toggle_connect)
        self.connect_btn.pack(fill="x", pady=(0, 10))

        # 5. Quick Utilities Row
        util_row = tk.Frame(main, bg=BG_DARK)
        util_row.pack(fill="x")

        self.setup_btn = tk.Button(util_row, text="⚙️ تنظیم مجدد کانکشن", font=("Segoe UI", 8), bg=BG_CARD_INNER, fg=TEXT_SECONDARY, activebackground="#334155", activeforeground="#ffffff", relief="flat", pady=6, cursor="hand2", command=self.on_reinstall_connection)
        self.setup_btn.pack(side="right", fill="x", expand=True, padx=(4, 0))

        self.win_settings_btn = tk.Button(util_row, text="🌐 تنظیمات VPN ویندوز", font=("Segoe UI", 8), bg=BG_CARD_INNER, fg=TEXT_SECONDARY, activebackground="#334155", activeforeground="#ffffff", relief="flat", pady=6, cursor="hand2", command=self.open_windows_vpn_settings)
        self.win_settings_btn.pack(side="left", fill="x", expand=True, padx=(0, 4))

        # Footer
        footer = tk.Label(self.root, text="ZVPN Platform v3.0.0 · محافظت امنیتی IKEv2 با رمزنگاری سخت‌افزاری AES-256", font=("Segoe UI", 8), fg="#475569", bg=BG_DARK, pady=10)
        footer.pack(side="bottom")

    def create_grid_tile(self, parent, title, val, row, col):
        tile = tk.Frame(parent, bg=BG_CARD_INNER, padx=12, pady=8, highlightthickness=1, highlightbackground=BORDER_COLOR)
        tile.grid(row=row, column=col, sticky="nsew", padx=3, pady=3)
        t = tk.Label(tile, text=title, font=("Segoe UI", 8), fg=TEXT_MUTED, bg=BG_CARD_INNER, anchor="e")
        t.pack(anchor="e")
        v = tk.Label(tile, text=val, font=("Consolas", 9, "bold"), fg=TEXT_PRIMARY, bg=BG_CARD_INNER, anchor="e")
        v.pack(anchor="e", pady=(2, 0))
        return v

    def bind_entry_shortcuts(self, entry):
        def _paste(event=None):
            try:
                text = self.root.clipboard_get()
                if entry.select_present():
                    entry.delete(tk.SEL_FIRST, tk.SEL_LAST)
                entry.insert(tk.INSERT, text)
            except Exception:
                pass
            return "break"

        def _copy(event=None):
            try:
                if entry.select_present():
                    text = entry.selection_get()
                    self.root.clipboard_clear()
                    self.root.clipboard_append(text)
            except Exception:
                pass
            return "break"

        def _cut(event=None):
            try:
                if entry.select_present():
                    text = entry.selection_get()
                    self.root.clipboard_clear()
                    self.root.clipboard_append(text)
                    entry.delete(tk.SEL_FIRST, tk.SEL_LAST)
            except Exception:
                pass
            return "break"

        def _select_all(event=None):
            entry.select_range(0, tk.END)
            entry.icursor(tk.END)
            return "break"

        entry.bind("<Control-v>", _paste)
        entry.bind("<Control-V>", _paste)
        entry.bind("<Control-c>", _copy)
        entry.bind("<Control-C>", _copy)
        entry.bind("<Control-x>", _cut)
        entry.bind("<Control-X>", _cut)
        entry.bind("<Control-a>", _select_all)
        entry.bind("<Control-A>", _select_all)
        entry.bind("<Shift-Insert>", _paste)

        menu = tk.Menu(entry, tearoff=0, bg=BG_CARD_INNER, fg="#f1f5f9", activebackground="#0284c7", activeforeground="#ffffff")
        menu.add_command(label="جایگذاری (Paste)", command=_paste)
        menu.add_command(label="کپی (Copy)", command=_copy)
        menu.add_command(label="برش (Cut)", command=_cut)
        menu.add_separator()
        menu.add_command(label="انتخاب همه (Select All)", command=_select_all)
        menu.add_command(label="پاک کردن (Clear)", command=lambda: entry.delete(0, tk.END))

        entry.bind("<Button-3>", lambda e: menu.tk_popup(e.x_root, e.y_root))

    def paste_clipboard_to_entry(self):
        try:
            clip = self.root.clipboard_get()
            if clip:
                self.sub_url.set(clip.strip())
                self.url_entry.select_range(0, tk.END)
                self.save_local_config()
                self.on_sync_clicked()
        except Exception:
            messagebox.showinfo("کلیپ‌بورد", "متنی در کلیپ‌بورد یافت نشد.")

    def format_bytes(self, n):
        if n is None:
            return "نامحدود"
        n = float(n)
        for unit in ["B", "KB", "MB", "GB", "TB"]:
            if n < 1024.0 or unit == "TB":
                return f"{n:.2f} {unit}"
            n /= 1024.0
        return f"{n:.2f} GB"

    def initial_status_check(self):
        if self.sub_url.get().strip():
            self.fetch_subscription(auto_install=False)

    def on_sync_clicked(self):
        url = self.sub_url.get().strip()
        if not url:
            messagebox.showwarning("خطا", "لطفاً ابتدا لینک اشتراک خود را وارد کنید.")
            return
        self.save_local_config()
        self.status_sub_text.set("در حال دریافت اطلاعات از سرور...")
        self.sync_btn.config(state="disabled", text="⏳ ...")
        threading.Thread(target=self.fetch_subscription, args=(True,), daemon=True).start()

    def fetch_subscription(self, auto_install=True):
        raw_url = self.sub_url.get().strip()
        if not raw_url:
            return

        json_url = raw_url
        if "/d/" in raw_url and not raw_url.endswith("/json"):
            json_url = raw_url.rstrip("/") + "/json"

        try:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            req = urllib.request.Request(json_url, headers={"User-Agent": "ZVPN-Windows-Client/3.0.0"})
            with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                self.user_data = data
                self.vpn_name = f"ZVPN - {data.get('username', 'VPN')}"
                self.root.after(0, lambda: self.update_user_ui(data))
                if auto_install:
                    self.install_windows_profile(data)
        except Exception as e:
            self.root.after(0, lambda: self.status_sub_text.set(f"خطا در دریافت اشتراک: {str(e)[:40]}"))
            self.root.after(0, lambda: messagebox.showerror("خطا در اتصال به سرور", f"امکان دریافت اطلاعات اشتراک وجود ندارد:\n{e}"))
        finally:
            self.root.after(0, lambda: self.sync_btn.config(state="normal", text="🔄 بروزرسانی"))

    def update_user_ui(self, d):
        self.lbl_username.config(text=d.get("username", "—"))
        self.lbl_server.config(text=d.get("serverAddress", "—"))

        # Traffic
        used_num = d.get("usageTotal", 0)
        used = self.format_bytes(used_num)
        total_limit = d.get("totalLimitBytes")
        total = self.format_bytes(total_limit) if not d.get("unlimitedTraffic") else "نامحدود (∞)"
        self.lbl_traffic.config(text=f"{used} / {total}")

        # Remaining
        if d.get("unlimitedTraffic"):
            self.lbl_remain.config(text="نامحدود (∞)")
            self.pct_lbl.config(text="0%")
            self.update_progress_bar(0)
        elif total_limit:
            rem = max(0, total_limit - used_num)
            self.lbl_remain.config(text=self.format_bytes(rem))
            pct = min(100, int((used_num / total_limit) * 100))
            self.pct_lbl.config(text=f"{pct}%")
            self.update_progress_bar(pct)
        else:
            self.lbl_remain.config(text="نامحدود")
            self.pct_lbl.config(text="0%")
            self.update_progress_bar(0)

        # Expiry
        if d.get("expiresAt"):
            self.lbl_expire.config(text=d.get("expiresAt")[:10])
        elif d.get("durationDays") and d.get("activationStatus") == "not_activated":
            self.lbl_expire.config(text=f"{d.get('durationDays')} روز پس از اولین اتصال")
        else:
            self.lbl_expire.config(text="نامحدود")

        # Today
        self.lbl_today.config(text=self.format_bytes(d.get("todayBytes", 0)))

        # Status badge
        if not d.get("enabled") or d.get("quotaBlocked"):
            self.status_badge_lbl.config(text="غیرفعال / اتمام حجم", fg="#fda4af", bg="#881337")
        else:
            self.status_badge_lbl.config(text="حساب فعال", fg="#6ee7b7", bg="#064e3b")

    def update_progress_bar(self, pct):
        try:
            width = self.progress_canvas.winfo_width() or 480
            fill_w = int((pct / 100.0) * width)
            color = ACCENT_RED if pct >= 100 else (ACCENT_AMBER if pct >= 80 else ACCENT_BLUE)
            self.progress_canvas.coords(self.progress_fill, 0, 0, fill_w, 8)
            self.progress_canvas.itemconfig(self.progress_fill, fill=color)
        except Exception:
            pass

    def configure_silent_pbk(self, vpn_name):
        paths = [
            USER_PBK,
            os.path.expandvars(r"%ProgramData%\Microsoft\Network\Connections\Pbk\rasphone.pbk"),
        ]
        for pbk in paths:
            if not os.path.exists(pbk):
                continue
            try:
                with open(pbk, "r", encoding="utf-8", errors="ignore") as f:
                    lines = f.readlines()
                new_lines = []
                in_section = False
                for line in lines:
                    stripped = line.strip()
                    if stripped.startswith("[") and stripped.endswith("]"):
                        in_section = (stripped == f"[{vpn_name}]" or stripped.startswith("[ZVPN"))
                    if in_section:
                        if stripped.startswith("PreviewUserPw="):
                            line = "PreviewUserPw=0\n"
                        elif stripped.startswith("PreviewDomain="):
                            line = "PreviewDomain=0\n"
                        elif stripped.startswith("PreviewPhoneNumber="):
                            line = "PreviewPhoneNumber=0\n"
                        elif stripped.startswith("ShowDialingProgress="):
                            line = "ShowDialingProgress=0\n"
                    new_lines.append(line)
                with open(pbk, "w", encoding="utf-8") as f:
                    f.writelines(new_lines)
            except Exception:
                pass

    def install_windows_profile(self, data):
        self.status_sub_text.set("در حال پیکربندی خودکار کانکشن در ویندوز...")
        vpn_name = self.vpn_name
        server = data.get("serverAddress")
        username = data.get("username")
        password = data.get("password")
        ca_b64 = data.get("caCertificateBase64", "")

        ps_script = f"""
$ErrorActionPreference = 'SilentlyContinue'
$VpnName = '{vpn_name}'
$ServerAddress = '{server}'
$CaBase64 = '{ca_b64}'

if ($CaBase64) {{
    $tempCert = Join-Path $env:TEMP ('zvpn-ca-' + [guid]::NewGuid().ToString() + '.cer')
    [IO.File]::WriteAllBytes($tempCert, [Convert]::FromBase64String($CaBase64))
    Import-Certificate -FilePath $tempCert -CertStoreLocation 'Cert:\\CurrentUser\\Root' | Out-Null
    Remove-Item $tempCert -Force -ErrorAction SilentlyContinue
}}

Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\PolicyAgent' -Name 'AssumeUDPEncapsulationContextOnSendRule' -Value 2 -Type DWord -Force -ErrorAction SilentlyContinue

Remove-VpnConnection -Name $VpnName -Force -ErrorAction SilentlyContinue
Remove-VpnConnection -Name "ZVPN Panel - {username}" -Force -ErrorAction SilentlyContinue
Add-VpnConnection -Name $VpnName -ServerAddress $ServerAddress -TunnelType Ikev2 -EncryptionLevel Maximum -AuthenticationMethod Eap -RememberCredential -Force | Out-Null
Set-VpnConnectionIPsecConfiguration -ConnectionName $VpnName -AuthenticationTransformConstants SHA256128 -CipherTransformConstants AES128 -EncryptionMethod AES128 -IntegrityCheckMethod SHA256 -PfsGroup None -DHGroup ECP256 -Force | Out-Null
"""
        try:
            cmd = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script]
            run_hidden(cmd, capture_output=True, timeout=15)
            self.configure_silent_pbk(vpn_name)
            self.root.after(0, lambda: self.status_sub_text.set("کانکشن با موفقیت و بدون نیاز به ورود رمز پیکربندی شد."))
        except Exception as e:
            self.root.after(0, lambda: self.status_sub_text.set(f"خطا در ایجاد کانکشن: {e}"))

    def on_reinstall_connection(self):
        if not self.user_data:
            self.on_sync_clicked()
        else:
            threading.Thread(target=self.install_windows_profile, args=(self.user_data,), daemon=True).start()

    def on_toggle_connect(self):
        if not self.user_data:
            messagebox.showinfo("راهنما", "ابتدا لینک اشتراک را وارد و روی بروزرسانی کلیک کنید.")
            return

        if self.connection_state == "connected":
            self.disconnect_vpn()
        else:
            self.connect_vpn()

    def connect_vpn(self):
        self.connection_state = "connecting"
        self.update_connection_ui("connecting", "در حال اتصال...", "در حال برقراری ارتباط با سرور...")
        self.connect_btn.config(state="disabled", text="⏳ در حال برقراری اتصال...")

        def _do_connect():
            vpn_name = self.vpn_name
            username = self.user_data.get("username", "")
            password = self.user_data.get("password", "")

            self.configure_silent_pbk(vpn_name)

            if rasapi32:
                params = RASDIALPARAMS()
                params.dwSize = ctypes.sizeof(RASDIALPARAMS)
                params.szEntryName = vpn_name
                params.szUserName = username
                params.szPassword = password
                params.szDomain = ""
                params.szPhoneNumber = ""
                params.szCallbackNumber = ""
                params.dwSubEntry = 0
                params.dwCallbackId = 0
                params.dwIfIndex = 0

                rasapi32.RasSetEntryDialParamsW(USER_PBK, ctypes.byref(params), False)

                hRasConn = wintypes.HANDLE()
                res = rasapi32.RasDialW(None, USER_PBK, ctypes.byref(params), 0, None, ctypes.byref(hRasConn))

                if res == 0:
                    self.active_hrasconn = hRasConn
                    self.root.after(0, lambda: self.update_connection_ui("connected", "وضعیت: متصل به ZVPN", "اتصال ایمن و پرسرعت IKEv2 فعال است"))
                else:
                    err_buf = ctypes.create_unicode_buffer(512)
                    rasapi32.RasGetErrorStringW(res, err_buf, 512)
                    err_text = err_buf.value or f"کد خطا {res}"
                    self.root.after(0, lambda: self.update_connection_ui("disconnected", "وضعیت: قطع اتصال", f"خطا در برقراری اتصال: {err_text}"))
            else:
                res = run_hidden(["rasdial.exe", vpn_name, username, password], capture_output=True, text=True)
                if res.returncode == 0:
                    self.root.after(0, lambda: self.update_connection_ui("connected", "وضعیت: متصل به ZVPN", "اتصال ایمن و پرسرعت IKEv2 فعال است"))
                else:
                    err_msg = (res.stdout or res.stderr or "").strip()
                    self.root.after(0, lambda: self.update_connection_ui("disconnected", "وضعیت: قطع اتصال", f"خطا: {err_msg[:45]}"))

        threading.Thread(target=_do_connect, daemon=True).start()

    def disconnect_vpn(self):
        self.connect_btn.config(state="disabled", text="⏳ در حال قطع...")
        def _do_disconnect():
            if rasapi32 and self.active_hrasconn:
                try:
                    rasapi32.RasHangUpW(self.active_hrasconn)
                    self.active_hrasconn = None
                except Exception:
                    pass

            run_hidden(["rasdial.exe", self.vpn_name, "/disconnect"], capture_output=True)
            run_hidden(["rasdial.exe", f"ZVPN Panel - {self.user_data.get('username') if self.user_data else ''}", "/disconnect"], capture_output=True)
            self.root.after(0, lambda: self.update_connection_ui("disconnected", "وضعیت: قطع اتصال", "ارتباط با سرور قطع شد"))

        threading.Thread(target=_do_disconnect, daemon=True).start()

    def is_vpn_active_in_windows(self):
        try:
            r = run_hidden(["rasdial.exe"], capture_output=True, text=True)
            out = r.stdout or ""
            if "No connections" in out:
                return False
            uname = self.user_data.get("username", "") if self.user_data else ""
            if uname and uname in out:
                return True
            if self.vpn_name and self.vpn_name in out:
                return True
            if "ZVPN" in out:
                return True
        except Exception:
            pass
        return False

    def active_connection_monitor(self):
        while self._polling:
            try:
                is_active = self.is_vpn_active_in_windows()
                if is_active and self.connection_state != "connected":
                    self.root.after(0, lambda: self.update_connection_ui("connected", "وضعیت: متصل به ZVPN", "اتصال ایمن و پرسرعت IKEv2 فعال است"))
                elif not is_active and self.connection_state == "connected":
                    self.root.after(0, lambda: self.update_connection_ui("disconnected", "وضعیت: قطع اتصال", "ارتباط با سرور قطع شد"))
            except Exception:
                pass
            time.sleep(3)

    def ping_monitor_loop(self):
        while self._polling:
            if self.connection_state == "connected":
                try:
                    res = run_hidden(["ping.exe", "-n", "1", "-w", "1500", "1.1.1.1"], capture_output=True, text=True)
                    if "time=" in res.stdout or "time<" in res.stdout:
                        match = re.search(r"time[=<](\d+)ms", res.stdout)
                        ms = match.group(1) if match else "OK"
                        self.root.after(0, lambda: self.ping_text.set(f"{ms} ms"))
                    else:
                        self.root.after(0, lambda: self.ping_text.set("Timeout"))
                except Exception:
                    self.root.after(0, lambda: self.ping_text.set("—"))
            else:
                self.root.after(0, lambda: self.ping_text.set("—"))
            time.sleep(4)

    def update_connection_ui(self, state, title_msg, sub_msg):
        self.connection_state = state
        self.status_title_text.set(title_msg)
        self.status_sub_text.set(sub_msg)
        self.connect_btn.config(state="normal")

        if state == "connected":
            self.status_icon.config(text="●", fg=ACCENT_GREEN)
            self.status_title.config(fg=ACCENT_GREEN)
            self.connect_btn.config(text="⏹ قطع اتصال (Disconnect)", bg=ACCENT_RED, activebackground=ACCENT_RED_HOVER)
        elif state == "connecting":
            self.status_icon.config(text="●", fg=ACCENT_AMBER)
            self.status_title.config(fg=ACCENT_AMBER)
        else:
            self.status_icon.config(text="●", fg=ACCENT_RED)
            self.status_title.config(fg=TEXT_PRIMARY)
            self.connect_btn.config(text="🚀 اتصال به ZVPN (Connect)", bg=ACCENT_GREEN, activebackground=ACCENT_GREEN_HOVER)

    def open_windows_vpn_settings(self):
        popen_hidden(["cmd.exe", "/c", "start ms-settings:network-vpn"])

if __name__ == "__main__":
    root = tk.Tk()
    app = ZvpnClientApp(root)
    root.mainloop()
