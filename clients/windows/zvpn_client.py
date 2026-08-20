"""
ZVPN Windows Client - Official Native IKEv2 Desktop Application
Pure Win32 Zero-Prompt In-App Engine for Windows 10 & 11
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
from tkinter import ttk, messagebox

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

class ZvpnClientApp:
    def __init__(self, root):
        self.root = root
        self.root.title("ZVPN - Windows IKEv2 Client")
        self.root.geometry("560x690")
        self.root.minsize(520, 660)
        self.root.configure(bg="#0b1320")

        self.sub_url = tk.StringVar()
        self.status_text = tk.StringVar(value="آماده برای اتصال")
        self.ping_text = tk.StringVar(value="—")
        self.connection_state = "disconnected" # "connected", "connecting", "disconnected"
        self.user_data = None
        self.vpn_name = "ZVPN"
        self.active_hrasconn = None
        self._polling = True

        self.load_local_config()
        self.setup_ui()

        # Handle window close cleanly
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
        # Header Frame
        header = tk.Frame(self.root, bg="#0f1d33", pady=15, padx=20)
        header.pack(fill="x")

        title_lbl = tk.Label(header, text="ZVPN Desktop Client", font=("Segoe UI", 16, "bold"), fg="#38bdf8", bg="#0f1d33")
        title_lbl.pack(anchor="w")

        sub_lbl = tk.Label(header, text="اتصال پرسرعت، هوشمند و امن IKEv2 برای ویندوز ۱۰ و ۱۱", font=("Segoe UI", 9), fg="#94a3b8", bg="#0f1d33")
        sub_lbl.pack(anchor="w", pady=(2, 0))

        # Main Container
        main = tk.Frame(self.root, bg="#0b1320", padx=20, pady=15)
        main.pack(fill="both", expand=True)

        # 1. Subscription Input Section
        sub_box = tk.LabelFrame(main, text=" لینک اشتراک (Subscription URL) ", font=("Segoe UI", 10, "bold"), fg="#38bdf8", bg="#112240", padx=12, pady=10)
        sub_box.pack(fill="x", pady=(0, 12))

        entry_frame = tk.Frame(sub_box, bg="#112240")
        entry_frame.pack(fill="x")

        self.url_entry = tk.Entry(entry_frame, textvariable=self.sub_url, font=("Consolas", 10), bg="#071224", fg="#f1f5f9", insertbackground="#38bdf8", relief="flat", highlightthickness=1, highlightbackground="#1e3a8a", highlightcolor="#38bdf8")
        self.url_entry.pack(side="left", fill="x", expand=True, ipady=6, padx=(0, 6))

        self.bind_entry_shortcuts(self.url_entry)

        # Quick Paste Button
        self.paste_btn = tk.Button(entry_frame, text="جایگذاری (Paste)", font=("Segoe UI", 9), bg="#1e293b", fg="#93c5fd", activebackground="#334155", activeforeground="#ffffff", relief="flat", padx=8, pady=4, cursor="hand2", command=self.paste_clipboard_to_entry)
        self.paste_btn.pack(side="left", padx=(0, 6))

        # Sync Button
        self.sync_btn = tk.Button(entry_frame, text="بروزرسانی", font=("Segoe UI", 9, "bold"), bg="#0284c7", fg="#ffffff", activebackground="#0369a1", activeforeground="#ffffff", relief="flat", padx=12, pady=4, cursor="hand2", command=self.on_sync_clicked)
        self.sync_btn.pack(side="right")

        # 2. Account Details Card
        self.info_card = tk.LabelFrame(main, text=" اطلاعات حساب کاربری ", font=("Segoe UI", 10, "bold"), fg="#94a3b8", bg="#112240", padx=15, pady=12)
        self.info_card.pack(fill="x", pady=(0, 14))

        self.lbl_username = self.create_info_row(self.info_card, "نام کاربر:", "—")
        self.lbl_traffic = self.create_info_row(self.info_card, "مصرف ترافیک:", "—")
        self.lbl_remain = self.create_info_row(self.info_card, "حجم باقیمانده:", "—")
        self.lbl_expire = self.create_info_row(self.info_card, "اعتبار حساب:", "—")
        self.lbl_server = self.create_info_row(self.info_card, "سرور VPN:", "—")

        # 3. Connection Status Card
        status_card = tk.Frame(main, bg="#112240", padx=15, pady=14, relief="flat", highlightthickness=1, highlightbackground="#1e3a8a")
        status_card.pack(fill="x", pady=(0, 14))

        self.status_icon = tk.Label(status_card, text="●", font=("Segoe UI", 24), fg="#ef4444", bg="#112240")
        self.status_icon.pack(side="left", padx=(5, 12))

        status_text_frame = tk.Frame(status_card, bg="#112240")
        status_text_frame.pack(side="left", fill="x", expand=True)

        self.status_title = tk.Label(status_text_frame, text="وضعیت: قطع اتصال", font=("Segoe UI", 11, "bold"), fg="#f1f5f9", bg="#112240")
        self.status_title.pack(anchor="w")

        self.status_detail = tk.Label(status_text_frame, textvariable=self.status_text, font=("Segoe UI", 9), fg="#94a3b8", bg="#112240")
        self.status_detail.pack(anchor="w")

        # Ping Tag
        ping_frame = tk.Frame(status_card, bg="#112240")
        ping_frame.pack(side="right", padx=5)
        tk.Label(ping_frame, text="پینگ", font=("Segoe UI", 8), fg="#64748b", bg="#112240").pack()
        self.ping_lbl = tk.Label(ping_frame, textvariable=self.ping_text, font=("Consolas", 10, "bold"), fg="#38bdf8", bg="#112240")
        self.ping_lbl.pack()

        # 4. Action Buttons
        self.connect_btn = tk.Button(main, text="اتصال به ZVPN (Connect)", font=("Segoe UI", 12, "bold"), bg="#10b981", fg="#ffffff", activebackground="#059669", activeforeground="#ffffff", relief="flat", pady=11, cursor="hand2", command=self.on_toggle_connect)
        self.connect_btn.pack(fill="x", pady=(0, 10))

        btn_row = tk.Frame(main, bg="#0b1320")
        btn_row.pack(fill="x")

        self.setup_btn = tk.Button(btn_row, text="تنظیم مجدد کانکشن", font=("Segoe UI", 9), bg="#1e293b", fg="#cbd5e1", activebackground="#334155", activeforeground="#ffffff", relief="flat", pady=6, cursor="hand2", command=self.on_reinstall_connection)
        self.setup_btn.pack(side="left", fill="x", expand=True, padx=(0, 5))

        self.win_settings_btn = tk.Button(btn_row, text="تنظیمات ویندوز", font=("Segoe UI", 9), bg="#1e293b", fg="#cbd5e1", activebackground="#334155", activeforeground="#ffffff", relief="flat", pady=6, cursor="hand2", command=self.open_windows_vpn_settings)
        self.win_settings_btn.pack(side="right", fill="x", expand=True, padx=(5, 0))

        # Footer
        footer = tk.Label(self.root, text="ZVPN Platform v3.0.0 · موتور اتصال مستقیم Win32", font=("Segoe UI", 8), fg="#64748b", bg="#0b1320", pady=8)
        footer.pack(side="bottom")

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

        menu = tk.Menu(entry, tearoff=0, bg="#1e293b", fg="#f1f5f9", activebackground="#0284c7", activeforeground="#ffffff")
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

    def create_info_row(self, parent, title, val):
        row = tk.Frame(parent, bg="#112240", pady=3)
        row.pack(fill="x")
        t = tk.Label(row, text=title, font=("Segoe UI", 9), fg="#94a3b8", bg="#112240", width=14, anchor="w")
        t.pack(side="right")
        v = tk.Label(row, text=val, font=("Consolas", 9, "bold"), fg="#f8fafc", bg="#112240", anchor="w")
        v.pack(side="left", fill="x", expand=True)
        return v

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
        self.status_text.set("در حال دریافت اطلاعات از سرور...")
        self.sync_btn.config(state="disabled", text="...")
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
            self.root.after(0, lambda: self.status_text.set(f"خطا در دریافت اشتراک: {str(e)[:40]}"))
            self.root.after(0, lambda: messagebox.showerror("خطا در اتصال به سرور", f"امکان دریافت اطلاعات اشتراک وجود ندارد:\n{e}"))
        finally:
            self.root.after(0, lambda: self.sync_btn.config(state="normal", text="بروزرسانی"))

    def update_user_ui(self, d):
        self.lbl_username.config(text=d.get("username", "—"))
        self.lbl_server.config(text=d.get("serverAddress", "—"))

        used = self.format_bytes(d.get("usageTotal", 0))
        total = self.format_bytes(d.get("totalLimitBytes")) if not d.get("unlimitedTraffic") else "نامحدود (∞)"
        self.lbl_traffic.config(text=f"{used} / {total}")

        if d.get("unlimitedTraffic"):
            self.lbl_remain.config(text="نامحدود")
        elif d.get("totalLimitBytes"):
            rem = max(0, d.get("totalLimitBytes", 0) - d.get("usageTotal", 0))
            self.lbl_remain.config(text=self.format_bytes(rem))
        else:
            self.lbl_remain.config(text="نامحدود")

        if d.get("expiresAt"):
            self.lbl_expire.config(text=d.get("expiresAt")[:10])
        elif d.get("durationDays") and d.get("activationStatus") == "not_activated":
            self.lbl_expire.config(text=f"{d.get('durationDays')} روز پس از اولین اتصال")
        else:
            self.lbl_expire.config(text="نامحدود")

    def configure_silent_pbk(self, vpn_name):
        """Configure rasphone.pbk so Windows NEVER prompts for username/password dialogs."""
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
        self.status_text.set("در حال پیکربندی خودکار کانکشن در ویندوز...")
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
            self.root.after(0, lambda: self.status_text.set("کانکشن با موفقیت و بدون نیاز به ورود رمز پیکربندی شد."))
        except Exception as e:
            self.root.after(0, lambda: self.status_text.set(f"خطا در ایجاد کانکشن: {e}"))

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
        self.update_connection_ui("connecting", "در حال برقراری اتصال مستقیم با سرور...")
        self.connect_btn.config(state="disabled", text="در حال برقراری اتصال...")

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
                    self.root.after(0, lambda: self.update_connection_ui("connected", "متصل شد (IKEv2 Secured)"))
                else:
                    err_buf = ctypes.create_unicode_buffer(512)
                    rasapi32.RasGetErrorStringW(res, err_buf, 512)
                    err_text = err_buf.value or f"کد خطا {res}"
                    self.root.after(0, lambda: self.update_connection_ui("disconnected", f"خطا در اتصال: {err_text}"))
            else:
                res = run_hidden(["rasdial.exe", vpn_name, username, password], capture_output=True, text=True)
                if res.returncode == 0:
                    self.root.after(0, lambda: self.update_connection_ui("connected", "متصل شد (IKEv2 Secured)"))
                else:
                    err_msg = (res.stdout or res.stderr or "").strip()
                    self.root.after(0, lambda: self.update_connection_ui("disconnected", f"خطا در اتصال: {err_msg[:45]}"))

        threading.Thread(target=_do_connect, daemon=True).start()

    def disconnect_vpn(self):
        self.connect_btn.config(state="disabled", text="در حال قطع...")
        def _do_disconnect():
            if rasapi32 and self.active_hrasconn:
                try:
                    rasapi32.RasHangUpW(self.active_hrasconn)
                    self.active_hrasconn = None
                except Exception:
                    pass

            # Also hangup any active connections with our name via rasdial
            run_hidden(["rasdial.exe", self.vpn_name, "/disconnect"], capture_output=True)
            run_hidden(["rasdial.exe", f"ZVPN Panel - {self.user_data.get('username') if self.user_data else ''}", "/disconnect"], capture_output=True)
            self.root.after(0, lambda: self.update_connection_ui("disconnected", "اتصال قطع شد."))

        threading.Thread(target=_do_disconnect, daemon=True).start()

    def is_vpn_active_in_windows(self):
        """Reliably check if our VPN is connected in Windows."""
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
        """Continuously check VPN connection status."""
        while self._polling:
            try:
                is_active = self.is_vpn_active_in_windows()
                if is_active and self.connection_state != "connected":
                    self.root.after(0, lambda: self.update_connection_ui("connected", "متصل شد (IKEv2 Secured)"))
                elif not is_active and self.connection_state == "connected":
                    self.root.after(0, lambda: self.update_connection_ui("disconnected", "قطع اتصال"))
            except Exception:
                pass
            time.sleep(3)

    def ping_monitor_loop(self):
        """Continuously check latency when connected."""
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

    def update_connection_ui(self, state, msg):
        self.connection_state = state
        self.status_text.set(msg)
        self.connect_btn.config(state="normal")

        if state == "connected":
            self.status_icon.config(text="●", fg="#10b981")
            self.status_title.config(text="وضعیت: متصل به ZVPN", fg="#10b981")
            self.connect_btn.config(text="قطع اتصال (Disconnect)", bg="#ef4444", activebackground="#dc2626")
        elif state == "connecting":
            self.status_icon.config(text="●", fg="#f59e0b")
            self.status_title.config(text="وضعیت: در حال اتصال...", fg="#f59e0b")
        else:
            self.status_icon.config(text="●", fg="#ef4444")
            self.status_title.config(text="وضعیت: قطع اتصال", fg="#f1f5f9")
            self.connect_btn.config(text="اتصال به ZVPN (Connect)", bg="#10b981", activebackground="#059669")

    def open_windows_vpn_settings(self):
        popen_hidden(["cmd.exe", "/c", "start ms-settings:network-vpn"])

if __name__ == "__main__":
    root = tk.Tk()
    app = ZvpnClientApp(root)
    root.mainloop()
