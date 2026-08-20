# Changelog

All notable changes to the **ZVPN Panel** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.0.0] - 2026-08-20

### 🚀 Major Architectural Refactoring (Multi-Agent Architecture)

#### 🛡️ VPN & strongSwan Engine (Agent 1)
- **Race Condition Prevention**: Enhanced `SessionReconciler` with numeric unique ID sorting and deterministic tie-breaking.
- **Duplicate Session Management**: State-preserved duplicate session handling with configurable grace periods (default 45s) and persisted reconciliation state in PostgreSQL.
- **Crypto & Proposal Hardening**: Explicit IKE and ESP cipher suites for Windows (IKEv2 Native), iOS, macOS, Android (strongSwan App).
- **DPD & NAT-T**: `dpdaction=clear`, `dpddelay=30s`, `dpdtimeout=120s`, `forceencaps=yes`, and `uniqueids=never` strictly enforced.

#### 🏗️ Backend Architecture (Agent 2)
- **Modular Domain Architecture**: Decoupled routes, services, models, and workers into structured modules (`auth`, `users`, `vpn`, `sessions`, `settings`, `observability`, `backup`, `health`).
- **Database & Query Optimization**: Tuned PostgreSQL connection pooling, statement caching, and atomic transactions.
- **Robust Error Handling**: Standardized `AppError` hierarchy and global error handlers returning structured response envelopes.

#### 🔒 Security & Hardening (Agent 3)
- **Restricted Sudo Helper**: Tight regex pattern matching and path canonicalization in `/usr/local/sbin/zvpn-helper`.
- **Role-Based Access Control (RBAC)**: Strict `admin`, `operator`, and `viewer` role enforcement on all mutating endpoints.
- **Cryptographic Security**: AES-256-GCM authenticated encryption for VPN user credentials.
- **API Security**: Tiered rate limiters, Helmet HTTP security headers, and secure HttpOnly cookie management.

#### 📊 Observability & Logging (Agent 4)
- **Structured JSON Logging**: Leveled logs (`error`, `warn`, `info`, `debug`) with automatic sensitive data redaction.
- **Distributed Request Tracing**: AsyncLocalStorage `requestId` context attached across the entire execution lifecycle.
- **Unified Event Store**: Centralized event logging into `system_events` table for admin actions, VPN activations, disconnections, quota blocks, and system errors.
- **Interactive Log Viewer**: Real-time event filter, search, KPI counters, and JSON payload viewer modal.

#### 🎨 Modern SaaS Frontend (Agent 5)
- **21st Design System**: Built with React 18, Vite, TailwindCSS, Lucide Icons, and Framer Motion.
- **Real-Time Resource Meters**: CPU Load gauge, RAM progress bar, Disk usage meter, and strongSwan daemon status pill.
- **Comprehensive Settings Page**: General settings, VPN endpoint wizard, session policies, backup/restore, and admin credentials.
- **Enhanced Sessions & User Management**: Live online sessions counter, search filters, bulk actions, and QR code profile distribution.

#### 🧪 Quality Assurance & Integration (Agent 6)
- **Comprehensive Test Suite**: Automated unit and integration tests covering `sessionReconciler`, `saParser`, `crypto`, `security`, and `observability`.
- **Verified Production Build**: Clean TypeScript compilation and optimized Vite asset bundle.

#### 📦 DevOps & Release Tooling (Agent 7)
- **Idempotent Installer (`install.sh`)**: Automated dependency installation (Node.js 20+, PostgreSQL, strongSwan, Nginx), key generation, systemd service, and nginx configuration.
- **Safe Single-Command Upgrade (`upgrade.sh`)**: Automated pre-upgrade backup, database migration runner, dependency updates, and health check validation.
- **Comprehensive Documentation**: Complete guides in `docs/` for architecture, deployment, security, and troubleshooting.
