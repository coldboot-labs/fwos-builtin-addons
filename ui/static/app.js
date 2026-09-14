(function () {
  var app = document.getElementById("app");

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  function checked(id) {
    var el = document.getElementById(id);
    return !!(el && el.checked);
  }

  function renderStatus(st) {
    var ifaces = (st.interfaces || [])
      .map(function (i) {
        var bits = [esc(i.name)];
        if (i.role) bits.push(esc(i.role));
        if (i.vlan) bits.push("vlan " + esc(i.vlan));
        if (i.dhcp) bits.push("dhcp");
        if (i.addresses && i.addresses.length) bits.push(esc(i.addresses.join(" ")));
        return "<li>" + bits.join(" · ") + "</li>";
      })
      .join("");
    var exposure = (st.ui_exposure || []).map(esc).join(", ");
    app.innerHTML =
      "<h2>Status</h2>" +
      "<p>hostname: " + esc(st.hostname || "") + "</p>" +
      "<p>LAN prefix: " + esc(st.lan_prefix || "") + "</p>" +
      "<p>DHCP pool: " + esc(st.dhcp_pool || "") + "</p>" +
      "<p>WAN PD: " + esc(st.wan_pd || "") + "</p>" +
      "<p>UI exposure: " + esc(exposure) + "</p>" +
      "<p class=\"muted\">Default policy is applied automatically when a WAN exists.</p>" +
      "<h3>NICs</h3><ul>" +
      ifaces +
      "</ul>";
  }

  function nicOptions(nics, selected) {
    return nics
      .map(function (n) {
        var sel = n.name === selected ? " selected" : "";
        return "<option value=\"" + esc(n.name) + "\"" + sel + ">" + esc(n.name) + "</option>";
      })
      .join("");
  }

  function renderWizard(st) {
    var nics = st.nics || [];
    var lanDefault = nics[0] ? nics[0].name : "";
    var wanDefault = nics[1] ? nics[1].name : lanDefault;
    var oneNic = nics.length === 1;
    app.innerHTML =
      "<h2>Bootstrap wizard</h2>" +
      "<form id=\"wiz\">" +
      "<label>hostname <input id=\"hostname\" required></label>" +
      "<label>admin <input id=\"admin\" required></label>" +
      "<label>password <input id=\"password\" type=\"password\" required></label>" +
      "<h3>WAN</h3>" +
      "<label>WAN NIC <select id=\"wan_nic\">" +
      nicOptions(nics, wanDefault) +
      "</select></label>" +
      "<label><input type=\"checkbox\" id=\"wan_tagged\"> tagged</label>" +
      "<label>WAN VLAN <input id=\"wan_vlan\" value=\"10\"></label>" +
      "<h3>LAN</h3>" +
      "<label>LAN NIC <select id=\"lan_nic\">" +
      nicOptions(nics, lanDefault) +
      "</select></label>" +
      "<label><input type=\"checkbox\" id=\"lan_tagged\"" +
      (oneNic ? " checked" : "") +
      "> tagged</label>" +
      "<label>LAN VLAN <input id=\"lan_vlan\" value=\"20\"></label>" +
      "<h3>UI exposure</h3>" +
      "<label><input type=\"checkbox\" id=\"expose_lan\" checked disabled> LAN (required)</label>" +
      "<p id=\"warn\" class=\"muted\"></p>" +
      "<label>addressing" +
      "<select id=\"addressing\">" +
      "<option value=\"static\" selected>static</option>" +
      "<option value=\"dhcp\">DHCP</option>" +
      "</select></label>" +
      "<label>WAN address <input id=\"wan_addr\" value=\"192.0.2.1/24\"></label>" +
      "<label>WAN IPv6 <input id=\"wan_addr6\"></label>" +
      "<label>WAN PD <input id=\"wan_pd\"></label>" +
      "<label>LAN prefix <input id=\"lan_prefix\" value=\"192.168.1.0/24\"></label>" +
      "<label>DHCP pool <input id=\"dhcp_pool\" value=\"192.168.1.100-192.168.1.200\"></label>" +
      "<button type=\"submit\">Bootstrap</button>" +
      "<p id=\"err\" class=\"err\"></p>" +
      "</form>";
    function refreshWarn() {
      var warn = document.getElementById("warn");
      if (nics.length === 1 && !checked("wan_tagged")) {
        warn.textContent =
          "Untagged first-boot HTTPS will vanish if untagged becomes WAN. Apply still proceeds.";
      } else {
        warn.textContent = "";
      }
    }
    ["wan_nic", "lan_nic", "wan_tagged", "lan_tagged"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("change", refreshWarn);
    });
    refreshWarn();
    document.getElementById("wiz").addEventListener("submit", function (ev) {
      ev.preventDefault();
      submit(nics);
    });
  }

  function lanHost(prefix) {
    var ip = (prefix.split("/")[0] || "").split(".");
    if (ip.length !== 4) return "";
    if (ip[3] === "0") ip[3] = "1";
    var pfx = prefix.split("/")[1] || "24";
    return ip.join(".") + "/" + pfx;
  }

  function l2Name(nic, tagged, vid) {
    return tagged ? nic + "." + vid : nic;
  }

  async function submit(nics) {
    var err = document.getElementById("err");
    err.textContent = "";
    var addressing = val("addressing");
    var dhcp = addressing === "dhcp";
    var addrs = [];
    if (!dhcp) {
      if (val("wan_addr")) addrs.push(val("wan_addr"));
      if (val("wan_addr6")) addrs.push(val("wan_addr6"));
    }
    var wanNic = val("wan_nic");
    var lanNic = val("lan_nic");
    var wanTagged = checked("wan_tagged");
    var lanTagged = checked("lan_tagged");
    var wanVid = parseInt(val("wan_vlan") || "10", 10);
    var lanVid = parseInt(val("lan_vlan") || "20", 10);
    if (wanNic === lanNic && wanTagged === lanTagged && (!wanTagged || wanVid === lanVid)) {
      err.textContent = "WAN and LAN must not share the same parent and tag";
      return;
    }
    var wanName = l2Name(wanNic, wanTagged, wanVid);
    var lanName = l2Name(lanNic, lanTagged, lanVid);
    var lanAddr = lanHost(val("lan_prefix"));
    var interfaces = [];
    if (wanTagged) {
      interfaces.push({
        name: wanName,
        role: "wan",
        parent: wanNic,
        vlan: wanVid,
        addresses: addrs,
        dhcp: dhcp,
      });
    } else {
      interfaces.push({
        name: wanName,
        role: "wan",
        addresses: addrs,
        dhcp: dhcp,
      });
    }
    if (lanTagged) {
      interfaces.push({
        name: lanName,
        role: "lan",
        parent: lanNic,
        vlan: lanVid,
        addresses: lanAddr ? [lanAddr] : [],
      });
    } else {
      interfaces.push({
        name: lanName,
        role: "lan",
        addresses: lanAddr ? [lanAddr] : [],
      });
    }
    nics.forEach(function (n) {
      var used = n.name === wanNic || n.name === lanNic;
      if (!used) {
        interfaces.push({ name: n.name, role: "unused" });
      } else if ((n.name === wanNic && wanTagged) || (n.name === lanNic && lanTagged)) {
        if (!interfaces.some(function (i) { return i.name === n.name; })) {
          interfaces.push({ name: n.name, role: "unused" });
        }
      }
    });
    var payload = {
      hostname: val("hostname"),
      admin: val("admin"),
      password: document.getElementById("password").value,
      interfaces: interfaces,
      ui_exposure: [lanName],
      lan_prefix: val("lan_prefix"),
      dhcp_pool: val("dhcp_pool"),
      wan_pd: val("wan_pd"),
    };
    try {
      var r = await fetch("/api/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      var j = await r.json();
      if (!r.ok || !j.ok) {
        err.textContent = j.error || r.statusText || "bootstrap failed";
        return;
      }
      app.innerHTML = "<p>Bootstrap complete. Reloading status…</p>";
      window.setTimeout(load, 1000);
    } catch (e) {
      err.textContent = String(e);
    }
  }

  async function load() {
    try {
      var st = await (await fetch("/api/status")).json();
      if (st.bootstrapped) renderStatus(st);
      else renderWizard(st);
    } catch (e) {
      app.innerHTML = "<p class=\"err\">" + esc(e) + "</p>";
    }
  }

  load();
})();
