# fwos-builtin-addons

Built-in addon OCI recipes FWOS ships. Not Workstation tooling, not crate sources, not the Host image.

```
netd/Containerfile    # netd built-in addon (joined to fwd)
ui/                   # UI: Rust HTTPS daemon + static JS SPA
kea/                  # Kea DHCPv4/DHCPv6
unbound/              # Unbound
```

The UI is the primary v1 operator interface after Bootstrap. Its frontend is `ui/static/`. The `fwos-ui` binary is built from `fwos-src` and copied into the image by Workstation tooling, same as `netd`.

There is no Appliance CLI addon: the Appliance console on VGA and serial is a Host program (`fwos-console`, in `fwos-src`) limited to Bootstrap and authenticated recovery, and the full Appliance CLI is deferred to v2.

Build with Workstation tooling (`fwos-dev`), not by installing onto a Workstation disk.
