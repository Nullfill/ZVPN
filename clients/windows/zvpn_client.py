"""
ZVPN Windows Client - Official Native Desktop Application (WebView2 Edition)
Real Glassmorphism UI powered by 21st.dev Design System & Native Win32 Engine
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
import webview

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

APP_DATA_DIR = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "ZVPN")
CONFIG_FILE = os.path.join(APP_DATA_DIR, "config.json")
USER_PBK = os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Network\Connections\Pbk\rasphone.pbk")
os.makedirs(APP_DATA_DIR, exist_ok=True)

HTML_UI = """<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>ZVPN Desktop Client</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg-main: #060913;
    --card-bg: rgba(15, 23, 42, 0.65);
    --card-hover: rgba(30, 41, 59, 0.75);
    --card-border: rgba(255, 255, 255, 0.08);
    --card-border-glow: rgba(56, 189, 248, 0.3);
    --accent-blue: #38bdf8;
    --accent-cyan: #06b6d4;
    --accent-emerald: #10b981;
    --accent-emerald-glow: rgba(16, 185, 129, 0.35);
    --accent-rose: #f43f5e;
    --accent-rose-glow: rgba(244, 63, 94, 0.35);
    --accent-amber: #f59e0b;
    --text-primary: #f8fafc;
    --text-secondary: #94a3b8;
    --text-muted: #64748b;
    --font-sans: 'Vazirmatn', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
  body {
    font-family: var(--font-sans);
    background-color: var(--bg-main);
    color: var(--text-primary);
    min-height: 100vh;
    overflow-x: hidden;
    background-image: 
      radial-gradient(circle at 10% 15%, rgba(14, 165, 233, 0.12) 0%, transparent 40%),
      radial-gradient(circle at 90% 85%, rgba(99, 102, 241, 0.12) 0%, transparent 40%),
      radial-gradient(circle at 50% 50%, rgba(15, 23, 42, 0.8) 0%, transparent 100%);
    display: flex;
    flex-direction: column;
    padding: 16px;
  }

  /* Glassmorphism Card Utility */
  .glass-card {
    background: var(--card-bg);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--card-border);
    border-radius: 20px;
    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .glass-card:hover {
    border-color: rgba(255, 255, 255, 0.15);
  }

  /* App Header */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 18px;
    margin-bottom: 14px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .brand-logo {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: linear-gradient(135deg, #0284c7, #6366f1);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    box-shadow: 0 0 15px rgba(2, 132, 199, 0.5);
  }
  .brand-text h1 {
    font-size: 15px;
    font-weight: 800;
    letter-spacing: -0.5px;
    background: linear-gradient(135deg, #fff, #94a3b8);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .brand-text p {
    font-size: 10px;
    color: var(--text-muted);
  }
  .proto-pill {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(56, 189, 248, 0.1);
    color: var(--accent-blue);
    border: 1px solid rgba(56, 189, 248, 0.25);
  }

  /* Subscription Input Box */
  .sub-box {
    padding: 14px 16px;
    margin-bottom: 14px;
  }
  .sub-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .sub-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-secondary);
  }
  .input-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(6, 9, 19, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 4px;
    transition: border-color 0.2s;
  }
  .input-row:focus-within {
    border-color: var(--accent-blue);
    box-shadow: 0 0 12px rgba(56, 189, 248, 0.2);
  }
  .sub-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #fff;
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 8px 12px;
    direction: ltr;
    text-align: left;
  }
  .sub-input::placeholder {
    color: var(--text-muted);
    font-family: var(--font-sans);
    direction: rtl;
    text-align: right;
  }
  .btn-sm {
    border: none;
    outline: none;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    padding: 7px 12px;
    border-radius: 10px;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .btn-paste {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-secondary);
  }
  .btn-paste:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }
  .btn-sync {
    background: linear-gradient(135deg, #0284c7, #2563eb);
    color: #fff;
    box-shadow: 0 2px 10px rgba(37, 99, 235, 0.3);
  }
  .btn-sync:hover {
    filter: brightness(1.15);
    transform: translateY(-1px);
  }

  /* Bento Stats Grid */
  .bento-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
    margin-bottom: 14px;
  }
  .stat-card {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .stat-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .stat-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .stat-icon {
    font-size: 14px;
    opacity: 0.8;
  }
  .stat-val {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
    direction: ltr;
    text-align: right;
  }

  /* Usage Progress Bar */
  .progress-section {
    padding: 12px 16px;
    margin-bottom: 14px;
  }
  .progress-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    margin-bottom: 8px;
  }
  .progress-title {
    color: var(--text-secondary);
    font-weight: 600;
  }
  .progress-pct {
    font-family: var(--font-mono);
    font-weight: 700;
    color: var(--accent-blue);
  }
  .progress-track {
    height: 8px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 999px;
    overflow: hidden;
    position: relative;
  }
  .progress-bar {
    height: 100%;
    width: 0%;
    border-radius: 999px;
    background: linear-gradient(90deg, #38bdf8, #6366f1);
    transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s;
    box-shadow: 0 0 10px rgba(56, 189, 248, 0.5);
  }

  /* Hero Status & Connect Center */
  .hero-card {
    padding: 18px 20px;
    margin-bottom: 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    overflow: hidden;
  }
  .status-indicator-wrap {
    position: relative;
    width: 80px;
    height: 80px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .pulse-ring {
    position: absolute;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: var(--accent-rose);
    opacity: 0.15;
    animation: pulse 2.5s infinite;
  }
  .status-core {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 30%, #fb7185, #e11d48);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    box-shadow: 0 0 25px var(--accent-rose-glow);
    transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  }

  /* Connected State Animation */
  .state-connected .pulse-ring {
    background: var(--accent-emerald);
    animation: pulse-emerald 2s infinite;
  }
  .state-connected .status-core {
    background: radial-gradient(circle at 30% 30%, #34d399, #059669);
    box-shadow: 0 0 30px var(--accent-emerald-glow);
  }

  /* Connecting State Animation */
  .state-connecting .pulse-ring {
    background: var(--accent-amber);
    animation: spin 1.5s linear infinite;
  }
  .state-connecting .status-core {
    background: radial-gradient(circle at 30% 30%, #fcd34d, #d97706);
    box-shadow: 0 0 25px rgba(245, 158, 11, 0.4);
  }

  @keyframes pulse {
    0% { transform: scale(0.85); opacity: 0.3; }
    50% { transform: scale(1.15); opacity: 0.05; }
    100% { transform: scale(0.85); opacity: 0.3; }
  }
  @keyframes pulse-emerald {
    0% { transform: scale(0.85); opacity: 0.4; }
    50% { transform: scale(1.25); opacity: 0.05; }
    100% { transform: scale(0.85); opacity: 0.4; }
  }
  @keyframes spin {
    0% { transform: rotate(0deg) scale(1); }
    100% { transform: rotate(360deg) scale(1); }
  }

  .status-title-text {
    font-size: 15px;
    font-weight: 800;
    margin-bottom: 2px;
  }
  .status-sub-text {
    font-size: 11px;
    color: var(--text-muted);
    margin-bottom: 12px;
  }

  /* Ping Badge */
  .ping-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: var(--text-secondary);
  }
  .ping-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
  }
  .ping-dot.active {
    background: var(--accent-emerald);
    box-shadow: 0 0 8px var(--accent-emerald);
  }

  /* Shiny Connect Button (21st.dev Style) */
  .btn-connect {
    width: 100%;
    padding: 14px 20px;
    border-radius: 16px;
    border: none;
    outline: none;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: 15px;
    font-weight: 800;
    color: #fff;
    background: linear-gradient(135deg, #10b981, #059669);
    box-shadow: 0 6px 20px rgba(16, 185, 129, 0.35);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
    margin-bottom: 12px;
  }
  .btn-connect:hover {
    filter: brightness(1.1);
    transform: translateY(-2px);
    box-shadow: 0 10px 28px rgba(16, 185, 129, 0.45);
  }
  .btn-connect:active {
    transform: translateY(0);
  }
  .btn-connect.disconnect {
    background: linear-gradient(135deg, #f43f5e, #e11d48);
    box-shadow: 0 6px 20px rgba(244, 63, 94, 0.35);
  }
  .btn-connect.disconnect:hover {
    box-shadow: 0 10px 28px rgba(244, 63, 94, 0.45);
  }

  /* Quick Actions Footer */
  .quick-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 12px;
  }
  .btn-util {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    padding: 8px 12px;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .btn-util:hover {
    background: var(--card-hover);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.15);
  }

  /* Footer Note */
  .footer-text {
    text-align: center;
    font-size: 10px;
    color: var(--text-muted);
    margin-top: auto;
    padding-top: 8px;
  }
</style>
</head>
<body class="state-disconnected" id="appBody">

  <!-- Header -->
  <header class="glass-card header">
    <div class="brand">
      <div class="brand-logo">⚡</div>
      <div class="brand-text">
        <h1>ZVPN Desktop Client</h1>
        <p>موتور ارتباطی هوشمند و امن IKEv2</p>
      </div>
    </div>
    <div class="proto-pill">IKEv2 Native</div>
  </header>

  <!-- Subscription URL Input -->
  <section class="glass-card sub-box">
    <div class="sub-header">
      <span class="sub-title">🔗 لینک اشتراک کاربر</span>
      <span style="font-family: var(--font-mono); font-size: 10px; color: var(--text-muted);">Subscription URL</span>
    </div>
    <div class="input-row">
      <input type="text" id="subUrl" class="sub-input" placeholder="https://ike.spinbox.ir/d/..." spellcheck="false" autocomplete="off">
      <button class="btn-sm btn-paste" onclick="handlePaste()" title="جایگذاری از کلیپ‌بورد">📋 جایگذاری</button>
      <button class="btn-sm btn-sync" onclick="handleSync()" id="syncBtn">🔄 بروزرسانی</button>
    </div>
  </section>

  <!-- Bento Stats Grid -->
  <div class="bento-grid">
    <div class="glass-card stat-card">
      <div class="stat-top">
        <span class="stat-label">نام کاربری</span>
        <span class="stat-icon">👤</span>
      </div>
      <div class="stat-val" id="statUser" style="direction: rtl; text-align: right;">—</div>
    </div>
    <div class="glass-card stat-card">
      <div class="stat-top">
        <span class="stat-label">آدرس سرور</span>
        <span class="stat-icon">🌐</span>
      </div>
      <div class="stat-val" id="statServer">—</div>
    </div>
    <div class="glass-card stat-card">
      <div class="stat-top">
        <span class="stat-label">مصرف کل</span>
        <span class="stat-icon">📈</span>
      </div>
      <div class="stat-val" id="statUsage">—</div>
    </div>
    <div class="glass-card stat-card">
      <div class="stat-top">
        <span class="stat-label">حجم باقیمانده</span>
        <span class="stat-icon">⏳</span>
      </div>
      <div class="stat-val" id="statRemain">—</div>
    </div>
    <div class="glass-card stat-card">
      <div class="stat-top">
        <span class="stat-label">تاریخ انقضا</span>
        <span class="stat-icon">📅</span>
      </div>
      <div class="stat-val" id="statExpire" style="direction: rtl; text-align: right;">—</div>
    </div>
    <div class="glass-card stat-card">
      <div class="stat-top">
        <span class="stat-label">مصرف امروز</span>
        <span class="stat-icon">📆</span>
      </div>
      <div class="stat-val" id="statToday">—</div>
    </div>
  </div>

  <!-- Traffic Progress -->
  <div class="glass-card progress-section">
    <div class="progress-head">
      <span class="progress-title">میزان حجم مصرف‌شده</span>
      <span class="progress-pct" id="progressPct">0%</span>
    </div>
    <div class="progress-track">
      <div class="progress-bar" id="progressBar"></div>
    </div>
  </div>

  <!-- Hero Connection Card -->
  <section class="glass-card hero-card">
    <div class="status-indicator-wrap">
      <div class="pulse-ring"></div>
      <div class="status-core" id="statusCore">🔒</div>
    </div>
    <div class="status-title-text" id="statusTitle">آماده برای اتصال</div>
    <div class="status-sub-text" id="statusSub">روی دکمه اتصال کلیک کنید تا ارتباط امن برقرار شود</div>
    <div class="ping-tag">
      <span class="ping-dot" id="pingDot"></span>
      <span>PING:</span>
      <span id="pingVal" style="font-weight: 700;">—</span>
    </div>
  </section>

  <!-- Connect Button -->
  <button class="btn-connect" id="connectBtn" onclick="handleToggleConnect()">
    🚀 اتصال به ZVPN (Connect)
  </button>

  <!-- Quick Actions -->
  <div class="quick-row">
    <button class="btn-util" onclick="handleReinstall()">⚙️ تنظیم مجدد کانکشن</button>
    <button class="btn-util" onclick="handleWinSettings()">🌐 تنظیمات VPN ویندوز</button>
  </div>

  <!-- Footer -->
  <div class="footer-text">
    ZVPN Platform v3.0.0 · محافظت ایمن IKEv2 با رمزنگاری سخت‌افزاری AES-256
  </div>

  <script>
    let isConnected = false;
    let isConnecting = false;

    window.addEventListener('pywebviewready', function () {
      window.pywebview.api.get_initial_state().then(state => {
        if (state) updateState(state);
      });
    });

    function handlePaste() {
      navigator.clipboard.readText().then(text => {
        if (text && text.trim()) {
          document.getElementById('subUrl').value = text.trim();
          handleSync();
        }
      }).catch(() => {
        window.pywebview.api.get_clipboard().then(text => {
          if (text && text.trim()) {
            document.getElementById('subUrl').value = text.trim();
            handleSync();
          }
        });
      });
    }

    function handleSync() {
      const url = document.getElementById('subUrl').value.trim();
      if (!url) return;
      const btn = document.getElementById('syncBtn');
      btn.innerText = '⏳ ...';
      btn.disabled = true;
      window.pywebview.api.sync_subscription(url).finally(() => {
        btn.innerText = '🔄 بروزرسانی';
        btn.disabled = false;
      });
    }

    function handleToggleConnect() {
      const btn = document.getElementById('connectBtn');
      btn.disabled = true;
      window.pywebview.api.toggle_connect().finally(() => {
        btn.disabled = false;
      });
    }

    function handleReinstall() {
      window.pywebview.api.reinstall_profile();
    }

    function handleWinSettings() {
      window.pywebview.api.open_win_settings();
    }

    function updateState(state) {
      if (state.subUrl && !document.getElementById('subUrl').value) {
        document.getElementById('subUrl').value = state.subUrl;
      }

      // User stats
      if (state.user) {
        document.getElementById('statUser').innerText = state.user.username || '—';
        document.getElementById('statServer').innerText = state.user.serverAddress || '—';
        document.getElementById('statUsage').innerText = state.user.trafficText || '—';
        document.getElementById('statRemain').innerText = state.user.remainText || '—';
        document.getElementById('statExpire').innerText = state.user.expireText || '—';
        document.getElementById('statToday').innerText = state.user.todayText || '—';

        const pct = state.user.usagePct || 0;
        document.getElementById('progressPct').innerText = pct + '%';
        const bar = document.getElementById('progressBar');
        bar.style.width = pct + '%';
        if (pct >= 100) {
          bar.style.background = 'linear-gradient(90deg, #f43f5e, #e11d48)';
        } else if (pct >= 80) {
          bar.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
        } else {
          bar.style.background = 'linear-gradient(90deg, #38bdf8, #6366f1)';
        }
      }

      // Connection state
      const body = document.getElementById('appBody');
      const connBtn = document.getElementById('connectBtn');
      const title = document.getElementById('statusTitle');
      const sub = document.getElementById('statusSub');
      const core = document.getElementById('statusCore');
      const pingDot = document.getElementById('pingDot');
      const pingVal = document.getElementById('pingVal');

      if (state.connState === 'connected') {
        body.className = 'state-connected';
        title.innerText = 'متصل به ZVPN';
        title.style.color = 'var(--accent-emerald)';
        sub.innerText = 'اتصال ایمن و پرسرعت IKEv2 فعال است';
        core.innerText = '🛡️';
        connBtn.innerText = '⏹ قطع اتصال (Disconnect)';
        connBtn.className = 'btn-connect disconnect';
        pingDot.className = 'ping-dot active';
        pingVal.innerText = state.ping || 'OK';
      } else if (state.connState === 'connecting') {
        body.className = 'state-connecting';
        title.innerText = 'در حال برقراری ارتباط...';
        title.style.color = 'var(--accent-amber)';
        sub.innerText = 'در حال هندشیک امنیتی با سرور';
        core.innerText = '⚡';
        connBtn.innerText = '⏳ در حال اتصال...';
        connBtn.className = 'btn-connect';
        pingDot.className = 'ping-dot';
        pingVal.innerText = '—';
      } else {
        body.className = 'state-disconnected';
        title.innerText = 'وضعیت: قطع اتصال';
        title.style.color = 'var(--text-primary)';
        sub.innerText = state.errorMsg || 'روی دکمه اتصال کلیک کنید تا ارتباط امن برقرار شود';
        core.innerText = '🔒';
        connBtn.innerText = '🚀 اتصال به ZVPN (Connect)';
        connBtn.className = 'btn-connect';
        pingDot.className = 'ping-dot';
        pingVal.innerText = '—';
      }
    }
  </script>
</body>
</html>
"""

class ZvpnApi:
    def __init__(self, app):
        self.app = app

    def get_initial_state(self):
        return self.app.get_full_state()

    def get_clipboard(self):
        try:
            import tkinter as tk
            r = tk.Tk()
            r.withdraw()
            clip = r.clipboard_get()
            r.destroy()
            return clip
        except Exception:
            return ""

    def sync_subscription(self, url):
        self.app.sub_url = url.strip()
        self.app.save_local_config()
        self.app.fetch_subscription(auto_install=True)
        return True

    def toggle_connect(self):
        if self.app.connection_state == "connected":
            self.app.disconnect_vpn()
        else:
            self.app.connect_vpn()
        return True

    def reinstall_profile(self):
        if self.app.user_data:
            threading.Thread(target=self.app.install_windows_profile, args=(self.app.user_data,), daemon=True).start()
        return True

    def open_win_settings(self):
        popen_hidden(["cmd.exe", "/c", "start ms-settings:network-vpn"])
        return True


class ZvpnDesktopClient:
    def __init__(self):
        self.sub_url = ""
        self.connection_state = "disconnected"
        self.user_data = None
        self.vpn_name = "ZVPN"
        self.active_hrasconn = None
        self.ping_val = "—"
        self.error_msg = ""
        self.window = None
        self._polling = True

        self.load_local_config()

    def load_local_config(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    self.sub_url = cfg.get("sub_url", "")
            except Exception:
                pass

    def save_local_config(self):
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump({"sub_url": self.sub_url}, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def format_bytes(self, n):
        if n is None:
            return "نامحدود"
        n = float(n)
        for unit in ["B", "KB", "MB", "GB", "TB"]:
            if n < 1024.0 or unit == "TB":
                return f"{n:.2f} {unit}"
            n /= 1024.0
        return f"{n:.2f} GB"

    def get_full_state(self):
        user_info = None
        if self.user_data:
            d = self.user_data
            used_num = d.get("usageTotal", 0)
            total_limit = d.get("totalLimitBytes")
            used = self.format_bytes(used_num)
            total = self.format_bytes(total_limit) if not d.get("unlimitedTraffic") else "نامحدود (∞)"

            if d.get("unlimitedTraffic"):
                rem_text = "نامحدود (∞)"
                pct = 0
            elif total_limit:
                rem_text = self.format_bytes(max(0, total_limit - used_num))
                pct = min(100, int((used_num / total_limit) * 100))
            else:
                rem_text = "نامحدود"
                pct = 0

            if d.get("expiresAt"):
                exp_text = d.get("expiresAt")[:10]
            elif d.get("durationDays") and d.get("activationStatus") == "not_activated":
                exp_text = f"{d.get('durationDays')} روز پس از اتصال"
            else:
                exp_text = "نامحدود"

            user_info = {
                "username": d.get("username", "—"),
                "serverAddress": d.get("serverAddress", "—"),
                "trafficText": f"{used} / {total}",
                "remainText": rem_text,
                "expireText": exp_text,
                "todayText": self.format_bytes(d.get("todayBytes", 0)),
                "usagePct": pct,
            }

        return {
            "subUrl": self.sub_url,
            "connState": self.connection_state,
            "ping": self.ping_val,
            "errorMsg": self.error_msg,
            "user": user_info,
        }

    def push_state(self):
        if self.window:
            try:
                state_json = json.dumps(self.get_full_state())
                self.window.evaluate_js(f"updateState({state_json})")
            except Exception:
                pass

    def fetch_subscription(self, auto_install=True):
        if not self.sub_url:
            return
        raw_url = self.sub_url.strip()
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
                self.push_state()
                if auto_install:
                    self.install_windows_profile(data)
        except Exception as e:
            self.error_msg = f"خطا در دریافت اشتراک: {e}"
            self.push_state()

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
Set-VpnConnectionIPsecConfiguration -ConnectionName $VpnName -AuthenticationTransformConstants GCMAES128 -CipherTransformConstants GCMAES128 -EncryptionMethod GCMAES128 -IntegrityCheckMethod SHA256 -PfsGroup None -DHGroup ECP256 -Force | Out-Null
"""
        try:
            cmd = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script]
            run_hidden(cmd, capture_output=True, timeout=15)
            self.configure_silent_pbk(vpn_name)
        except Exception:
            pass

    def connect_vpn(self):
        if not self.user_data:
            return
        self.connection_state = "connecting"
        self.error_msg = ""
        self.push_state()

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
                    self.connection_state = "connected"
                    # Apply immediate MTU, DNS, and Priority Route tuning
                    opt_ps = f"""
                    netsh interface ipv4 set subinterface '{vpn_name}' mtu=1360 store=persistent
                    Set-NetIPInterface -InterfaceAlias '{vpn_name}' -InterfaceMetric 1 -ErrorAction SilentlyContinue
                    Set-DnsClientServerAddress -InterfaceAlias '{vpn_name}' -ServerAddresses ('1.1.1.1','8.8.8.8') -ErrorAction SilentlyContinue
                    """
                    run_hidden(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", opt_ps])
                else:
                    err_buf = ctypes.create_unicode_buffer(512)
                    rasapi32.RasGetErrorStringW(res, err_buf, 512)
                    self.error_msg = f"خطا در برقراری اتصال: {err_buf.value or res}"
                    self.connection_state = "disconnected"
            else:
                res = run_hidden(["rasdial.exe", vpn_name, username, password], capture_output=True, text=True)
                if res.returncode == 0:
                    self.connection_state = "connected"
                else:
                    self.error_msg = "خطا در اتصال به سرور"
                    self.connection_state = "disconnected"

            self.push_state()

        threading.Thread(target=_do_connect, daemon=True).start()

    def disconnect_vpn(self):
        def _do_disconnect():
            if rasapi32 and self.active_hrasconn:
                try:
                    rasapi32.RasHangUpW(self.active_hrasconn)
                    self.active_hrasconn = None
                except Exception:
                    pass

            run_hidden(["rasdial.exe", self.vpn_name, "/disconnect"], capture_output=True)
            self.connection_state = "disconnected"
            self.push_state()

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
                    self.connection_state = "connected"
                    self.push_state()
                elif not is_active and self.connection_state == "connected":
                    self.connection_state = "disconnected"
                    self.push_state()
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
                        self.ping_val = f"{match.group(1)} ms" if match else "OK"
                    else:
                        self.ping_val = "Timeout"
                except Exception:
                    self.ping_val = "—"
                self.push_state()
            else:
                if self.ping_val != "—":
                    self.ping_val = "—"
                    self.push_state()
            time.sleep(4)


def main():
    client = ZvpnDesktopClient()
    api = ZvpnApi(client)

    # Start background threads
    threading.Thread(target=client.active_connection_monitor, daemon=True).start()
    threading.Thread(target=client.ping_monitor_loop, daemon=True).start()
    if client.sub_url:
        threading.Thread(target=client.fetch_subscription, args=(False,), daemon=True).start()

    window = webview.create_window(
        title="ZVPN Desktop Client",
        html=HTML_UI,
        js_api=api,
        width=540,
        height=720,
        resizable=True,
        min_size=(500, 680),
        background_color="#060913",
    )
    client.window = window
    webview.start()


if __name__ == "__main__":
    main()
