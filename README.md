# fwos-builtin-addons

Built-in addon OCI recipes FWOS ships. Not Workstation tooling, not crate sources, not the Host image.

```
netd/Containerfile    # netd built-in addon (joined to fwd)
cli/Containerfile     # Appliance CLI addon recipe (binary is a Host program)
ui/                   # UI: Rust HTTPS daemon + static JS SPA
kea/                  # Kea DHCPv4/DHCPv6
unbound/              # Unbound
```

The UI frontend is `ui/static/`. The `fwos-ui` binary is built from `fwos-src` and copied into the image by Workstation tooling, same as `netd`.

Build with Workstation tooling (`fwos-dev`), not by installing onto a Workstation disk.
