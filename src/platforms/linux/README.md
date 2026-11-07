# Linux port boundary

Linux will reuse `../desktop/main.tsx` and the existing React desktop views.
Put Linux-only shell/adapters here when implementing the port. Do not fork
the desktop UI or import Windows filesystem, registry, tray, or startup services
into Android. Native Linux packaging, dependencies, credential storage, OAuth,
and sync need their own implementation and verification before release.

This directory reserves the boundary; a working Linux build is not claimed.
