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

  function renderStatus(st) {
    var ifaces = (st.interfaces || [])
      .map(function (i) {
        var bits = [esc(i.name), esc(i.placement || "")];
        if (i.role) bits.push(esc(i.role));
        if (i.vlan) bits.push("vlan " + esc(i.vlan));
        if (i.dhcp) bits.push("dhcp");
        if (i.addresses && i.addresses.length) bits.push(esc(i.addresses.join(" ")));
        return "<li>" + bits.join(" · ") + "</li>";
      })
      .join("");
    app.innerHTML =
      "<h2>Status</h2>" +
      "<p>hostname: " + esc(st.hostname || "") + "</p>" +
      "<p>LAN prefix: " + esc(st.lan_prefix || "") + "</p>" +
      "<p>DHCP pool: " + esc(st.dhcp_pool || "") + "</p>" +
      "<p>WAN PD: " + esc(st.wan_pd || "") + "</p>" +
      "<p class=\"muted\">Default policy is applied automatically when a WAN exists.</p>" +
      "<h3>NICs</h3><ul>" +
      ifaces +
      "</ul>";
  }

  function nicPlacement(name) {
    var sel = document.getElementById("place-" + name);
    return sel ? sel.value : "fwd";
  }

  function renderWizard(st) {
    var nics = st.nics || [];
    var nicHtml = nics
      .map(function (n) {
        return (
          "<div class=\"nic\">" +
          "<strong>" +
          esc(n.name) +
          "</strong>" +
          "<label>placement" +
          "<select id=\"place-" +
          esc(n.name) +
          "\">" +
          "<option value=\"mgmt\">mgmt</option>" +
          "<option value=\"fwd\" selected>fwd</option>" +
          "<option value=\"stick\">stick (VLANs)</option>" +
          "</select></label></div>"
        );
      })
      .join("");
    app.innerHTML =
      "<h2>Bootstrap wizard</h2>" +
      "<form id=\"wiz\">" +
      "<label>hostname <input id=\"hostname\" required></label>" +
      "<label>admin <input id=\"admin\" required></label>" +
      "<label>password <input id=\"password\" type=\"password\" required></label>" +
      "<h3>NIC placement (fwd or mgmt)</h3>" +
      nicHtml +
      "<p class=\"muted\">Stick uses WAN/LAN VLANs on one NIC.</p>" +
      "<label>WAN VLAN <input id=\"wan_vlan\" value=\"10\"></label>" +
      "<label>LAN VLAN <input id=\"lan_vlan\" value=\"20\"></label>" +
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
    document.getElementById("wiz").addEventListener("submit", function (ev) {
      ev.preventDefault();
      submit(nics);
    });
  }

  function lanHost(prefix) {
    var ip = (prefix.split("/")[0] || "").split(".");
    if (ip.length !== 4) return "";
    if (ip[3] === "0") ip[3] = "1";
    var pfx = (prefix.split("/")[1] || "24");
    return ip.join(".") + "/" + pfx;
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
    var interfaces = [];
    nics.forEach(function (n) {
      var place = nicPlacement(n.name);
      if (place === "stick") {
        var wanVid = parseInt(val("wan_vlan") || "10", 10);
        var lanVid = parseInt(val("lan_vlan") || "20", 10);
        interfaces.push({ name: n.name, placement: "fwd", role: "stick" });
        interfaces.push({
          name: n.name + "." + wanVid,
          placement: "fwd",
          role: "wan",
          parent: n.name,
          vlan: wanVid,
          addresses: addrs,
          dhcp: dhcp,
        });
        var lanAddr = lanHost(val("lan_prefix"));
        interfaces.push({
          name: n.name + "." + lanVid,
          placement: "fwd",
          role: "lan",
          parent: n.name,
          vlan: lanVid,
          addresses: lanAddr ? [lanAddr] : [],
        });
      } else if (place === "mgmt") {
        interfaces.push({ name: n.name, placement: "mgmt" });
      } else {
        interfaces.push({
          name: n.name,
          placement: "fwd",
          role: "wan",
          addresses: addrs,
          dhcp: dhcp,
        });
      }
    });
    var payload = {
      hostname: val("hostname"),
      admin: val("admin"),
      password: document.getElementById("password").value,
      interfaces: interfaces,
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
